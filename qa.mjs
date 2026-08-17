import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { reviewCompletion, usageCostUsd } from "./claude.mjs";

const pageRules = readFileSync(
  new URL("rules/page-rules.md", import.meta.url),
  "utf8",
);
const axeSource = fileURLToPath(
  new URL("node_modules/axe-core/axe.min.js", import.meta.url),
);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

// The deciding half of the gate, split out so evals/run_evals.mjs can measure it
// without spending a review token: every check here is local, so the suite runs
// offline and free.
export async function deterministicGate(runDir) {
  const pageHtml = readFileSync(join(runDir, "page.html"), "utf8");
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const allowedFontHosts = fontHosts(runRecord.brief.fontUrl);

  return [
    documentCheck(pageHtml),
    selfContainmentCheck(pageHtml, allowedFontHosts),
    await linkAuditCheck(pageHtml),
    ...(await renderChecks(runDir)),
  ];
}

export async function qaRun(runDir) {
  const pageHtml = readFileSync(join(runDir, "page.html"), "utf8");
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));

  const deterministicChecks = await deterministicGate(runDir);
  // Progress goes to stderr: mcp-server.mjs runs this over stdio, where
  // stdout carries the JSON-RPC stream and must stay clean.
  for (const check of deterministicChecks) {
    process.stderr.write(`  ${check.pass ? "pass" : "FAIL"}  ${check.name}\n`);
  }

  // The review is advisory by design; if it errors, the run keeps its
  // deterministic verdict and the report carries the error instead of findings.
  let claudeReview;
  try {
    claudeReview = await rulesReview(pageHtml, runRecord.brief);
    process.stderr.write(
      `  review: ${claudeReview.violationList.length} rule finding(s), advisory\n`,
    );
  } catch (reviewError) {
    claudeReview = { violationList: [], errored: reviewError.message, costUsd: 0 };
    process.stderr.write(`  review: errored, advisory skipped (${reviewError.message})\n`);
  }

  const qaReport = {
    runDir,
    checkedAt: new Date().toISOString(),
    verdict: deterministicChecks.every((check) => check.pass) ? "pass" : "fail",
    deterministicChecks,
    claudeReview,
  };
  writeFileSync(join(runDir, "qa-report.json"), JSON.stringify(qaReport, null, 2));
  return qaReport;
}

function fontHosts(fontUrl) {
  return fontUrl ? [new URL(fontUrl).host] : [];
}

function documentCheck(pageHtml) {
  const missing = [
    [/^\s*<!doctype html>/i, "doctype"],
    [/<html[^>]+lang\s*=/i, "html lang attribute"],
    [/<title>[^<]+<\/title>/i, "title"],
    [/<meta[^>]+name\s*=\s*["']viewport["']/i, "viewport meta"],
    [/<\/html>\s*$/i, "closing html tag"],
  ]
    .filter(([pattern]) => !pattern.test(pageHtml))
    .map(([, label]) => label);
  return {
    name: "document structure",
    rule: "valid-document",
    pass: missing.length === 0,
    details: missing.length ? `missing: ${missing.join(", ")}` : "ok",
  };
}

// Asset references (src, srcset, link href, css url(), @import) must stay local.
// Anchor hrefs are navigation, not assets; the link audit covers those.
function selfContainmentCheck(pageHtml, allowedFontHosts) {
  const offenses = [];
  if (/<script\b/i.test(pageHtml)) offenses.push("script tag (page must ship no JS)");

  const assetPatterns = [
    /\ssrc\s*=\s*["']([^"']+)["']/gi,
    /\ssrcset\s*=\s*["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?(https?:[^"')\s]+)/gi,
    /@import\s+["']?(https?:[^"')\s;]+)/gi,
  ];
  for (const pattern of assetPatterns) {
    for (const hit of pageHtml.matchAll(pattern)) {
      const assetUrl = hit[1];
      if (!/^https?:/i.test(assetUrl)) continue;
      if (!allowedFontHosts.includes(new URL(assetUrl).host)) {
        offenses.push(assetUrl);
      }
    }
  }
  return {
    name: "single file, no external assets",
    rule: "single-file",
    pass: offenses.length === 0,
    details: offenses.length ? offenses.join("; ") : "ok",
  };
}

async function linkAuditCheck(pageHtml) {
  const anchorUrls = [
    ...new Set(
      [...pageHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)]
        .map((hit) => hit[1])
        .filter((href) => /^https?:/i.test(href)),
    ),
  ];
  const brokenLinks = [];
  for (const linkUrl of anchorUrls) {
    const status = await probeLink(linkUrl);
    if (status >= 400) brokenLinks.push(`${linkUrl} (${status})`);
  }
  return {
    name: `link audit (${anchorUrls.length} external link${anchorUrls.length === 1 ? "" : "s"})`,
    rule: "cta-specific",
    pass: brokenLinks.length === 0,
    details: brokenLinks.length ? brokenLinks.join("; ") : "ok",
  };
}

async function probeLink(linkUrl) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const answer = await fetch(linkUrl, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      // Some servers reject HEAD outright; only then is GET worth the bytes.
      if (method === "HEAD" && (answer.status === 405 || answer.status === 403)) continue;
      return answer.status;
    } catch {
      if (method === "GET") return 599;
    }
  }
  return 599;
}

// Screenshots are a record of the run, not an input to any verdict, so a failed
// capture must never take the gate down with it. Chromium drops fullPage captures
// intermittently on very tall or very wide pages; that is a lost artifact, not a
// failed check.
async function capture(page, path) {
  try {
    await page.screenshot({ path, fullPage: true });
  } catch (captureError) {
    process.stderr.write(`  screenshot skipped (${captureError.message.split("\n")[0]})\n`);
  }
}

async function renderChecks(runDir) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(pathToFileURL(join(runDir, "page.html")).href);
    await capture(page, join(runDir, "page-1440.png"));

    // Rendered text, not source: copy tells are judged on what a reader sees,
    // so markup, CSS, and attribute values stay out of the scan.
    const renderedCopy = await page.evaluate(() => document.body.innerText);

    await page.addScriptTag({ path: axeSource });
    const axeFindings = await page.evaluate(() => window.axe.run(document));
    const blockingFindings = axeFindings.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact),
    );

    await page.setViewportSize(PHONE);
    await capture(page, join(runDir, "page-375.png"));
    // scrollWidth alone is defeatable: a page that sets overflow-x:hidden clamps it,
    // so the draft can silently switch off the check meant to catch its own overflow.
    // evals/ caught exactly that. Neutralise the clip (with !important, so a page rule
    // cannot win), then measure the real content extent from element boxes too.
    const overflowPx = await page.evaluate(() => {
      const root = document.documentElement;
      const restore = [root, document.body].map((el) => [el, el.getAttribute("style")]);
      for (const [el] of restore) el.style.setProperty("overflow-x", "visible", "important");

      const rightEdges = [...document.body.querySelectorAll("*")]
        .map((el) => Math.ceil(el.getBoundingClientRect().right))
        .filter(Number.isFinite);
      const contentWidth = Math.max(root.scrollWidth, ...rightEdges);

      for (const [el, style] of restore) {
        if (style === null) el.removeAttribute("style");
        else el.setAttribute("style", style);
      }
      return contentWidth - window.innerWidth;
    });

    return [
      {
        name: "no horizontal overflow at 375px",
        rule: "responsive",
        pass: overflowPx <= 0,
        details: overflowPx > 0 ? `page is ${overflowPx}px too wide` : "ok",
      },
      {
        name: "axe-core, no serious or critical violations",
        rule: "semantic-html / contrast-aa",
        pass: blockingFindings.length === 0,
        details: blockingFindings.length
          ? blockingFindings
              .map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)
              .join("; ")
          : `ok (${axeFindings.passes.length} rules passed)`,
      },
      copyTellsCheck(renderedCopy),
    ];
  } finally {
    await browser.close();
  }
}

const BANNED_COPY_WORDS = [
  "leverage", "seamless", "robust", "comprehensive", "streamline", "elevate",
  "unlock", "transform", "delve", "cutting-edge", "game-changer", "empower",
];

function copyTellsCheck(renderedCopy) {
  const tellPatterns = [
    /[\u2013\u2014]/g,
    new RegExp(`\\b(?:${BANNED_COPY_WORDS.join("|")})\\b`, "gi"),
    /\bin today[’']s\b/gi,
  ];
  const tellHits = [];
  for (const pattern of tellPatterns) {
    for (const hit of renderedCopy.matchAll(pattern)) {
      const excerpt = renderedCopy
        .slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 30)
        .replace(/\s+/g, " ")
        .trim();
      tellHits.push(`"${hit[0]}" in "...${excerpt}..."`);
    }
  }
  return {
    name: "copy tells (dashes, banned vocabulary)",
    rule: "copy-tells",
    pass: tellHits.length === 0,
    details: tellHits.length ? tellHits.join(" | ") : "ok",
  };
}

const reviewSchema = {
  type: "object",
  properties: {
    violations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          severity: { type: "string", enum: ["minor", "serious"] },
          excerpt: { type: "string" },
          reason: { type: "string" },
        },
        required: ["rule", "severity", "excerpt", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["violations"],
  additionalProperties: false,
};

const reviewSystemPrompt = `You review a drafted landing page against the rules
file below. Report only genuine violations, each citing the rule id it breaks,
a short excerpt of the offending markup or copy, and one sentence of reasoning.
An empty list is a valid and common answer. Do not invent violations to look
thorough, and do not flag things the rules do not cover.

<page-rules>
${pageRules}
</page-rules>`;

async function rulesReview(pageHtml, briefBody) {
  const userPrompt = `Brief:\n${JSON.stringify(briefBody, null, 2)}\n\nPage:\n${pageHtml}`;
  const { reviewText, usage } = await reviewCompletion(
    reviewSystemPrompt,
    userPrompt,
    reviewSchema,
  );
  return {
    violationList: validatedViolations(JSON.parse(reviewText)),
    usage,
    costUsd: usageCostUsd(usage),
  };
}

// The schema is enforced server side, but the gate re-checks the shape before
// trusting it: a refusal or truncation must fail loudly here, not downstream.
function validatedViolations(reviewBody) {
  if (!Array.isArray(reviewBody?.violations)) {
    throw new Error("review output missing violations array");
  }
  for (const finding of reviewBody.violations) {
    for (const field of ["rule", "severity", "excerpt", "reason"]) {
      if (typeof finding[field] !== "string") {
        throw new Error(`review finding missing string field: ${field}`);
      }
    }
  }
  return reviewBody.violations;
}
