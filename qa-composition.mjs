// Composition metrics, measured on text ink and image boxes rather than element boxes.
// The browser half collects raw facts at 1440 after the page has settled; the Node half
// turns them into numbers and into gate / advisory checks in the qa.mjs check shape.
// Offline: nothing here touches the API.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Gate thresholds, calibrated 2026-09-14 on 19 runs (evals/calibrate.mjs).
const HERO_CTA_1440 = 1; // exactly this many CTAs above the fold at 1440
const HERO_CTA_375_MIN = 1; // at least this many above the fold at 375
const DECORATIVE_LABELS_MAX = 0;
const MEASURE_MAX_CPL = 80;
const TYPE_SCALE_RATIO_MIN = 4;
const TYPE_SCALE_COUNT_MIN = 5;
const DARK_LUMINANCE = 0.4;
// Advisory thresholds. Informational only; pass on these never decides a verdict.
const STRANDED_SHARE_MAX = 1 / 3;
const STRANDED_CONSECUTIVE_MAX = 2;
const UNIFORM_INSET_SHARE_MAX = 0.6;
// ponytail: density has no calibrated line yet; 0.5 means "no section is twice as
// dense as the sparsest". Move it once labels carry a density tag.
const DENSITY_RATIO_MAX = 0.5;
const STRANDED_LEFT_MAX = 0.3;
const STRANDED_GAP_MIN = 0.2;
const OFF_GRID_SHIFT = 0.08;
const FULL_BLEED_MIN = 0.98;
const INSET_STEP = 8;
const MIN_SECTIONS = 3;
const FALLBACK_MIN_HEIGHT = 40;
const MEASURE_MIN_CHARS = 120;
const MEASURE_TAGS = new Set(["P", "LI", "DD", "TD", "FIGCAPTION", "BLOCKQUOTE", "DIV", "SPAN"]);
const NUMBERED_HEADING = /^\s*(\d{1,2}|0\d)[.)\/\s–-]+\S/;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

export async function measureRun(runDir) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(pathToFileURL(join(runDir, "page.html")).href);
    return await compositionMetrics(page);
  } finally {
    await browser.close();
  }
}

// Expects the page open at 1440x900. Resizes to 375 for the phone CTA count and
// restores the desktop viewport before returning, so the caller's page is unchanged.
export async function compositionMetrics(page) {
  await settle(page);
  const raw = await page.evaluate(collectRaw);
  await page.setViewportSize(PHONE);
  const phoneCtas = await page.evaluate(collectCtas);
  await page.setViewportSize(DESKTOP);
  return metricsFrom(raw, phoneCtas);
}

export function compositionChecks(metrics, direction) {
  return { gate: gateChecks(metrics, direction), advisory: advisoryChecks(metrics) };
}

// Same settle as qa.mjs capture(): let animations land (capped), then walk the page
// once so scroll-driven timelines run, then return to the top so viewport coordinates
// equal page coordinates for every measurement that follows.
async function settle(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    await document.fonts.ready;
    const running = document.getAnimations().map((a) => a.finished.catch(() => {}));
    await Promise.race([Promise.all(running), wait(1500)]);
    for (let y = 0; y <= document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await wait(350);
    }
    window.scrollTo(0, 0);
    await wait(350);
  });
}

// Runs in the browser. One closure so the helpers are shared; each inner function stays small.
function collectRaw() {
  const notRendered = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
  const isVisible = (el) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const sx = window.scrollX;
  const sy = window.scrollY;
  const pageRect = (r) => ({ left: r.left + sx, right: r.right + sx, top: r.top + sy, bottom: r.bottom + sy });
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const directText = (el) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();

  const parseColor = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    return { key: `${r},${g},${b}`, alpha: a, luminance: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) };
  };
  const effectiveBackground = (start) => {
    for (let el = start; el; el = el.parentElement) {
      const color = parseColor(getComputedStyle(el).backgroundColor);
      if (color.alpha > 0) return color;
    }
    return parseColor("#ffffff");
  };

  const inkRects = () => {
    const ink = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent.trim() || !parent || notRendered.has(parent.tagName) || !isVisible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) ink.push(pageRect(r));
    }
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (isVisible(img) && r.width > 0 && r.height > 0) ink.push(pageRect(r));
    }
    return ink;
  };

  const sectionElements = () => {
    const top = [...document.querySelectorAll("section")].filter((s) => !s.parentElement.closest("section"));
    if (top.length >= 3) return top;
    const root = document.body;
    return [...root.children].filter((el) => isVisible(el) && el.getBoundingClientRect().height > 40);
  };
  const viewportWidth = document.documentElement.clientWidth;
  const bodyBg = effectiveBackground(document.body);
  const sections = sectionElements().map((el) => {
    const r = pageRect(el.getBoundingClientRect());
    const own = parseColor(getComputedStyle(el).backgroundColor);
    const heading = el.querySelector("h1,h2,h3,h4,h5,h6");
    return {
      name: (heading?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) || el.tagName.toLowerCase(),
      top: r.top,
      bottom: r.bottom,
      width: r.right - r.left,
      area: (r.right - r.left) * (r.bottom - r.top),
      textLength: el.innerText.length,
      luminance: effectiveBackground(el).luminance,
      fullBleed: own.alpha > 0 && own.key !== bodyBg.key && r.right - r.left >= viewportWidth * 0.98,
    };
  });

  const avgCharWidth = (cs) => {
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (ctx.font === "10px sans-serif") ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText("abcdefghijklmnopqrstuvwxyz ").width / 27;
  };
  const textElements = [...document.body.querySelectorAll("*")]
    .filter((el) => !notRendered.has(el.tagName) && directText(el) && isVisible(el))
    .map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const own = directText(el);
      const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
        .reduce((sum, prop) => sum + (parseFloat(cs[prop]) || 0), 0);
      return {
        tag: el.tagName,
        fontSize: parseFloat(cs.fontSize),
        letterSpacing: parseFloat(cs.letterSpacing) || 0,
        textTransform: cs.textTransform,
        fontVariant: `${cs.fontVariant} ${cs.fontVariantCaps}`,
        ownLength: own.length,
        ownText: own.slice(0, 40),
        contentWidth: r.width - chrome,
        avgCharWidth: avgCharWidth(cs),
      };
    });

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(isVisible)
    .map((h) => h.textContent.replace(/\s+/g, " ").trim().slice(0, 60));

  return { viewportWidth, sections, ink: inkRects(), textElements, headings, ctas: collectCtasIn(document) };

  function collectCtasIn(doc) {
    const root = doc.body; // the hero sits in <header> as often as in <main>
    return [...root.querySelectorAll("a[href]")]
      .filter((a) => /^(mailto:|tel:|https?:)/i.test(a.getAttribute("href")))
      // A hero inside <header> is the common case; only nav and footer are chrome.
      .filter((a) => !a.closest("nav,footer") && isVisible(a))
      .map((a) => ({ href: a.getAttribute("href"), top: a.getBoundingClientRect().top + window.scrollY }));
  }
}

// Runs in the browser after the 375 resize; two frames so layout has reflowed.
async function collectCtas() {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const isVisible = (el) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const root = document.body;
  return [...root.querySelectorAll("a[href]")]
    .filter((a) => /^(mailto:|tel:|https?:)/i.test(a.getAttribute("href")))
    .filter((a) => !a.closest("nav,footer") && isVisible(a))
    .map((a) => ({ href: a.getAttribute("href"), top: a.getBoundingClientRect().top + window.scrollY }));
}

const finite = (values) => values.filter(Number.isFinite);
const minOf = (values) => (finite(values).length ? Math.min(...finite(values)) : null);
const maxOf = (values) => (finite(values).length ? Math.max(...finite(values)) : null);
const round = (value, places = 3) => (Number.isFinite(value) ? Number(value.toFixed(places)) : null);

function modeOf(values) {
  const counts = new Map();
  for (const v of finite(values)) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function sectionMetrics(section, ink, W) {
  const inBand = ink.filter((r) => {
    const cy = (r.top + r.bottom) / 2;
    return cy >= section.top && cy < section.bottom;
  });
  const inkLeft = minOf(inBand.map((r) => r.left));
  const inkRight = maxOf(inBand.map((r) => r.right));
  const firstInkTop = minOf(inBand.map((r) => r.top));
  const stranded =
    inkLeft !== null && inkLeft / W < STRANDED_LEFT_MAX && (W - inkRight - inkLeft) / W > STRANDED_GAP_MIN;
  return {
    name: section.name,
    top: Math.round(section.top),
    inkLeft: inkLeft === null ? null : round(inkLeft / W),
    inkRight: inkRight === null ? null : round(inkRight / W),
    inkLeftPx: inkLeft,
    stranded,
    inset: firstInkTop === null ? null : Math.round((firstInkTop - section.top) / INSET_STEP) * INSET_STEP,
    density: section.area > 0 ? round(section.textLength / (section.area / 10000), 2) : null,
    luminance: round(section.luminance),
    fullBleed: section.fullBleed,
    area: section.area,
  };
}

function strandedMetrics(sections) {
  let run = 0;
  let maxConsecutive = 0;
  for (const s of sections) {
    run = s.stranded ? run + 1 : 0;
    maxConsecutive = Math.max(maxConsecutive, run);
  }
  const stranded = sections.filter((s) => s.stranded).length;
  return { strandedCount: stranded, strandedShare: sections.length ? round(stranded / sections.length) : null, strandedMaxConsecutive: maxConsecutive };
}

function layoutMetrics(sections, W) {
  const modalInset = modeOf(sections.map((s) => s.inset));
  const withInset = sections.filter((s) => s.inset !== null);
  const modalInkLeft = modeOf(sections.map((s) => (s.inkLeftPx === null ? null : Math.round(s.inkLeftPx / INSET_STEP) * INSET_STEP)));
  const offGrid = sections.filter(
    (s) => s.fullBleed || (s.inkLeftPx !== null && Math.abs(s.inkLeftPx - modalInkLeft) > OFF_GRID_SHIFT * W),
  ).length;
  const densities = sections.map((s) => s.density);
  const totalArea = sections.reduce((sum, s) => sum + s.area, 0);
  const darkArea = sections.filter((s) => s.luminance < DARK_LUMINANCE).reduce((sum, s) => sum + s.area, 0);
  return {
    uniformInsetShare: withInset.length ? round(withInset.filter((s) => s.inset === modalInset).length / withInset.length) : null,
    modalInset,
    densityMin: minOf(densities),
    densityMax: maxOf(densities),
    densityMinMax: maxOf(densities) ? round(minOf(densities) / maxOf(densities)) : null,
    offGrid,
    themeDark: totalArea > 0 && darkArea > totalArea / 2 ? "dark" : "light",
  };
}

function typeMetrics(textElements, headings) {
  const sizes = [...new Set(textElements.map((t) => Math.round(t.fontSize * 2) / 2))].sort((a, b) => a - b);
  const measured = textElements
    .filter((t) => MEASURE_TAGS.has(t.tag) && t.ownLength >= MEASURE_MIN_CHARS && t.avgCharWidth > 0)
    .map((t) => ({ tag: t.tag, text: t.ownText, charsPerLine: round(t.contentWidth / t.avgCharWidth, 1), width: Math.round(t.contentWidth), fontSize: t.fontSize }))
    .sort((a, b) => b.charsPerLine - a.charsPerLine);
  const decorative = [
    ...textElements
      .filter(
        (t) =>
          // Uppercase small text is the kicker whether or not it is tracked: the first 2.0.0
          // run set its definition terms in 16px caps at 0.03em and slipped under the old
          // 15px-and-0.05em test. Buttons and links are exempt; a label is not a control.
          // Uppercase on anything that is not a heading or a control is a label; the first
          // 2.0.0 run set its definition terms in 28px condensed caps, which reads as 16px.
          (t.textTransform === "uppercase" && t.fontSize < 32 && !/^(A|BUTTON|H[1-6])$/i.test(t.tag)) ||
          // or typed in capitals outright: six or more letters, none lowercase
          (t.fontSize < 32 && !/^(A|BUTTON|H[1-6])$/i.test(t.tag) && (t.ownText.match(/[A-Z]/g) ?? []).length >= 6 && !/[a-z]/.test(t.ownText)) ||
          /small-caps|all-small-caps|petite-caps/.test(t.fontVariant),
      )
      .map((t) => `${t.tag.toLowerCase()} "${t.ownText}"`),
    ...headings.filter((h) => NUMBERED_HEADING.test(h)).map((h) => `numbered heading "${h.slice(0, 40)}"`),
  ];
  return {
    typeScaleSizes: sizes,
    typeScaleCount: sizes.length,
    typeScaleRatio: sizes.length ? round(sizes.at(-1) / sizes[0], 2) : null,
    measureMax: measured[0]?.charsPerLine ?? null,
    // Four repairs in a row failed on a paragraph named only by its text; the width is what
    // the drafter can act on.
    measureWorst: measured[0]
      ? `${measured[0].tag.toLowerCase()} "${measured[0].text}" is ${measured[0].width}px wide at ${measured[0].fontSize}px (${measured[0].charsPerLine} characters a line); cap that element at max-width: 60ch, about ${Math.round(measured[0].width * 70 / measured[0].charsPerLine)}px`
      : null,
    decorativeLabels: decorative.length,
    decorativeExamples: decorative.slice(0, 3),
  };
}

function metricsFrom(raw, phoneCtas) {
  const W = raw.viewportWidth;
  const sections = raw.sections.map((s) => sectionMetrics(s, raw.ink, W));
  const hero1440 = raw.ctas.filter((c) => c.top < DESKTOP.height);
  const hero375 = phoneCtas.filter((c) => c.top < PHONE.height);
  return {
    viewportWidth: W,
    sectionCount: sections.length,
    ...strandedMetrics(sections),
    ...layoutMetrics(sections, W),
    ...typeMetrics(raw.textElements, raw.headings),
    heroCta1440: hero1440.length,
    heroCta1440Hrefs: hero1440.map((c) => c.href),
    heroCta375: hero375.length,
    heroCta375Hrefs: hero375.map((c) => c.href),
    sections: sections.map(({ inkLeftPx, area, fullBleed, ...rest }) => rest),
  };
}

const check = (name, rule, pass, details) => ({ name, rule, pass, details });

function gateChecks(m, direction) {
  const mode = direction?.theme?.mode;
  return [
    check(
      "one CTA above the fold (1440), at least one at 375",
      "hero-cta",
      m.heroCta1440 === HERO_CTA_1440 && m.heroCta375 >= HERO_CTA_375_MIN,
      `${m.heroCta1440} at 1440 [${m.heroCta1440Hrefs.join(", ")}], ${m.heroCta375} at 375 [${m.heroCta375Hrefs.join(", ")}]`,
    ),
    check(
      "no decorative labels (tracked caps, small caps, numbered headings)",
      "no-decorative-labels",
      m.decorativeLabels <= DECORATIVE_LABELS_MAX,
      m.decorativeLabels ? `${m.decorativeLabels} found: ${m.decorativeExamples.join("; ")}` : "ok",
    ),
    check(
      `type measure (max ${m.measureMax ?? "n/a"} chars per line of ${MEASURE_MAX_CPL})`,
      "type-measure",
      m.measureMax === null || m.measureMax <= MEASURE_MAX_CPL,
      m.measureMax === null ? "no body text of 120+ characters to measure" : `widest: ${m.measureWorst}`,
    ),
    check(
      `type scale (${m.typeScaleCount} sizes, ratio ${m.typeScaleRatio ?? "n/a"})`,
      "type-scale",
      m.typeScaleRatio !== null && m.typeScaleRatio >= TYPE_SCALE_RATIO_MIN && m.typeScaleCount >= TYPE_SCALE_COUNT_MIN,
      `sizes: ${m.typeScaleSizes.join(", ")}px`,
    ),
    mode
      ? check(`theme mode follows direction (${mode})`, "theme-mode", m.themeDark === mode, `page reads ${m.themeDark}`)
      : check("theme mode follows direction (no direction on record)", "theme-mode", true, "no direction on record"),
  ];
}

function advisoryChecks(m) {
  const strandedBad = m.strandedShare > STRANDED_SHARE_MAX || m.strandedMaxConsecutive >= STRANDED_CONSECUTIVE_MAX;
  return [
    {
      ...check("stranded left column", "stranded-column", !strandedBad, `${m.strandedCount}/${m.sectionCount} sections stranded, ${m.strandedMaxConsecutive} consecutive`),
      value: { share: m.strandedShare, maxConsecutive: m.strandedMaxConsecutive },
    },
    {
      ...check("section inset varies", "uniform-inset", !(m.uniformInsetShare >= UNIFORM_INSET_SHARE_MAX), `${Math.round((m.uniformInsetShare ?? 0) * 100)}% of sections share the ${m.modalInset}px inset`),
      value: m.uniformInsetShare,
    },
    {
      ...check("density varies between sections", "density-variation", !(m.densityMinMax > DENSITY_RATIO_MAX), `sparsest/densest = ${m.densityMinMax ?? "n/a"} (${m.densityMin} to ${m.densityMax} chars per 100x100px)`),
      value: m.densityMinMax,
    },
    {
      ...check("at least one section breaks the grid", "grid-break", m.offGrid >= 1, `${m.offGrid} section(s) off the modal ink-left or full-bleed`),
      value: m.offGrid,
    },
  ];
}
