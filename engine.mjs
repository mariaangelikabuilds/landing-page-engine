#!/usr/bin/env node
import { draftPage, readBrief } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { bundleRun } from "./bundle.mjs";
import { captureOutput } from "./log.mjs";

const usage = `usage:
  node engine.mjs run <brief-file>     draft, qa, bundle in one pass
  node engine.mjs draft <brief-file>   draft only, prints the run dir
  node engine.mjs qa <run-dir>         deterministic checks + model review
  node engine.mjs bundle <run-dir>     write qa-report.md, append runs.jsonl
`;

const [command, target] = process.argv.slice(2);
const transcript = captureOutput();
const say = (line) => process.stdout.write(line + "\n");
let lastRunDir = null;

async function draftStage(briefPath, prepared = null, repairNotes = "") {
  say(`drafting from ${briefPath}`);
  const { runDir, usage: draftUsage, context } = await draftPage(
    readBrief(briefPath), "out/runs", prepared, repairNotes,
  );
  say(`  wrote ${runDir}/page.html (${draftUsage.output_tokens} output tokens)`);
  lastRunDir = runDir;
  return { runDir, context };
}

// A failing check already knows exactly what is wrong and where. Handing that back is
// cheaper and more reliable than asking a person to run the command again, and it is the
// difference between an engine that drafts and one that ships.
const MAX_REPAIRS = 2;

function repairNotes(qaReport) {
  const failed = qaReport.deterministicChecks.filter((check) => !check.pass);
  return `

The previous attempt was REJECTED by the gate. Everything else about it was
acceptable, so change only what these findings name, and keep the art direction,
the palette, the typefaces and the section plan exactly as they are.

${failed.map((check) => `- ${check.rule}: ${check.details}`).join("\n")}`;
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

// exitCode, never process.exit(): a hard exit races Playwright's pipe
// teardown on Windows and crashes libuv instead of returning 1.
try {
  if (!target) {
    say(usage);
    process.exitCode = command ? 1 : 0;
  } else if (command === "run") {
    let prepared = null;
    let notes = "";
    let runDir;
    let qaReport;

    for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
      ({ runDir, context: prepared } = await draftStage(target, prepared, notes));
      qaReport = await qaStage(runDir);
      if (qaReport.verdict === "pass") {
        if (attempt) say(`  passed after ${attempt} repair${attempt === 1 ? "" : "s"}`);
        break;
      }
      if (attempt === MAX_REPAIRS) break;
      notes = repairNotes(qaReport);
      const named = qaReport.deterministicChecks.filter((c) => !c.pass).map((c) => c.rule);
      say(`  repairing: ${named.join(", ")}`);
    }

    const ledgerLine = bundleStage(runDir);
    process.exitCode = ledgerLine.verdict === "pass" ? 0 : 1;
  } else if (command === "draft") {
    await draftStage(target);
  } else if (command === "qa") {
    const qaReport = await qaStage(target);
    process.exitCode = qaReport.verdict === "pass" ? 0 : 1;
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
  transcript.flush(lastRunDir ?? (["qa", "bundle"].includes(command) ? target : null));
}
