#!/usr/bin/env node
// Measures the deterministic gate by breaking a page it already passed.
//
// The gate's job is to decide whether a drafted page ships. That claim was never
// tested: the engine asserted the gate worked because a good page passed. This
// injects one known defect at a time and asks whether the right check fires, and
// only the right check.
//
// Offline and free. No API key, no network.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { deterministicGate } from "../qa.mjs";
import { MUTATIONS, KNOWN_BLIND_SPOTS } from "./mutations.mjs";

const evalsDir = fileURLToPath(new URL(".", import.meta.url));
const fixtureDir = join(evalsDir, "fixtures", "baseline");
const BASELINE_HTML = readFileSync(join(fixtureDir, "page.html"), "utf8");
const BASELINE_RUN = readFileSync(join(fixtureDir, "run.json"), "utf8");

// The fixture names itself: the golden page is always a real run, and its id is derived
// from its own record rather than typed into the scorecard.
const fixtureRecord = JSON.parse(BASELINE_RUN);
const FIXTURE_ID = `${fixtureRecord.startedAt.replace(/[:.]/g, "-").slice(0, 19)}-${fixtureRecord.brief.brand
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// A mutation may patch the run record as well as the page: theme-mode is a comparison
// between the direction on record and the render, so its defect lives in run.json.
function stageRun(workspace, name, pageHtml, patchRun = null) {
  const runDir = join(workspace, name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "page.html"), pageHtml);
  writeFileSync(join(runDir, "run.json"), patchRun ? JSON.stringify(patchRun(JSON.parse(BASELINE_RUN))) : BASELINE_RUN);
  return runDir;
}

const failedRules = (checks) => checks.filter((c) => !c.pass).map((c) => c.rule);

// Committed artifacts stay deterministic so CI can diff them: no timestamps and no
// timings land in results.json. Latency goes to stderr, where a changing number is
// information rather than a spurious diff.
async function scoreBaseline(workspace) {
  const startedAt = Date.now();
  const checks = await deterministicGate(stageRun(workspace, "baseline", BASELINE_HTML));
  const falseFails = failedRules(checks);
  process.stderr.write(`baseline gate: ${Date.now() - startedAt} ms\n`);
  return {
    checkCount: checks.length,
    falseFails,
    clean: falseFails.length === 0,
  };
}

async function scoreMutation(workspace, mutation) {
  const mutated = mutation.apply(BASELINE_HTML);
  if (mutated === BASELINE_HTML) {
    throw new Error(`mutation ${mutation.id} changed nothing`);
  }
  const checks = await deterministicGate(stageRun(workspace, mutation.id, mutated, mutation.run ?? null));
  const failed = failedRules(checks);
  return {
    id: mutation.id,
    rule: mutation.rule,
    defect: mutation.defect,
    detected: failed.includes(mutation.rule),
    collateral: failed.filter((rule) => rule !== mutation.rule),
  };
}

function renderScorecard(results) {
  const { baseline, mutations, detectionRate, collateralCount } = results;
  const rows = mutations
    .map((m) => {
      const mark = m.detected ? "caught" : "MISSED";
      const collateral = m.collateral.length ? m.collateral.join(", ") : "none";
      return `| \`${m.id}\` | ${m.rule} | ${mark} | ${collateral} |`;
    })
    .join("\n");

  const blindSpots = KNOWN_BLIND_SPOTS.map(
    (b) => `- **${b.id}**: ${b.defect}\n  Missed because ${b.whyMissed}. Caught instead by ${b.caughtBy}.`,
  ).join("\n");

  return `# Gate scorecard

Written by \`npm run evals\`. Do not edit by hand. CI regenerates it and fails on a diff,
so this file and the code cannot drift apart.

The golden page is a real run that passed the full gate (\`${FIXTURE_ID}\`).
Each mutation injects exactly one defect into it and names the check that should fire.

**Detection: ${mutations.filter((m) => m.detected).length}/${mutations.length} (${detectionRate}%).
False fails on the clean page: ${baseline.falseFails.length}.
Collateral failures across all mutants: ${collateralCount}.**

| mutation | target check | result | also failed |
|----------|--------------|--------|-------------|
${rows}

"Also failed" measures whether a defect trips checks it has no business tripping.
Zero means each check is independent, so a failure names its own cause.

## Known blind spots

Not scored. Recorded so this states the gate's edges rather than implying it has none.

${blindSpots}

## Method

- Labels are correct by construction: the harness knows what it broke, so nothing here
  is hand-labelled.
- The clean page runs first. If it fails any check, the suite aborts, since detection
  numbers measured against a broken baseline would mean nothing.
- Every check is local and the unreachable host uses the RFC 2606 \`.invalid\` TLD, so
  the suite needs no network and no API key. That is why CI can run it on fork pull
  requests, where secrets are unavailable.
- The advisory review pass is excluded on purpose: it is not what decides a verdict.
- Timings are printed to stderr, not written here, so this file stays byte-stable and a
  diff always means the score moved.
`;
}

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), "page-engine-evals-"));
  const startedAt = Date.now();
  try {
    const baseline = await scoreBaseline(workspace);
    process.stderr.write(
      `baseline: ${baseline.clean ? "clean" : `FAILED ${baseline.falseFails.join(", ")}`}\n`,
    );
    if (!baseline.clean) {
      process.stderr.write("aborting: cannot measure detection against a broken baseline\n");
      process.exit(2);
    }

    const mutations = [];
    for (const mutation of MUTATIONS) {
      const result = await scoreMutation(workspace, mutation);
      mutations.push(result);
      process.stderr.write(
        `  ${result.detected ? "caught" : "MISSED"}  ${result.id} -> ${result.rule}` +
          `${result.collateral.length ? ` (also: ${result.collateral.join(", ")})` : ""}\n`,
      );
    }

    const detected = mutations.filter((m) => m.detected).length;
    const results = {
      baseline,
      mutations,
      detectionRate: Math.round((detected / mutations.length) * 100),
      collateralCount: mutations.reduce((sum, m) => sum + m.collateral.length, 0),
      knownBlindSpots: KNOWN_BLIND_SPOTS,
    };
    process.stderr.write(`suite: ${Date.now() - startedAt} ms\n`);

    writeFileSync(join(evalsDir, "results.json"), JSON.stringify(results, null, 2));
    writeFileSync(join(evalsDir, "SCORECARD.md"), renderScorecard(results));
    process.stderr.write(
      `\n${detected}/${mutations.length} caught, ${results.collateralCount} collateral, ` +
        `${baseline.falseFails.length} false fail\n`,
    );
    process.exit(detected === mutations.length && results.collateralCount === 0 ? 0 : 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
