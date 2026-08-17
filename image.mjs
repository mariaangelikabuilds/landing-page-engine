import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// The drafter cannot paste a photograph into its output, and feeding generated images
// back through the prompt would cost more in tokens than the image is worth. So the
// draft writes {{IMAGE: description}} in the src, and this stage swaps each one for an
// embedded data URI. The page stays a single file with no external requests, which is
// what the single-file rule requires.
const PLACEHOLDER = /\{\{IMAGE:\s*([^}]+?)\s*\}\}/g;

// Landscape suits every slot a landing page actually has (hero band, section figure).
// Portrait and square are available from the API; add them when a brief needs one.
const SIZE = "1536x1024";
const QUALITY = "medium";
const MAX_IMAGES = 3;

function apiKey(name) {
  if (process.env[name]) return process.env[name];
  const envText = readFileSync(new URL(".env", import.meta.url), "utf8");
  const keyLine = envText
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`));
  if (!keyLine) throw new Error(`no ${name} in the environment or .env`);
  return keyLine.slice(name.length + 1).trim();
}

const framing = (description, brandVoice) =>
  `${description}\n\nPhotographic, natural light, no text or lettering anywhere in the frame, no logos, no people looking at the camera. ${brandVoice ?? ""}`.trim();

// Two providers because one runs out. Image credit is bought separately from text
// credit on both, so an image budget can empty while drafting still works fine, and a
// draft should not depend on which balance happens to be funded today.
async function fromGemini(description, brandVoice) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey("GEMINI_API_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: framing(description, brandVoice) }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    },
  );
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `gemini image failed (${response.status})`);
  }
  const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error("gemini response carried no image data");
  return `data:${inline.mimeType || "image/png"};base64,${inline.data}`;
}

async function fromOpenAi(description, brandVoice) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey("OPENAI_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: framing(description, brandVoice),
      n: 1,
      size: SIZE,
      quality: QUALITY,
      output_format: "webp",
      output_compression: 70,
    }),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `image request failed (${response.status})`);
  }
  const encoded = body.data?.[0]?.b64_json;
  if (!encoded) throw new Error("image response carried no b64_json");
  return `data:image/webp;base64,${encoded}`;
}

// Both providers rate limit per minute, and a transient network blip looks identical to a
// permanent failure at the call site. Waiting is the correct response to either; only a
// spent balance is worth giving up on, and that says so in the message.
const RETRYABLE = /429|RESOURCE_EXHAUSTED|rate|quota|fetch failed|ETIMEDOUT|ECONNRESET/i;
const TERMINAL = /no credits|billing|invalid[_ ]api[_ ]key|unauthorized/i;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function generateOne(description, brandVoice) {
  const providers = [
    ["gpt-image-1", fromOpenAi],
    ["gemini-2.5-flash-image", fromGemini],
  ];
  const failures = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const [name, provider] of providers) {
      try {
        return await provider(description, brandVoice);
      } catch (providerFailure) {
        const message = `${name}: ${providerFailure.message}`;
        failures.push(message);
        if (TERMINAL.test(providerFailure.message)) continue;
        if (!RETRYABLE.test(providerFailure.message)) continue;
      }
    }
    if (attempt < 2) {
      const wait = 30_000 * (attempt + 1);
      process.stderr.write(`  image: every provider busy, waiting ${wait / 1000}s\n`);
      await pause(wait);
    }
  }
  throw new Error([...new Set(failures)].join(" | "));
}

// gpt-image-1 can return compressed webp; Gemini returns PNG, and a 2MB PNG inlined as
// base64 is a 2.7MB landing page. Playwright is already a dependency for QA, so a canvas
// round trip re-encodes without adding an image library. One browser for the whole batch.
const MAX_EDGE = 1600;
const WEBP_QUALITY = 0.72;

async function reencode(browser, dataUri) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([source, maxEdge, quality]) => {
        const img = new Image();
        img.src = source;
        await img.decode();
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", quality);
      },
      [dataUri, MAX_EDGE, WEBP_QUALITY],
    );
  } finally {
    await page.close();
  }
}

// Returns the page with placeholders replaced, plus a record for run.json. Requests run
// one at a time on purpose: three concurrent image calls is a good way to hit a rate
// limit and lose a whole draft over a decoration.
export async function resolveImages(pageHtml, briefBody, cache = new Map()) {
  const asked = [...pageHtml.matchAll(PLACEHOLDER)].map((hit) => hit[1]);
  if (!asked.length) return { pageHtml, images: [] };

  // A repair re-drafts the markup, not the art. Photographs already generated for this
  // run are reused, so fixing an overflow does not re-bill two image generations.
  const wanted = [...new Set(asked)].slice(0, MAX_IMAGES);
  const resolved = new Map(cache);
  const images = [];

  // A photograph is the cheapest thing on the page and the draft is the most expensive.
  // An image failure used to throw out of here and take a paid draft with it, leaving an
  // empty run directory. Now each failure is recorded, the placeholder stays, and the
  // gate refuses the page on imagery-resolved: the draft survives on disk and can be
  // re-run through `qa` once the image credit is topped up.
  const browser = await chromium.launch();
  try {
    for (const description of wanted) {
      if (resolved.has(description)) {
        images.push({ description, reused: true });
        continue;
      }
      const startedAt = Date.now();
      try {
        const raw = await generateOne(description, briefBody?.voice);
        const dataUri = await reencode(browser, raw);
        resolved.set(description, dataUri);
        images.push({
          description,
          rawKb: Math.round(raw.length / 1024),
          kb: Math.round(dataUri.length / 1024),
          ms: Date.now() - startedAt,
        });
        process.stderr.write(
          `  image: ${description.slice(0, 46)} (${Math.round(raw.length / 1024)}kb to ${Math.round(dataUri.length / 1024)}kb)\n`,
        );
      } catch (imageFailure) {
        images.push({ description, error: imageFailure.message });
        process.stderr.write(`  image FAILED: ${imageFailure.message}\n`);
      }
    }
  } finally {
    await browser.close();
  }

  // Placeholders past the cap are left in place deliberately. The gate fails on an
  // unresolved placeholder, so a draft that asks for eight photos is refused rather
  // than silently half-illustrated.
  if (wanted.length < new Set(asked).size) {
    process.stderr.write(
      `  image: ${new Set(asked).size - wanted.length} placeholder(s) over the cap of ${MAX_IMAGES}, left unresolved\n`,
    );
  }

  for (const [description, dataUri] of resolved) cache.set(description, dataUri);

  return {
    pageHtml: pageHtml.replace(PLACEHOLDER, (whole, description) =>
      resolved.get(description.trim()) ?? whole,
    ),
    images,
  };
}
