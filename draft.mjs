import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DRAFT_MODEL, draftCompletion, usageCostUsd } from "./claude.mjs";

const pageRules = readFileSync(
  new URL("rules/page-rules.md", import.meta.url),
  "utf8",
);

export function readBrief(briefPath) {
  const briefText = readFileSync(briefPath, "utf8");
  if (briefPath.endsWith(".json")) return JSON.parse(briefText);
  return briefFromMarkdown(briefText);
}

// Markdown briefs are flat "key: value" lines; anything else joins the notes field.
function briefFromMarkdown(briefText) {
  const briefBody = { notes: [] };
  for (const line of briefText.split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (field) briefBody[field[1].toLowerCase()] = field[2].trim();
    else if (line.trim() && !line.startsWith("#")) briefBody.notes.push(line.trim());
  }
  briefBody.notes = briefBody.notes.join("\n");
  return briefBody;
}

function runSlug(brandName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stamp}-${slug}`;
}

const rulesVersion = pageRules.match(/Version (\d+\.\d+\.\d+)/)?.[1] ?? "unknown";

const draftSystemPrompt = `You are the drafting stage of a landing page engine.
You write one complete, self-contained HTML landing page and nothing else.

Your output must obey every rule in the rules file below (version ${rulesVersion}).
The page will be mechanically checked afterwards (single-file scan, link audit,
render at 1440 and 375, axe-core, and an exact scan of the rendered copy for
the copy-tells rule), then reviewed against these same rules. A single em dash,
en dash, or banned word in the visible copy fails the build outright, so write
copy that never needs the gate's forgiveness: use periods, commas, and colons.

Output only the HTML document. No markdown fences, no commentary before or
after the doctype.

<page-rules>
${pageRules}
</page-rules>`;

export async function draftPage(briefBody, outRoot = "out/runs") {
  const runDir = join(outRoot, runSlug(briefBody.brand ?? "page"));
  mkdirSync(runDir, { recursive: true });

  const userPrompt = `Write the landing page for this brief:\n\n${JSON.stringify(briefBody, null, 2)}`;
  const startedAt = new Date().toISOString();
  const { draftText, usage } = await draftCompletion(draftSystemPrompt, userPrompt);

  const pageHtml = stripAccidentalFences(draftText);
  writeFileSync(join(runDir, "page.html"), pageHtml);
  writeFileSync(
    join(runDir, "run.json"),
    JSON.stringify(
      {
        brief: briefBody,
        model: DRAFT_MODEL,
        startedAt,
        draftUsage: usage,
        draftCostUsd: usageCostUsd(usage),
      },
      null,
      2,
    ),
  );
  return { runDir, pageHtml, usage };
}

function stripAccidentalFences(draftText) {
  return draftText
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
