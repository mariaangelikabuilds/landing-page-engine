#!/usr/bin/env node
import { draftPage, readBrief } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { bundleRun } from "./bundle.mjs";

const usage = `usage:
  node engine.mjs run <brief-file>     draft, qa, bundle in one pass
  node engine.mjs draft <brief-file>   draft only, prints the run dir
  node engine.mjs qa <run-dir>         deterministic checks + model review
  node engine.mjs bundle <run-dir>     write qa-report.md, append runs.jsonl
`;

const [command, target] = process.argv.slice(2);
const say = (line) => process.stdout.write(line + "\n");

async function draftStage(briefPath) {
  say(`drafting from ${briefPath}`);
  const { runDir, usage: draftUsage } = await draftPage(readBrief(briefPath));
  say(`  wrote ${runDir}/page.html (${draftUsage.output_tokens} output tokens)`);
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

try {
  if (!target) {
    say(usage);
    process.exit(command ? 1 : 0);
  } else if (command === "run") {
    const runDir = await draftStage(target);
    await qaStage(runDir);
    const ledgerLine = bundleStage(runDir);
    process.exit(ledgerLine.verdict === "pass" ? 0 : 1);
  } else if (command === "draft") {
    await draftStage(target);
  } else if (command === "qa") {
    const qaReport = await qaStage(target);
    process.exit(qaReport.verdict === "pass" ? 0 : 1);
  } else if (command === "bundle") {
    bundleStage(target);
  } else {
    say(usage);
    process.exit(1);
  }
} catch (failure) {
  process.stderr.write(`engine: ${failure.message}\n`);
  process.exit(1);
}
