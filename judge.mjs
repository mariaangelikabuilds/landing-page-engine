import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { judgeCompletion, usageCostUsd } from "./claude.mjs";
import { captureTiles } from "./tiles.mjs";

const RULE_IDS = [
  "canvas-use", "container-variety", "grid-break", "type-scale", "type-measure",
  "spacing-ratio", "figure-ground", "density-variation", "no-decorative-labels",
  "no-template-skeleton", "no-section-rhythm", "hero-cro", "imagery-placement",
];

// The judge reads the Structure and Composition sections: the rest of the rules file is
// about markup and copy, which a screenshot cannot show. Structure is in because the hero
// rule lives there and the first judge call read "one call to action" as a ceiling.
function visualRules() {
  const rules = readFileSync(new URL("rules/page-rules.md", import.meta.url), "utf8");
  const start = rules.indexOf("## Structure");
  const end = rules.indexOf("## Motion", start);
  if (start < 0 || end < 0) throw new Error("page-rules.md has no Structure and Composition sections");
  return rules.slice(start, end).trimEnd();
}

const OWNER_KILLS = `Standing kills from the page's owner

- no tracked-out all-caps eyebrow labels, no small caps used as labels
- no numbered section prefixes
- no coloured left accent stripes
- no decorative italic
- no card grid as the default container
- no centred hero with a subtext paragraph and two buttons and three feature cards under it
- no purple-to-blue gradients
- no orange or brown page-scale grounds
- exactly one call to action above the fold: zero is a failure, two is a failure`;

// The four ids the rules file does not define, so the judge is not guessing at them.
const EXTRA_IDS = `Rule ids used here that the rules file does not spell out:

- hero-cro: the first screen at 1440 shows an outcome headline, exactly one call to action
  (a button or link that names a real action) and one proof element. Count the calls to
  action in tile 1 before writing anything else. A first screen with none is the most
  common failure and it is serious; so is a first screen with two.
- no-template-skeleton: the stock layout (centred hero, subtext, two buttons, three
  cards, testimonial band, footer CTA) in any dress.
- no-section-rhythm: the same formula (label, heading, paragraph, grid) repeated section
  after section.
- imagery-placement: a photograph that sits where the direction did not put it, or a
  dark photograph under the headline on a page whose direction said light.`;

const INSTRUCTION = `You are looking at a rendered landing page as screenshot tiles, first 1440px wide (top to bottom), then 375px wide. Judge composition only: what the eye sees, not the markup. Cite the rule id, the viewport, the tile number and the section as you would name it from what you see.

Severity is not a mood. Mark a finding "serious" when any of these is true, and only then:
- canvas-use: at 1440 a text section's ink ends before about 65 percent of the width with nothing beside it but ground, and this happens in two or more sections. Full-bleed bands elsewhere do not excuse it.
- hero-cro: the first 1440 tile shows no call to action, or more than one, or a subtext paragraph plus buttons plus cards.
- no-template-skeleton or no-section-rhythm: the page as a whole is the stock skeleton or one formula repeated three or more times.
- no-decorative-labels: tracked caps or small caps used as labels anywhere in the page (one finding for the page, not one per section).
Everything else is "minor". An empty list is a valid answer.

Then write one paragraph of overall judgement: what the page looks like it is, whether the art direction it was given actually landed, and, if the direction said light and the render is mostly dark or the reverse, say so.`;

const systemPrompt = () => `${visualRules()}\n\n${EXTRA_IDS}\n\n${OWNER_KILLS}\n\n${INSTRUCTION}`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string", enum: RULE_IDS },
          severity: { type: "string", enum: ["minor", "serious"] },
          viewport: { type: "integer", enum: [1440, 375] },
          tile: { type: "integer" },
          section: { type: "string" },
          reason: { type: "string" },
        },
        required: ["rule", "severity", "viewport", "tile", "section", "reason"],
        additionalProperties: false,
      },
    },
    overall: { type: "string" },
  },
  required: ["findings", "overall"],
  additionalProperties: false,
};

const imageBlock = (buffer) => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: buffer.toString("base64") },
});

function tileBlocks(width, buffers, omitted) {
  const blocks = buffers.flatMap((buffer, i) => [
    { type: "text", text: `${width}px, tile ${i + 1} of ${buffers.length}` },
    imageBlock(buffer),
  ]);
  if (omitted > 0) {
    blocks.push({ type: "text", text: `${width}px: the page continues below tile ${buffers.length}; ${omitted} further tile(s) were omitted.` });
  }
  return blocks;
}

function directionBlock(direction) {
  // Older run.json files carry aestheticLane rather than lane; same content, older key.
  const picked = {
    hero: direction.hero,
    composition: direction.composition,
    sections: direction.sections,
    theme: direction.theme,
    lane: direction.lane ?? direction.aestheticLane,
  };
  const present = Object.fromEntries(Object.entries(picked).filter(([, v]) => v !== undefined));
  return { type: "text", text: "Art direction the draft was given:\n" + JSON.stringify(present, null, 1) };
}

// Same discipline as qa.mjs validatedViolations: the schema is enforced server side, but
// a refusal or truncation must fail loudly here rather than downstream.
function validatedJudgement(body) {
  if (!Array.isArray(body?.findings)) throw new Error("judge output missing findings array");
  if (typeof body.overall !== "string") throw new Error("judge output missing overall string");
  for (const finding of body.findings) {
    for (const field of ["rule", "severity", "section", "reason"]) {
      if (typeof finding[field] !== "string") throw new Error(`judge finding missing string field: ${field}`);
    }
    for (const field of ["viewport", "tile"]) {
      if (!Number.isInteger(finding[field])) throw new Error(`judge finding missing integer field: ${field}`);
    }
  }
  // A serious finding that cannot say where it is cannot drive a repair, so it is
  // demoted to minor rather than trusted.
  const findings = body.findings.map((finding) =>
    finding.section.trim() === "" ? { ...finding, severity: "minor" } : finding,
  );
  return { findings, overall: body.overall };
}

// briefBody is accepted for parity with the other stages but the judge sees only the
// direction and the tiles: composition is judged against what was asked for visually.
export async function judgeComposition(tiles, direction, briefBody) { // eslint-disable-line no-unused-vars
  const content = [
    directionBlock(direction),
    ...tileBlocks(1440, tiles.desktop, tiles.omitted?.desktop ?? 0),
    ...tileBlocks(375, tiles.phone, tiles.omitted?.phone ?? 0),
  ];
  const { judgeText, usage } = await judgeCompletion(systemPrompt(), content, JUDGE_SCHEMA);
  const { findings, overall } = validatedJudgement(JSON.parse(judgeText));
  return {
    findings,
    serious: findings.filter((finding) => finding.severity === "serious"),
    overall,
    usage,
    costUsd: usageCostUsd(usage),
  };
}

export async function judgeRun(runDir) {
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const tiles = await captureTiles(pathToFileURL(join(runDir, "page.html")).href);
  const judgement = await judgeComposition(tiles, run.direction ?? {}, run.brief);
  const report = {
    judgedAt: new Date().toISOString(),
    ...judgement,
    tiles: { desktop: tiles.desktop.length, phone: tiles.phone.length },
  };
  writeFileSync(join(runDir, "judge.json"), JSON.stringify(report, null, 2));
  return report;
}
