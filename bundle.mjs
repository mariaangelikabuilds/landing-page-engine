import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const money = (n) => `$${Number(n ?? 0).toFixed(4)}`;

// Every model call a run paid for, in one number. Before 2026-09-14 the ledger summed the
// final draft and its review only, so a repaired run under-reported by its earlier drafts
// and the direction stage was never counted at all.
function runCost(runRecord, qaReport) {
  const attempts = runRecord.attempts ?? [];
  const earlierDrafts = attempts.reduce((sum, a) => sum + (a.draftCostUsd ?? 0) + (a.reviewCostUsd ?? 0) + (a.judgeCostUsd ?? 0), 0);
  return (
    (runRecord.directionCostUsd ?? 0) +
    earlierDrafts +
    (runRecord.draftCostUsd ?? 0) +
    (qaReport.claudeReview?.costUsd ?? 0) +
    (qaReport.judge?.costUsd ?? 0)
  );
}

export function bundleRun(runDir, ledgerPath = "out/runs.jsonl") {
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const qaReport = JSON.parse(readFileSync(join(runDir, "qa-report.json"), "utf8"));

  writeFileSync(join(runDir, "qa-report.md"), reportMarkdown(runRecord, qaReport));

  const passCount = qaReport.deterministicChecks.filter((check) => check.pass).length;
  const attempts = runRecord.attempts ?? [];
  const ledgerLine = {
    run: basename(runDir),
    finishedAt: new Date().toISOString(),
    brief: runRecord.brief.brand,
    model: runRecord.model,
    verdict: qaReport.verdict,
    checksPassed: passCount,
    checksFailed: qaReport.deterministicChecks.length - passCount,
    reviewFindings: qaReport.claudeReview.violationList.length,
    reviewErrored: qaReport.claudeReview.errored ?? null,
    judgeSerious: qaReport.judge?.serious?.length ?? null,
    judgeErrored: qaReport.judge?.errored ?? null,
    attempts: attempts.length + 1,
    compositionRepairs: attempts.filter((a) => a.kind === "composition").length,
    costUsd: Number(runCost(runRecord, qaReport).toFixed(4)),
  };
  appendFileSync(ledgerPath, JSON.stringify(ledgerLine) + "\n");
  return ledgerLine;
}

function findingLines(findings, render) {
  return findings.length ? findings.map(render).join("\n") : "None reported.";
}

function reportMarkdown(runRecord, qaReport) {
  const checkRows = qaReport.deterministicChecks
    .map(
      (check) =>
        `| ${check.pass ? "pass" : "**FAIL**"} | ${check.name} | \`${check.rule}\` | ${check.details} |`,
    )
    .join("\n");

  const review = qaReport.claudeReview;
  const reviewBody = review.errored
    ? `Review ERRORED: ${review.errored}. No findings were produced; this is not a clean review.`
    : findingLines(review.violationList, (f) => `- **${f.rule}** (${f.severity}): ${f.reason}\n  > ${f.excerpt}`);

  const judge = qaReport.judge;
  const judgeBody = !judge
    ? "Not run."
    : judge.errored
      ? `Judge ERRORED: ${judge.errored}.`
      : findingLines(judge.findings ?? [], (f) => `- **${f.rule}** (${f.severity}, ${f.viewport}px tile ${f.tile}, ${f.section}): ${f.reason}`) +
        (judge.overall ? `\n\n${judge.overall}` : "");

  const advisory = qaReport.compositionAdvisory ?? [];
  const advisoryRows = advisory.length
    ? advisory.map((m) => `| \`${m.rule}\` | ${m.value} | ${m.details} |`).join("\n")
    : "";

  const attempts = runRecord.attempts ?? [];
  const attemptLines = attempts.length
    ? attempts.map((a, i) => `- attempt ${i + 1} (${a.kind} repair followed): ${a.verdict}, draft ${money(a.draftCostUsd)}`).join("\n") +
      `\n- attempt ${attempts.length + 1}: ${qaReport.verdict}, draft ${money(runRecord.draftCostUsd)}`
    : "";

  return `# QA report: ${runRecord.brief.brand}

- Verdict: **${qaReport.verdict}** (deterministic checks decide; the review and the judge below are advisory)
- Drafted by ${runRecord.model} at ${runRecord.startedAt}
- Checked at ${qaReport.checkedAt}
- Cost: ${money(runCost(runRecord, qaReport))} (direction ${money(runRecord.directionCostUsd)}, draft ${money(runRecord.draftCostUsd)}, review ${money(review.costUsd)}, judge ${money(judge?.costUsd)}${attempts.length ? `, earlier attempts included` : ""})
- Screenshots: page-1440.png, page-375.png
${attemptLines ? `\n## Attempts\n\n${attemptLines}\n` : ""}
## Deterministic checks

| Result | Check | Rule | Details |
|---|---|---|---|
${checkRows}
${advisoryRows ? `\n## Advisory composition metrics\n\nMeasured, not gated. Recorded so the thresholds can be calibrated on real runs.\n\n| Rule | Value | Details |\n|---|---|---|\n${advisoryRows}\n` : ""}
## Composition judge (advisory)

${judgeBody}

## Model review (advisory)

${reviewBody}
`;
}
