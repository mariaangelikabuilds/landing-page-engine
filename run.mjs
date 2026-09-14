import { readFileSync, writeFileSync } from "node:fs";
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
const MAX_DETERMINISTIC_REPAIRS = 2;
const MAX_COMPOSITION_REPAIRS = 2;

// A failing check already knows exactly what is wrong and where. Handing that back is
// cheaper and more reliable than asking a person to run the command again, and it is the
// difference between an engine that drafts and one that ships.
function deterministicNotes(qaReport) {
  const failed = qaReport.deterministicChecks.filter((check) => !check.pass);
  return `

The previous attempt was REJECTED by the gate. Everything else about it was
acceptable, so change only what these findings name, and keep the art direction,
the palette, the typefaces and the section plan exactly as they are.

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

export async function runBrief(briefBody, { outRoot = "out/runs", say = () => {}, judge = true } = {}) {
  let prepared = null;
  let runDir = null;
  let notes = "";
  let repairKind = null;
  let detRepairs = 0;
  let compRepairs = 0;
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
    notes = compositionNotes(qaReport.judge);
    say(`  composition repair: ${serious.map((f) => f.rule).join(", ")}`);
  }

  if (detRepairs || compRepairs) {
    say(`  ${qaReport.verdict} after ${detRepairs} deterministic and ${compRepairs} composition repair(s)`);
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
