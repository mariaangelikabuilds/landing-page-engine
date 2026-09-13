// Did the direction stage explore, or converge? Offline: reads every run.json under out/runs
// that carries a direction, takes the latest run per brand, and prints what each was given.
// Exits 1 when the latest runs across brands share a font family, a voice word or a lane,
// when every hero treatment is the same, or when one brand's last four runs repeat the same
// object class with the same two families (the 2026-08-17 failure: four for four).
//   node evals/convergence.mjs [out/runs]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_REFLEX } from "../direction.mjs";

const outRoot = process.argv[2] ?? "out/runs";
const MATERIALS = /\b(steel|iron|brass|copper|enamel|ceramic|glass|linen|cotton|canvas|wool|leather|wood|oak|teak|lacquer|neon|acrylic|concrete|stone|marble|paper|card|vinyl|rubber|tile|clay|porcelain|resin|felt)\b/i;

function objectClass(text) {
  if (DOCUMENT_REFLEX.test(text)) return "document";
  const m = String(text).match(MATERIALS);
  return m ? m[1].toLowerCase() : "other";
}

const runs = existsSync(outRoot)
  ? readdirSync(outRoot).sort().flatMap((dir) => {
      try {
        const record = JSON.parse(readFileSync(join(outRoot, dir, "run.json"), "utf8"));
        return record.direction ? [{ dir, brand: record.brief.brand, direction: record.direction }] : [];
      } catch { return []; }
    })
  : [];

const byBrand = new Map();
for (const run of runs) byBrand.set(run.brand, [...(byBrand.get(run.brand) ?? []), run]);

const row = (run) => {
  const d = run.direction;
  return {
    brand: run.brand,
    run: run.dir,
    voice: (d.voiceWords ?? []).join(", "),
    object: d.physicalObject,
    objectClass: objectClass(`${d.physicalObject} ${d.material ?? ""}`),
    lane: d.lane ?? "(none)",
    fonts: `${d.type.displayFamily} / ${d.type.bodyFamily}`,
    theme: d.theme.mode,
    strategy: d.color.strategy,
    hero: d.hero?.treatment ?? "(none)",
    grid: d.composition?.grid ?? "(none)",
  };
};

const latest = [...byBrand.values()].map((list) => row(list[list.length - 1]));
const lines = [];
lines.push(`# Convergence report, ${new Date().toISOString().slice(0, 10)}`, "", "## Latest run per brand", "");
lines.push("| brand | run | voice | object class | lane | fonts | theme | strategy | hero |", "|---|---|---|---|---|---|---|---|---|");
for (const r of latest) lines.push(`| ${r.brand} | ${r.run} | ${r.voice} | ${r.objectClass} | ${r.lane} | ${r.fonts} | ${r.theme} | ${r.strategy} | ${r.hero} |`);

const failures = [];
const shared = (pick) => {
  const seen = new Map();
  for (const r of latest) for (const v of pick(r)) seen.set(v, (seen.get(v) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([v]) => v);
};
if (latest.length > 1) {
  const fonts = shared((r) => r.fonts.split(" / ").map((f) => f.toLowerCase()));
  if (fonts.length) failures.push(`font family shared across brands: ${fonts.join(", ")}`);
  const words = shared((r) => r.voice.split(", ").map((w) => w.toLowerCase()).filter(Boolean));
  if (words.length) failures.push(`voice word shared across brands: ${words.join(", ")}`);
  const lanes = shared((r) => [r.lane]);
  if (lanes.length) failures.push(`lane shared across brands: ${lanes.join(", ")}`);
  if (new Set(latest.map((r) => r.hero)).size === 1 && latest.length >= 3) failures.push(`every brand got the same hero treatment: ${latest[0].hero}`);
}

lines.push("", "## Last four runs per brand", "");
for (const [brand, list] of byBrand) {
  const last = list.slice(-4).map(row);
  lines.push(`### ${brand}`, "", "| run | voice | object class | lane | fonts | hero |", "|---|---|---|---|---|---|");
  for (const r of last) lines.push(`| ${r.run} | ${r.voice} | ${r.objectClass} | ${r.lane} | ${r.fonts} | ${r.hero} |`);
  lines.push("");
  const keys = last.map((r) => `${r.objectClass}|${r.fonts.toLowerCase()}`);
  const repeats = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (repeats.length) failures.push(`${brand}: object class and families repeat within the last four runs (${[...new Set(repeats)].join("; ")})`);
}

lines.push("## Verdict", "", failures.length ? failures.map((f) => `- ${f}`).join("\n") : "- explored: no shared font, voice word or lane across brands; no brand repeats itself within four runs");
console.log(lines.join("\n"));
process.exitCode = failures.length ? 1 : 0;
