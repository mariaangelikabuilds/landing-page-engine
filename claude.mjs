import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

export const DRAFT_MODEL = "claude-sonnet-5";
export const REVIEW_MODEL = "claude-sonnet-5";

// USD per million tokens. Sonnet 5 launched at 2/10 as introductory pricing through
// 2026-08-31; the pricing page (checked 2026-09-14) says that is now the standard price and
// the scheduled 3/15 increase will not occur. Every ledger line is costed at this rate.
const PRICE_PER_MTOK = { input: 2, output: 10 };

// Adaptive thinking bills at output price and was 70 to 95 percent of every stage's output
// tokens on the 2026-08-17 runs. Effort is the lever; each stage carries its own default
// and PAGE_ENGINE_EFFORT_<STAGE> overrides it for an A/B without touching code.
const EFFORT = { direction: "high", draft: "high", review: "medium", judge: "medium" };
const effortFor = (stage) => process.env[`PAGE_ENGINE_EFFORT_${stage.toUpperCase()}`] ?? EFFORT[stage];

function apiKeyFromEnvFile() {
  let envText;
  try {
    envText = readFileSync(new URL(".env", import.meta.url), "utf8");
  } catch {
    throw new Error("no ANTHROPIC_API_KEY in the environment and no .env file to read");
  }
  const keyLine = envText
    .split(/\r?\n/)
    .find((line) => line.startsWith("ANTHROPIC_API_KEY="));
  if (!keyLine) throw new Error("ANTHROPIC_API_KEY not found in .env");
  return keyLine.slice("ANTHROPIC_API_KEY=".length).trim();
}

// Built on first call, not at import. qa.mjs imports usageCostUsd from here, so
// constructing the client at module scope made the deterministic gate demand a key it
// never uses. CI caught it: evals run with no .env and no secrets.
let client;
function anthropic() {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? apiKeyFromEnvFile(),
  });
  return client;
}

export function usageCostUsd(usage) {
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input +
      usage.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000
  );
}

// The SDK retries a failed request; it does not retry a stream that dies mid-body, which
// is what "terminated" on the 2026-08-17 runs was. Same shape as font.mjs and image.mjs:
// a dropped connection and a real failure look alike at the call site, so wait for both.
const TRANSIENT = /terminated|ECONNRESET|fetch failed|Connection error|overloaded|529/i;
async function withRetry(what, attempt = 0) {
  try {
    return await what();
  } catch (failure) {
    if (attempt >= 2 || !TRANSIENT.test(failure.message ?? "")) throw failure;
    process.stderr.write(`  claude: ${failure.message.slice(0, 60)}, retrying\n`);
    await new Promise((done) => setTimeout(done, 4000 * (attempt + 1)));
    return withRetry(what, attempt + 1);
  }
}

export async function draftCompletion(systemPrompt, userPrompt) {
  return withRetry(async () => {
    // Streaming keeps a full-page generation under the SDK HTTP timeout.
    const pageStream = anthropic().messages.stream({
      model: DRAFT_MODEL,
      // Rules 1.4.0 (composition plus motion) pushed a draft to exactly 32000 tokens and
      // the page came back truncated, missing its closing tags. The gate caught it on
      // valid-document rather than shipping it, which is the split working, but the
      // ceiling was the actual cause.
      max_tokens: 64000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      output_config: { effort: effortFor("draft") },
    });
    const finalMessage = await pageStream.finalMessage();
    const draftText = finalMessage.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { draftText, usage: finalMessage.usage };
  });
}

// One structured call, shared by direction, review and the composition judge. `content`
// may be a string or an array of content blocks (the judge sends screenshot tiles).
async function structuredCompletion(stage, systemPrompt, content, schema, maxTokens = 16000) {
  return withRetry(async () => {
    const message = await anthropic().messages.create({
      model: REVIEW_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema }, effort: effortFor(stage) },
    });
    if (message.stop_reason === "refusal") {
      throw new Error(`${stage} request was refused by the model`);
    }
    const block = message.content.find((part) => part.type === "text");
    if (!block) {
      throw new Error(`${stage} returned no text block (stop_reason: ${message.stop_reason})`);
    }
    return { text: block.text, usage: message.usage };
  });
}

export async function directionCompletion(systemPrompt, userPrompt, directionSchema) {
  const { text, usage } = await structuredCompletion("direction", systemPrompt, userPrompt, directionSchema);
  return { directionText: text, usage };
}

export async function reviewCompletion(systemPrompt, userPrompt, reviewSchema) {
  // 8000 was not enough once pages carried animation CSS and grew past 29k output
  // tokens: the call returned stop_reason max_tokens with no text block at all, and
  // the review degraded to advisory-skipped on every run.
  const { text, usage } = await structuredCompletion("review", systemPrompt, userPrompt, reviewSchema);
  return { reviewText: text, usage };
}

export async function judgeCompletion(systemPrompt, contentBlocks, judgeSchema) {
  const { text, usage } = await structuredCompletion("judge", systemPrompt, contentBlocks, judgeSchema);
  return { judgeText: text, usage };
}
