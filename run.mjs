import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { draftPage } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { judgeRun } from "./judge.mjs";
import { bundleRun } from "./bundle.mjs";

// One run: draft, gate, judge, repair, bundle. Used by the CLI and the MCP server so both
// paths get the same loop. Two repair budgets, spent in order: a failing deterministic check
// is repaired first (cheap, exact), and only a page that passes the gate is shown to the
// composition judge, whose serious findings can buy up to two layout repairs. The verdict
// never reads the judge.
// Three, not two: at medium effort a draft is $0.15, and the third repair is where a
// contrast fix that surfaced a second contrast fault gets closed.
const MAX_DETERMINISTIC_REPAIRS = 3;
const MAX_COMPOSITION_REPAIRS = 2;

// A failing check already knows exactly what is wrong and where. Handing that back is
// cheaper and more reliable than asking a person to run the command again, and it is the
// difference between an engine that drafts and one that ships.
function deterministicNotes(qaReport) {
  const failed = qaReport.deterministicChecks.filter((check) => !check.pass);
  return `

The previous attempt was REJECTED by the gate. Everything else about it was
acceptable, so change only what these findings name, and keep the art direction,
the palette, the typefaces, the section plan and every sentence of copy exactly
as they are, unless a finding below quotes that sentence.

${failed.map((check) => `- ${check.rule}: ${check.details}`).join("\n")}`;
}

// The judge looked at the render, not the markup, so its repair is allowed to move things.
function compositionNotes(judge) {
  return `

The previous attempt passed every mechanical check and was REJECTED by the
composition judge, who looked at the rendered page at 1440 and 375, not the
markup. Fix the layout. You MAY change the hero treatment, the grid, section
order, section widths, alignment, density and where each photograph sits.
You MUST keep the palette, both typefaces, every sentence of copy, the
section content, and every {{IMAGE: ...}} description character for
character (a reworded description is billed as a new photograph).
A text block whose ink ends before two thirds of the width needs something real
beside it (a photograph from the brief, a figure from the brief's numbers, a
second column of type) or it is centred at a balanced measure; never fill the
space with a pattern or an empty box. Every text and background pair you move
must still clear WCAG AA 4.5:1: when text lands on a new ground, set its colour
explicitly. The last two composition repairs both failed the contrast check.

Judge findings, most serious first:
${judge.serious.map((f) => `- ${f.rule} [${f.viewport}px, section "${f.section}"]: ${f.reason}`).join("\n")}`;
}

async function judgeIfPassing(runDir, qaReport, say) {
  if (qaReport.verdict !== "pass") return null;
  let judge;
  try {
    judge = await judgeRun(runDir);
    say(`  judge: ${judge.serious.length} serious, ${judge.findings.length - judge.serious.length} minor, $${judge.costUsd.toFixed(4)}`);
  } catch (failure) {
    judge = { findings: [], serious: [], errored: failure.message, costUsd: 0 };
    say(`  judge: ERRORED (${failure.message})`);
  }
  const report = { ...qaReport, judge };
  writeFileSync(join(runDir, "qa-report.json"), JSON.stringify(report, null, 2));
  return report;
}

// A composition repair can break a mechanical check the page it replaced had passed. A
// run never ends on a worse page than one it already had: when the last attempt fails
// the gate and an earlier attempt passed, the earlier page comes back as the result and
// the failed attempt is shelved with the rest. The judge findings that prompted the repair
// stay on the record as advisory.
const ATTEMPT_FILES = ["page.html", "qa-report.json", "judge.json", "page-1440.png", "page-375.png"];

export function restoreBestAttempt(runDir) {
  const record = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const current = JSON.parse(readFileSync(join(runDir, "qa-report.json"), "utf8"));
  if (current.verdict === "pass") return null;
  const passing = [...(record.attempts ?? [])].reverse().find((a) => a.verdict === "pass");
  if (!passing) return null;
  const shelf = join(runDir, "attempts", `${passing.n}-${passing.kind}`);
  const failedShelf = join(runDir, "attempts", `${(record.attempts?.length ?? 0) + 1}-abandoned`);
  mkdirSync(failedShelf, { recursive: true });
  for (const name of ATTEMPT_FILES) {
    if (existsSync(join(runDir, name))) renameSync(join(runDir, name), join(failedShelf, name));
    if (existsSync(join(shelf, name))) copyFileSync(join(shelf, name), join(runDir, name));
  }
  const restored = {
    ...record,
    draftUsage: passing.draftUsage,
    draftCostUsd: passing.draftCostUsd,
    attempts: [...record.attempts, { n: record.attempts.length + 1, kind: "abandoned", verdict: current.verdict, judgeSerious: null, draftUsage: record.draftUsage, draftCostUsd: record.draftCostUsd, reviewCostUsd: current.claudeReview?.costUsd ?? null, judgeCostUsd: current.judge?.costUsd ?? null, images: record.images }],
    restoredFromAttempt: passing.n,
  };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(restored, null, 2));
  return passing.n;
}

export async function runBrief(briefBody, { outRoot = "out/runs", say = () => {}, judge = true } = {}) {
  let prepared = null;
  let runDir = null;
  let notes = "";
  let repairKind = null;
  let detRepairs = 0;
  let compRepairs = 0;
  let lastFailed = null;
  let qaReport;

  for (;;) {
    say(runDir ? `redrafting into ${runDir} (${repairKind} repair)` : `drafting ${briefBody.brand}`);
    const drafted = await draftPage(briefBody, outRoot, prepared, notes, runDir ? { runDir, repairKind } : {});
    runDir = drafted.runDir;
    prepared = drafted.context;
    say(`  wrote ${runDir}/page.html (${drafted.usage.output_tokens} output tokens)`);

    say(`qa on ${runDir}`);
    qaReport = await qaRun(runDir);
    say(`  verdict: ${qaReport.verdict}`);

    if (qaReport.verdict !== "pass") {
      // A repair that fails the same rules as the attempt it repaired has not understood
      // the note; a third try at $0.15 is money, not signal.
      const failedNow = qaReport.deterministicChecks.filter((c) => !c.pass).map((c) => c.rule).sort().join(",");
      if (failedNow === lastFailed) { say(`  the repair failed the same rule(s) again (${failedNow}); stopping`); break; }
      lastFailed = failedNow;
      if (detRepairs >= MAX_DETERMINISTIC_REPAIRS) break;
      detRepairs += 1;
      repairKind = "deterministic";
      notes = deterministicNotes(qaReport);
      say(`  repairing: ${qaReport.deterministicChecks.filter((c) => !c.pass).map((c) => c.rule).join(", ")}`);
      continue;
    }

    if (!judge) break;
    qaReport = await judgeIfPassing(runDir, qaReport, say);
    const serious = qaReport.judge?.serious ?? [];
    if (!serious.length || compRepairs >= MAX_COMPOSITION_REPAIRS) break;
    compRepairs += 1;
    repairKind = "composition";
    lastFailed = null; // a new layout gets its own chance at the mechanical checks
    notes = compositionNotes(qaReport.judge);
    say(`  composition repair: ${serious.map((f) => f.rule).join(", ")}`);
  }

  if (detRepairs || compRepairs) {
    say(`  ${qaReport.verdict} after ${detRepairs} deterministic and ${compRepairs} composition repair(s)`);
  }
  const restored = restoreBestAttempt(runDir);
  if (restored) {
    qaReport = JSON.parse(readFileSync(join(runDir, "qa-report.json"), "utf8"));
    say(`  restored attempt ${restored}, which passed the gate; the later repair is shelved as abandoned`);
  }
  const ledgerLine = bundleRun(runDir);
  say(`bundled ${runDir}`);
  say(
    `  ${ledgerLine.verdict}: ${ledgerLine.checksPassed} checks passed, ${ledgerLine.checksFailed} failed, ` +
      `${ledgerLine.reviewFindings} review finding(s), ${ledgerLine.judgeSerious ?? "no"} serious judge finding(s), $${ledgerLine.costUsd}`,
  );
  return { runDir, qaReport, ledgerLine };
}

export const readRunRecord = (runDir) => JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
