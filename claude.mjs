import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

export const DRAFT_MODEL = "claude-sonnet-5";
export const REVIEW_MODEL = "claude-sonnet-5";

// Intro pricing through 2026-08-31; sticker is 3/15. USD per million tokens.
const PRICE_PER_MTOK = { input: 2, output: 10 };

function apiKeyFromEnvFile() {
  const envText = readFileSync(new URL(".env", import.meta.url), "utf8");
  const keyLine = envText
    .split(/\r?\n/)
    .find((line) => line.startsWith("ANTHROPIC_API_KEY="));
  if (!keyLine) throw new Error("ANTHROPIC_API_KEY not found in .env");
  return keyLine.slice("ANTHROPIC_API_KEY=".length).trim();
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? apiKeyFromEnvFile(),
});

export function usageCostUsd(usage) {
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input +
      usage.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000
  );
}

export async function draftCompletion(systemPrompt, userPrompt) {
  // Streaming keeps a full-page generation under the SDK HTTP timeout.
  const pageStream = anthropic.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 32000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const finalMessage = await pageStream.finalMessage();
  const draftText = finalMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return { draftText, usage: finalMessage.usage };
}

export async function reviewCompletion(systemPrompt, userPrompt, reviewSchema) {
  const reviewMessage = await anthropic.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      format: { type: "json_schema", schema: reviewSchema },
    },
  });
  if (reviewMessage.stop_reason === "refusal") {
    throw new Error("Review request was refused by the model");
  }
  const reviewBlock = reviewMessage.content.find(
    (block) => block.type === "text",
  );
  if (!reviewBlock) {
    throw new Error(
      `review returned no text block (stop_reason: ${reviewMessage.stop_reason})`,
    );
  }
  return { reviewText: reviewBlock.text, usage: reviewMessage.usage };
}
