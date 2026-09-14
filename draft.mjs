import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DRAFT_MODEL, draftCompletion, usageCostUsd } from "./claude.mjs";
import { resolveImages } from "./image.mjs";
import { directPage, directionBrief } from "./direction.mjs";
import { embedFonts, injectFonts } from "./font.mjs";

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

axe-core fails the build on any serious contrast violation, and accent-on-light
pairs are where drafts die: every text/background pair, including buttons in
their DEFAULT state, must clear WCAG AA 4.5:1. Bold 16px is NOT large text;
only 24px+ (or bold 18.66px+) may use the 3:1 large-text minimum. When you pick
an accent for a button, verify the pair mentally against near-white text and
darken the accent until it clears; when in doubt, use dark text on the accent.

The art direction names the hero headline, the single call to action and the
single proof element. Above the fold at 1440 there is exactly one link that is
a call to action (mailto:, tel: or http). A second button, a subtext paragraph
or feature cards under the hero fail the gate. Set max-width in ch on p, li, dd
and figcaption only, never on a wrapper: the wrapper is the grid, and a page
whose sections all sit in one narrow left column with a dead band beside it
fails. Never text-transform: uppercase with letter-spacing on small text, never
font-variant: small-caps, never a numbered prefix on a heading, and never
uppercase on any text under 20px except inside a button or a link. The theme the
direction names is checked on the render: a light page is mostly light bands.
Never draw a decorative block: no repeating-linear-gradient mesh, no pattern,
no texture, no empty tinted box standing in for a photograph. A split section's
other half is a photograph from the brief, a figure built from the brief's
numbers, or type. If there is nothing to put there, the section is not split.

Output only the HTML document. No markdown fences, no commentary before or
after the doctype.

<page-rules>
${pageRules}
</page-rules>`;

// Direction, typefaces and photographs are the expensive half and none of them are what a
// failed check is complaining about. Prepared once, reused by every repair attempt.
export async function prepareRun(briefBody) {
  const { direction, usage: directionUsage, costUsd: directionCostUsd, retried: directionRetried } = await directPage(briefBody);
  process.stderr.write(
    `  direction: ${direction.voiceWords.join(", ")} · ${direction.lane} · ${direction.color.strategy} after ${direction.color.reference}\n` +
      `  object: ${direction.physicalObject}\n` +
      `  type: ${direction.type.displayFamily} / ${direction.type.bodyFamily} · hero: ${direction.hero.treatment}, ${direction.theme.mode}\n`,
  );
  const { styleBlock, embedded } = await embedFonts([
    { family: direction.type.displayFamily, weights: direction.type.displayWeights },
    { family: direction.type.bodyFamily, weights: direction.type.bodyWeights },
  ]);
  return {
    direction, styleBlock, embedded, directionUsage, directionCostUsd, directionRetried,
    imageCache: new Map(),
  };
}

// A repair writes into the same run directory: the attempt it replaces moves to attempts/
// so nothing is orphaned and the ledger can count what a run actually cost.
function shelveAttempt(runDir, kind) {
  const previous = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const n = (previous.attempts?.length ?? 0) + 1;
  const shelf = join(runDir, "attempts", `${n}-${kind}`);
  mkdirSync(shelf, { recursive: true });
  for (const name of ["page.html", "qa-report.json", "qa-report.md", "judge.json", "page-1440.png", "page-375.png"]) {
    if (existsSync(join(runDir, name))) renameSync(join(runDir, name), join(shelf, name));
  }
  let verdict = null, judgeSerious = null, reviewCostUsd = null, judgeCostUsd = null;
  try {
    const report = JSON.parse(readFileSync(join(shelf, "qa-report.json"), "utf8"));
    verdict = report.verdict;
    judgeSerious = report.judge?.serious?.length ?? null;
    reviewCostUsd = report.claudeReview?.costUsd ?? null;
    judgeCostUsd = report.judge?.costUsd ?? null;
  } catch { /* an attempt that never reached qa */ }
  return [
    ...(previous.attempts ?? []),
    { n, kind, verdict, judgeSerious, draftUsage: previous.draftUsage, draftCostUsd: previous.draftCostUsd, reviewCostUsd, judgeCostUsd, images: previous.images },
  ];
}

export async function draftPage(briefBody, outRoot = "out/runs", prepared = null, repairNotes = "", options = {}) {
  const runDir = options.runDir ?? join(outRoot, runSlug(briefBody.brand ?? "page"));
  mkdirSync(runDir, { recursive: true });
  const attempts = options.runDir ? shelveAttempt(runDir, options.repairKind ?? "deterministic") : [];

  const startedAt = new Date().toISOString();
  const context = prepared ?? (await prepareRun(briefBody));
  const { direction, styleBlock, embedded, directionUsage, directionCostUsd, directionRetried, imageCache } = context;

  const userPrompt = `${directionBrief(direction)}

Write the landing page for this brief:

${JSON.stringify(briefBody, null, 2)}${repairNotes}`;
  const { draftText, usage } = await draftCompletion(draftSystemPrompt, userPrompt);

  const { pageHtml, images } = await resolveImages(
    injectFonts(stripAccidentalFences(draftText), styleBlock),
    briefBody,
    imageCache,
    direction.imagery?.treatment ?? null,
  );
  writeFileSync(join(runDir, "page.html"), pageHtml);
  writeFileSync(
    join(runDir, "run.json"),
    JSON.stringify(
      {
        brief: briefBody,
        model: DRAFT_MODEL,
        startedAt,
        direction,
        directionRetried,
        fonts: embedded,
        directionUsage,
        directionCostUsd,
        attempts,
        draftUsage: usage,
        draftCostUsd: usageCostUsd(usage),
        // Image spend is not folded into costUsd: gpt-image-1 is priced per image, not
        // per token, and guessing a rate here would put an invented number in the
        // ledger. Count and size are recorded so the real cost stays reconstructable.
        images,
      },
      null,
      2,
    ),
  );
  return { runDir, pageHtml, usage, context };
}

function stripAccidentalFences(draftText) {
  return draftText
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
