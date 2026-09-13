import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { compositionChecks, compositionMetrics } from "./qa-composition.mjs";
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
  return (await deterministicGateFull(runDir)).checks;
}

// The composition metrics ride along with the checks: advisory entries never decide a
// verdict, but the report keeps them so a page's composition can be read back later.
export async function deterministicGateFull(runDir) {
  const pageHtml = readFileSync(join(runDir, "page.html"), "utf8");
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const allowedFontHosts = fontHosts(runRecord.brief.fontUrl);
  const rendered = await renderChecks(runDir, runRecord.direction);

  return {
    checks: [
      documentCheck(pageHtml),
      selfContainmentCheck(pageHtml, allowedFontHosts),
      contactIntegrityCheck(pageHtml, runRecord.brief),
      paletteFidelityCheck(pageHtml, runRecord.brief),
      typeDirectedCheck(pageHtml, runRecord.direction),
      imageryResolvedCheck(pageHtml),
      sideStripeCheck(pageHtml),
      pageWeightCheck(pageHtml),
      await linkAuditCheck(pageHtml),
      ...rendered.checks,
    ],
    advisory: rendered.advisory,
    metrics: rendered.metrics,
  };
}

export async function qaRun(runDir) {
  const pageHtml = readFileSync(join(runDir, "page.html"), "utf8");
  const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));

  const { checks: deterministicChecks, advisory, metrics } = await deterministicGateFull(runDir);
  // Progress goes to stderr: mcp-server.mjs runs this over stdio, where
  // stdout carries the JSON-RPC stream and must stay clean.
  for (const check of deterministicChecks) {
    process.stderr.write(`  ${check.pass ? "pass" : "FAIL"}  ${check.name}\n`);
  }
  for (const note of advisory) {
    process.stderr.write(`  info  ${note.rule}: ${note.details}\n`);
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
    compositionAdvisory: advisory,
    compositionMetrics: metrics,
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

// tel: and mailto: are the one place a page looks perfect and is still wrong: the label
// reads correctly while the href quietly drops a character. Two runs of the demo brief
// produced a tel: href missing a digit, in different positions, and the advisory review
// caught it only once. Comparing digits is exact, so it belongs in the deciding half
// rather than in a model's judgement.
const digitsOf = (value) => (value || "").replace(/\D/g, "");

function contactIntegrityCheck(pageHtml, briefBody) {
  const contact = briefBody?.contact ?? {};
  const anchors = [
    ...pageHtml.matchAll(
      /<a\b[^>]*\bhref\s*=\s*["'](tel:|mailto:)([^"']+)["'][^>]*>(.*?)<\/a>/gis,
    ),
  ];

  const offenses = anchors.flatMap(([, scheme, target, rawLabel]) => {
    const label = rawLabel.replace(/<[^>]+>/g, "").trim();
    if (scheme === "tel:") {
      const href = digitsOf(target);
      return [
        digitsOf(label) && href !== digitsOf(label)
          ? `tel: href has digits ${href}, its own label reads ${digitsOf(label)}`
          : null,
        contact.phone && href !== digitsOf(contact.phone)
          ? `tel: href has digits ${href}, the brief says ${digitsOf(contact.phone)}`
          : null,
        // Once the digits had to match, the drafter started pasting the display string
        // into the href, spaces and all. RFC 3966 allows "-", ".", "(" and ")" as visual
        // separators; a space is not one, and an unencoded space is not a valid URL.
        /\s/.test(target)
          ? `tel: href "${target}" contains a space, which is not a valid separator`
          : null,
      ].filter(Boolean);
    }
    const href = target.trim().toLowerCase();
    // Compare against the address inside the label, not the whole label: a button
    // reading "Email hello@x.ph" is correct, and demanding equality would fail it.
    const labelAddress = label.match(/[^\s<>()]+@[^\s<>()]+/)?.[0].toLowerCase();
    return [
      labelAddress && labelAddress !== href
        ? `mailto: href ${href} does not match the address in its label, ${labelAddress}`
        : null,
      contact.email && href !== contact.email.toLowerCase()
        ? `mailto: href ${href} does not match the brief address ${contact.email}`
        : null,
    ].filter(Boolean);
  });

  const unique = [...new Set(offenses)];
  return {
    name: `contact integrity (${anchors.length} tel/mailto link${anchors.length === 1 ? "" : "s"})`,
    rule: "contact-integrity",
    pass: unique.length === 0,
    details: unique.length ? unique.join("; ") : "ok",
  };
}

// Embedding images keeps the page one file, which is the point, but base64 costs a third
// more than the bytes it encodes and there is no cache to save it. A generated PNG came
// back at 2MB and would have shipped as a 2MB landing page. The budget is the check.
const PAGE_BUDGET_KB = 900;

// A coloured stripe down one edge of a card, callout or list item is the single most
// recognisable generated-UI pattern there is: shadcn Alert, the Vercel docs callout, the
// Notion callout, every "tip box" a model has ever produced. A hairline is a rule and is
// fine; anything thicker on one edge only is the tell. The direction stage produced one
// on its first good page, which is how this check exists.
function sideStripeCheck(pageHtml) {
  const stripes = [
    ...pageHtml.matchAll(
      /border-(left|right|inline-start|inline-end)\s*:\s*([0-9.]+)px\b[^;]*/gi,
    ),
  ]
    .filter((hit) => Number(hit[2]) > 1)
    .map((hit) => hit[0].trim());

  const unique = [...new Set(stripes)];
  return {
    name: "no single-edge accent stripes",
    rule: "no-side-stripe",
    pass: unique.length === 0,
    details: unique.length ? unique.join("; ") : "ok",
  };
}

function pageWeightCheck(pageHtml) {
  const kb = Math.round(Buffer.byteLength(pageHtml, "utf8") / 1024);
  return {
    name: `page weight (${kb}kb of ${PAGE_BUDGET_KB}kb)`,
    rule: "page-weight",
    pass: kb <= PAGE_BUDGET_KB,
    details: kb <= PAGE_BUDGET_KB ? "ok" : `${kb}kb, over budget by ${kb - PAGE_BUDGET_KB}kb`,
  };
}

// An unresolved {{IMAGE:}} placeholder renders as a broken image with the instruction
// still sitting in the src. single-file cannot catch it, because a placeholder is not an
// http URL and gets skipped as a local path would be.
function imageryResolvedCheck(pageHtml) {
  const left = [...pageHtml.matchAll(/\{\{IMAGE:\s*([^}]+?)\s*\}\}/g)].map((hit) =>
    hit[1].slice(0, 50),
  );
  const unique = [...new Set(left)];
  return {
    name: "no unresolved image placeholders",
    rule: "imagery-resolved",
    pass: unique.length === 0,
    details: unique.length ? `still unresolved: ${unique.join("; ")}` : "ok",
  };
}

// Art direction picks the two families and the pipeline embeds them, so a page that
// quietly falls back to a system stack has thrown away the one decision that separates a
// designed page from a competent one. Whether the family is referenced is exact.
function typeDirectedCheck(pageHtml, direction) {
  const wanted = [direction?.type?.displayFamily, direction?.type?.bodyFamily].filter(Boolean);
  if (!wanted.length) {
    return { name: "type follows direction (no direction on record)", rule: "type-deliberate", pass: true, details: "skipped" };
  }
  const declarations = pageHtml.match(/font-family:[^;}]+/gi)?.join(" ").toLowerCase() ?? "";
  const missing = [...new Set(wanted)].filter((family) => !declarations.includes(family.toLowerCase()));
  return {
    name: `type follows direction (${[...new Set(wanted)].join(", ")})`,
    rule: "type-deliberate",
    pass: missing.length === 0,
    details: missing.length ? `directed family never referenced: ${missing.join(", ")}` : "ok",
  };
}

// When the brief hands over hex values, using them is a comparison, not a judgement.
// The advisory review caught two separate drafts quietly substituting a darker rust for
// the brand accent, which is the same shape as the tel: digit drop: the page looks right
// and is wrong. Shades derived from a brief colour are fine; the brief colour going
// missing entirely is not.
function paletteFidelityCheck(pageHtml, briefBody) {
  const wanted = briefBody?.palette ?? [];
  const source = pageHtml.toLowerCase();
  const missing = wanted.filter((hex) => !source.includes(hex.toLowerCase()));
  return {
    name: `palette fidelity (${wanted.length} brief colour${wanted.length === 1 ? "" : "s"})`,
    rule: "palette-from-brief",
    pass: missing.length === 0,
    details: missing.length ? `never used: ${missing.join(", ")}` : "ok",
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
// Entrance animations meant the 1440 capture was taken mid-flight: the first animated
// draft screenshotted its hero headline part way through a fade and looked broken while
// the page was fine. Let animations land first, with a cap so an infinite one cannot
// hang the run.
async function settleAnimations(page, capMs = 1500) {
  await page.evaluate(async (cap) => {
    const running = document.getAnimations().map((a) => a.finished.catch(() => {}));
    await Promise.race([
      Promise.all(running),
      new Promise((done) => setTimeout(done, cap)),
    ]);
  }, capMs);
}

async function capture(page, path) {
  try {
    await settleAnimations(page);
    await page.screenshot({ path, fullPage: true });
  } catch (captureError) {
    process.stderr.write(`  screenshot skipped (${captureError.message.split("\n")[0]})\n`);
  }
}

// Walks the page a viewport at a time so scroll-driven timelines actually run before
// anything is judged, then reports text that is still invisible. Elements never reached
// by the walk are checked at the end, which is what catches display:none.
async function invisibleText(page) {
  return page.evaluate(async () => {
    const settle = (ms) => new Promise((done) => setTimeout(done, ms));
    const isVisible = (el) =>
      el.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      });
    const label = (el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) ||
      el.tagName.toLowerCase();

    // SCRIPT, STYLE and friends hold text nodes and never render. Counting them makes
    // any injected style block read as hidden content.
    const notRendered = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
    const texts = [...document.body.querySelectorAll("*")]
      .filter((el) => !notRendered.has(el.tagName))
      .filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      );
    const hidden = new Set();
    const judged = new Set();

    for (let y = 0; y <= document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await settle(350);
      for (const el of texts) {
        if (judged.has(el)) continue;
        const box = el.getBoundingClientRect();
        if (box.top >= window.innerHeight || box.bottom <= 0) continue;
        judged.add(el);
        if (!isVisible(el) || box.width === 0 || box.height === 0) hidden.add(label(el));
      }
    }
    // Anything the walk never saw was never on the canvas at all.
    for (const el of texts) {
      if (judged.has(el)) continue;
      const box = el.getBoundingClientRect();
      if (!isVisible(el) || box.width === 0 || box.height === 0) hidden.add(label(el));
    }
    window.scrollTo(0, 0);
    return [...hidden];
  });
}

async function motionVisibleCheck(page, pageUrl) {
  const withMotion = await invisibleText(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pageUrl);
  const reduced = await invisibleText(page);
  await page.emulateMedia({ reducedMotion: null });
  await page.goto(pageUrl);

  const offenses = [
    ...withMotion.map((t) => `invisible on load: "${t}"`),
    ...reduced.map((t) => `invisible under reduced motion: "${t}"`),
  ];
  const unique = [...new Set(offenses)];
  return {
    name: "no content hidden by animation (normal and reduced motion)",
    rule: "motion-visible",
    pass: unique.length === 0,
    details: unique.length ? unique.join("; ") : "ok",
  };
}

async function renderChecks(runDir, direction) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: DESKTOP });
    const pageUrl = pathToFileURL(join(runDir, "page.html")).href;
    await page.goto(pageUrl);
    await capture(page, join(runDir, "page-1440.png"));

    // Composition is measured on the settled desktop render. It scrolls and briefly
    // resizes to 375, then restores 1440; the motion check reloads the page after it,
    // so nothing it does leaks into the checks below.
    const metrics = await compositionMetrics(page);
    const composition = compositionChecks(metrics, direction);

    const motionCheck = await motionVisibleCheck(page, pageUrl);

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

    const checks = [
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
      motionCheck,
      ...composition.gate,
    ];
    return { checks, advisory: composition.advisory, metrics };
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

// Embedded images are megabytes of base64 that mean nothing to a reader of the markup.
// Sent raw they took one review past 1.9M tokens against a 1M ceiling and killed the
// pass outright. The reviewer needs to know an image is there, not what it encodes.
// Fonts too: rules 1.6.0 embedded 150kb of woff2 per page and the review was reading
// every byte of it, which is where the $0.44 reviews and the "terminated" streams came from.
const withoutImageData = (pageHtml) =>
  pageHtml.replace(
    /data:(image|font)\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+/gi,
    (blob, kind) => `data:${kind}/…;base64,[${Math.round(blob.length / 1024)}kb ${kind} elided]`,
  );

async function rulesReview(pageHtml, briefBody) {
  const userPrompt = `Brief:\n${JSON.stringify(briefBody, null, 2)}\n\nPage:\n${withoutImageData(pageHtml)}`;
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
