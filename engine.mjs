#!/usr/bin/env node
import { draftPage, readBrief } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { bundleRun } from "./bundle.mjs";
import { judgeRun } from "./judge.mjs";
import { runBrief } from "./run.mjs";
import { captureOutput } from "./log.mjs";

const usage = `usage:
  node engine.mjs run <brief-file>     direct, draft, gate, judge, repair, bundle in one pass
  node engine.mjs draft <brief-file>   draft only, prints the run dir
  node engine.mjs qa <run-dir>         deterministic checks + model review
  node engine.mjs judge <run-dir>      composition judge on the rendered page, writes judge.json
  node engine.mjs bundle <run-dir>     write qa-report.md, append runs.jsonl
`;

const [command, target] = process.argv.slice(2);
const transcript = captureOutput();
const say = (line) => process.stdout.write(line + "\n");
let lastRunDir = null;

async function draftStage(briefPath) {
  say(`drafting from ${briefPath}`);
  const { runDir, usage: draftUsage } = await draftPage(readBrief(briefPath), "out/runs");
  say(`  wrote ${runDir}/page.html (${draftUsage.output_tokens} output tokens)`);
  lastRunDir = runDir;
  return runDir;
}

async function qaStage(runDir) {
  say(`qa on ${runDir}`);
  const qaReport = await qaRun(runDir);
  say(`  verdict: ${qaReport.verdict}`);
  return qaReport;
}

function bundleStage(runDir) {
  const ledgerLine = bundleRun(runDir);
  say(`bundled ${runDir}`);
  say(
    `  ${ledgerLine.verdict}: ${ledgerLine.checksPassed} checks passed, ` +
      `${ledgerLine.checksFailed} failed, ${ledgerLine.reviewFindings} review finding(s), ` +
      `$${ledgerLine.costUsd}`,
  );
  return ledgerLine;
}

// Advisory: prints what the judge saw and never sets the exit code.
async function judgeStage(runDir) {
  say(`judging ${runDir}`);
  const report = await judgeRun(runDir);
  for (const f of report.findings) {
    say(`  ${f.severity}  ${f.rule} [${f.viewport}px tile ${f.tile}, ${f.section}]: ${f.reason}`);
  }
  say(`  ${report.overall}`);
  const minor = report.findings.length - report.serious.length;
  say(`  judge: ${report.serious.length} serious, ${minor} minor, $${report.costUsd.toFixed(4)}`);
}

// exitCode, never process.exit(): a hard exit races Playwright's pipe
// teardown on Windows and crashes libuv instead of returning 1.
try {
  if (!target) {
    say(usage);
    process.exitCode = command ? 1 : 0;
  } else if (command === "run") {
    // The loop lives in run.mjs so the MCP server runs the same one. `say` also tracks
    // the run dir for the transcript, since a repair reuses it.
    const { ledgerLine } = await runBrief(readBrief(target), {
      say: (line) => { say(line); const hit = line.match(/out[\\/]runs[\\/][^\s/\\]+/); if (hit) lastRunDir = hit[0]; },
    });
    process.exitCode = ledgerLine.verdict === "pass" ? 0 : 1;
  } else if (command === "draft") {
    await draftStage(target);
  } else if (command === "qa") {
    const qaReport = await qaStage(target);
    process.exitCode = qaReport.verdict === "pass" ? 0 : 1;
  } else if (command === "judge") {
    await judgeStage(target);
  } else if (command === "bundle") {
    bundleStage(target);
  } else {
    say(usage);
    process.exitCode = 1;
  }
} catch (failure) {
  process.stderr.write(`engine: ${failure.message}\n`);
  process.exitCode = 1;
} finally {
  transcript.flush(lastRunDir ?? (["qa", "judge", "bundle"].includes(command) ? target : null));
}
