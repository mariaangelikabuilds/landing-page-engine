// A page that may make no external request cannot link a webfont, and the old rule
// resolved that by mandating system stacks. That put a ceiling on every page the engine
// could produce: the art direction stage can now choose a typeface for the brand's voice,
// so the font has to travel inside the file. Fetch the woff2 once, inline it as a data
// URI, and the page is still one self-contained document.
//
// Chrome's user agent is sent on purpose: the Google Fonts CSS endpoint serves woff2 only
// to clients it believes support it, and the default Node fetch agent gets ttf.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

async function faceCss(family, weights) {
  const spec = `${family.replace(/ /g, "+")}:wght@${[...weights].sort((a, b) => a - b).join(";")}`;
  const url = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  const response = await fetch(url, { headers: { "user-agent": CHROME_UA } });
  if (!response.ok) {
    throw new Error(`google fonts refused ${family} (${response.status})`);
  }
  return response.text();
}

// Only the latin block. The full CSS carries a dozen unicode-range subsets and pulling
// every one of them turns a 20kb typeface into 300kb of base64 for glyphs no visitor of
// an English-language page will render.
function latinFaces(css) {
  const blocks = css.split("@font-face").slice(1).map((block) => `@font-face${block}`);
  const latin = blocks.filter((block) => /unicode-range:[^;]*U\+0000-00FF/.test(block));
  return latin.length ? latin : blocks.slice(-1);
}

async function inlineOne(block) {
  const href = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
  if (!href) return null;
  const response = await fetch(href, { headers: { "user-agent": CHROME_UA } });
  if (!response.ok) throw new Error(`font file fetch failed (${response.status})`);
  const encoded = Buffer.from(await response.arrayBuffer()).toString("base64");
  return block
    .replace(/url\(https:\/\/[^)]+\.woff2\)/, `url(data:font/woff2;base64,${encoded})`)
    .replace(/\s*unicode-range:[^;]+;/, "")
    .trim();
}

// Returns a style block to prepend to the drafted page, plus a record for run.json.
export async function embedFonts(fontSpecs) {
  const faces = [];
  const embedded = [];

  for (const { family, weights } of fontSpecs) {
    const css = await faceCss(family, weights);
    const inlined = (await Promise.all(latinFaces(css).map(inlineOne))).filter(Boolean);
    if (!inlined.length) throw new Error(`no woff2 face found for ${family}`);
    faces.push(...inlined);
    const kb = Math.round(inlined.join("").length / 1024);
    embedded.push({ family, weights, faces: inlined.length, kb });
    process.stderr.write(`  font: ${family} ${weights.join("/")} (${inlined.length} face(s), ${kb}kb)\n`);
  }

  return { styleBlock: `<style>\n${faces.join("\n")}\n</style>`, embedded };
}

// The drafter is told not to write its own @font-face, so the faces go in here, directly
// before the page's own style block where its cascade can still override anything.
export function injectFonts(pageHtml, styleBlock) {
  // Told not to, the drafter still authors its own @font-face rules, and they point at
  // files that do not exist inside a single self-contained page. Strip any face that
  // carries no embedded payload, then add the real ones. Deterministic beats asking twice.
  const cleaned = pageHtml.replace(/@font-face\s*\{[^}]*\}/gi, (face) =>
    face.includes("base64") ? face : "",
  );
  if (/<\/head>/i.test(cleaned)) {
    return cleaned.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }
  return cleaned.replace(/<body[^>]*>/i, (bodyTag) => `${styleBlock}\n${bodyTag}`);
}
