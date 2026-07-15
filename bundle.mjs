import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export function bundleRun(runDir, ledgerPath = "out/runs.jsonl") {
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const qaReport = JSON.parse(readFileSync(join(runDir, "qa-report.json"), "utf8"));

  writeFileSync(join(runDir, "qa-report.md"), reportMarkdown(runRecord, qaReport));

  const passCount = qaReport.deterministicChecks.filter((check) => check.pass).length;
  const ledgerLine = {
    run: basename(runDir),
    finishedAt: new Date().toISOString(),
    brief: runRecord.brief.brand,
    model: runRecord.model,
    verdict: qaReport.verdict,
    checksPassed: passCount,
    checksFailed: qaReport.deterministicChecks.length - passCount,
    reviewFindings: qaReport.claudeReview.violationList.length,
    costUsd: Number(
      (runRecord.draftCostUsd + qaReport.claudeReview.costUsd).toFixed(4),
    ),
  };
  appendFileSync(ledgerPath, JSON.stringify(ledgerLine) + "\n");
  return ledgerLine;
}

function reportMarkdown(runRecord, qaReport) {
  const checkRows = qaReport.deterministicChecks
    .map(
      (check) =>
        `| ${check.pass ? "pass" : "**FAIL**"} | ${check.name} | \`${check.rule}\` | ${check.details} |`,
    )
    .join("\n");

  const findingRows = qaReport.claudeReview.violationList.length
    ? qaReport.claudeReview.violationList
        .map(
          (finding) =>
            `- **${finding.rule}** (${finding.severity}): ${finding.reason}\n  > ${finding.excerpt}`,
        )
        .join("\n")
    : "None reported.";

  return `# QA report: ${runRecord.brief.brand}

- Verdict: **${qaReport.verdict}** (deterministic checks decide; the model review below is advisory)
- Drafted by ${runRecord.model} at ${runRecord.startedAt}
- Checked at ${qaReport.checkedAt}
- Cost: $${(runRecord.draftCostUsd + qaReport.claudeReview.costUsd).toFixed(4)} (draft $${runRecord.draftCostUsd.toFixed(4)}, review $${qaReport.claudeReview.costUsd.toFixed(4)})
- Screenshots: page-1440.png, page-375.png

## Deterministic checks

| Result | Check | Rule | Details |
|---|---|---|---|
${checkRows}

## Model review (advisory)

${findingRows}
`;
}
