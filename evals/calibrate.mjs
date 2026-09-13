#!/usr/bin/env node
// Measures every run under out/runs with the composition metrics and checks the gate
// rules against hand labels in evals/labels.json. Offline: no API key, no network.
//
// Exit 1 when a rule in GATED passes a page labelled bad with that rule's defect tag,
// or fails a page labelled good.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compositionChecks, measureRun } from "../qa-composition.mjs";

const GATED = ["hero-cta", "no-decorative-labels", "type-measure", "type-scale", "theme-mode"];
const CANDIDATES = [...GATED, "stranded-column"];
const DEFECT_RULE = {
  hero: "hero-cta",
  labels: "no-decorative-labels",
  measure: "type-measure",
  scale: "type-scale",
  theme: "theme-mode",
  stranded: "stranded-column",
};

const evalsDir = fileURLToPath(new URL(".", import.meta.url));
const runsDir = join(evalsDir, "..", "out", "runs");
const labelsPath = join(evalsDir, "labels.json");

function runIds() {
  return readdirSync(runsDir).filter((id) => existsSync(join(runsDir, id, "page.html"))).sort();
}

function directionOf(runDir) {
  try {
    return JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).direction ?? null;
  } catch {
    return null;
  }
}

const fmt = (value) => (value === null || value === undefined ? "n/a" : String(value));

function tableRow(id, m, direction) {
  const wanted = direction?.theme?.mode ?? "n/a";
  return [
    id.replace("-salcedo-systems", ""),
    fmt(m.measureMax),
    `${m.typeScaleCount}/${fmt(m.typeScaleRatio)}`,
    m.decorativeLabels,
    `${m.heroCta1440}/${m.heroCta375}`,
    `${m.strandedCount}/${m.sectionCount} (${m.strandedMaxConsecutive})`,
    fmt(m.uniformInsetShare),
    `${fmt(m.densityMin)}/${fmt(m.densityMax)}`,
    m.offGrid,
    `${m.themeDark} vs ${wanted}`,
  ];
}

function renderTable(rows) {
  const head = ["run", "measureMax", "sizes/ratio", "decorative", "CTA 1440/375", "stranded (consec)", "inset share", "density min/max", "offGrid", "theme vs direction"];
  return [head, head.map(() => "---"), ...rows].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

// A rule discriminates when it fails every bad page tagged with its defect and no good page.
function judgeRule(rule, results, labels) {
  const failsOn = (id) => results.get(id)?.some((c) => c.rule === rule && !c.pass) ?? false;
  const tag = Object.entries(DEFECT_RULE).find(([, r]) => r === rule)?.[0];
  const tagged = Object.entries(labels).filter(([, l]) => l.verdict === "bad" && l.defects.includes(tag)).map(([id]) => id);
  const good = Object.entries(labels).filter(([, l]) => l.verdict === "good").map(([id]) => id);
  const missedBad = tagged.filter((id) => !failsOn(id));
  const falseGood = good.filter(failsOn);
  return { rule, tagged: tagged.length, good: good.length, missedBad, falseGood, ok: !missedBad.length && !falseGood.length };
}

async function main() {
  const rows = [];
  const results = new Map();
  for (const id of runIds()) {
    const runDir = join(runsDir, id);
    const direction = directionOf(runDir);
    process.stderr.write(`measuring ${id}\n`);
    const metrics = await measureRun(runDir);
    const { gate, advisory } = compositionChecks(metrics, direction);
    results.set(id, [...gate, ...advisory]);
    rows.push(tableRow(id, metrics, direction));
  }
  const table = renderTable(rows);
  console.log(table);
  writeFileSync(
    join(evalsDir, "calibration.md"),
    `# Composition calibration\n\nMeasured ${new Date().toISOString().slice(0, 10)} on ${rows.length} runs by \`node evals/calibrate.mjs\`.\n\n${table}\n`,
  );

  if (!existsSync(labelsPath)) return;
  const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
  let broken = false;
  console.log(`\nLabels: ${Object.keys(labels).length} (${Object.values(labels).filter((l) => l.verdict === "good").length} good)`);
  for (const rule of CANDIDATES) {
    const j = judgeRule(rule, results, labels);
    const gated = GATED.includes(rule);
    const detail = j.tagged ? `fails ${j.tagged - j.missedBad.length}/${j.tagged} tagged bad` : "no tagged bad page (vacuous)";
    const goodDetail = j.good ? `false-fails ${j.falseGood.length}/${j.good} good` : "no good page (vacuous)";
    console.log(`  ${j.ok ? "ok  " : "FAIL"}  ${rule}${gated ? " [gate]" : ""}: ${detail}; ${goodDetail}${j.missedBad.length ? `; missed ${j.missedBad.join(", ")}` : ""}${j.falseGood.length ? `; false on ${j.falseGood.join(", ")}` : ""}`);
    if (gated && !j.ok) broken = true;
  }
  process.exit(broken ? 1 : 0);
}

await main();
