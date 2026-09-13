import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { directionCompletion, usageCostUsd } from "./claude.mjs";

// The gate could tell a page was wrong and never why it was dull. Checks catch defects;
// nothing in the pipeline was making a decision. This stage does: it commits to a voice,
// a material, a lane, a palette strategy, a typeface, a hero and a grid before a line of
// markup exists, and the drafter writes to that brief instead of inventing one implicitly.
//
// Everything here is a procedure borrowed from working art direction: name the reflex and
// reject it, name a real reference so ambition does not decay into beige, and describe the
// page the way a competitor would describe theirs. If that sentence fits the category's
// modal page, start over.
//
// 2026-09-14: four directed runs of one brief had converged on one lane (a laminated log,
// Courier Prime, "unhurried", four times out of four). The first reflex was refused by name;
// the second, the DOCUMENT, was where the model landed every time, because every example
// object in the prompt was typewritten paper. The examples changed, the document lane is
// refused in code the way fonts are, and the last four directions for a brand are fed back
// as choices already spent.

// Training-data defaults. A font on this list is what every model reaches for first, so
// reaching for it produces the same page everyone else generated today. The names are
// here precisely so they can be refused.
const REFLEX_FONTS = [
  "Fraunces", "Newsreader", "Lora", "Crimson", "Crimson Pro", "Crimson Text", // ai-ok: this is the reject list
  "Playfair Display", "Cormorant", "Cormorant Garamond", "Syne", // ai-ok: this is the reject list
  "IBM Plex Mono", "IBM Plex Sans", "IBM Plex Serif", // ai-ok: this is the reject list
  "Space Mono", "Space Grotesk", "Inter", "DM Sans", // ai-ok: this is the reject list
  "DM Serif Display", "DM Serif Text", "Outfit", "Plus Jakarta Sans", // ai-ok: this is the reject list
  "Instrument Sans", "Instrument Serif", "Geist", "Geist Mono", "Cal Sans", // ai-ok: this is the reject list
  "Roboto", "Open Sans", "Lato", "Manrope", "Satoshi", "Sora", // ai-ok: this is the reject list
  "Poppins", "Montserrat", "Urbanist", "Lexend", "Nunito", // ai-ok: this is the reject list
  "Work Sans", "Mulish", "Karla", // ai-ok: this is the reject list
];

// The second-order reflex. After refusing navy-and-teal and the italic-serif magazine, the
// next thing every model reaches for is a piece of typewritten paper, and an IT brief lands
// there every time. Matched against the object, the material and the lane together.
export const DOCUMENT_REFLEX =
  /\b(terminal|printout|dot[- ]?matrix|ledger|manifest|log ?book|logs?|inspection|receipt|invoice|forms?|manual|notebook|caption|labels?|report|punch[- ]?card|stamp|typewrit\w*|teletype|memo|index card|clipboard|spreadsheet|dossier|paperwork|worksheet)\b/i;

const LANES = ["photographic", "editorial", "typographic", "product", "poster", "illustrated", "brutalist", "document"];
const HERO_TREATMENTS = ["photo-full-bleed", "photo-split", "type-only", "colour-field", "product-shot", "illustration"];

const str = { type: "string" };
const strList = { type: "array", items: str };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const DIRECTION_SCHEMA = obj({
  voiceWords: strList,
  physicalObject: str,
  material: str,
  lane: { type: "string", enum: LANES },
  reflexRejected: obj({ fonts: strList, lane: { type: "string", enum: LANES }, palette: str, secondOrder: str }),
  aestheticLane: str,
  inverseTest: obj({ competitorSentence: str, whyThisIsNotThat: str }),
  theme: obj({ mode: { type: "string", enum: ["light", "dark"] }, scene: str }),
  color: obj({
    reference: str,
    strategy: { type: "string", enum: ["restrained", "committed", "full-palette", "drenched"] },
    roles: { type: "array", items: obj({ name: str, oklch: str, use: str }) },
  }),
  type: obj({
    displayFamily: str,
    displayWeights: { type: "array", items: { type: "integer" } },
    bodyFamily: str,
    bodyWeights: { type: "array", items: { type: "integer" } },
    pairingReason: str,
    scaleRatio: { type: "number" },
  }),
  hero: obj({
    treatment: { type: "string", enum: HERO_TREATMENTS },
    headline: str,
    cta: obj({ label: str, target: { type: "string", enum: ["email", "phone", "url"] } }),
    proof: str,
    imageIndex: { type: ["integer", "null"] },
  }),
  composition: obj({
    grid: str,
    asymmetry: str,
    breakSection: str,
    densityMap: { type: "array", items: obj({ section: str, density: { type: "string", enum: ["tight", "normal", "airy"] } }) },
    imagePlacement: {
      type: "array",
      items: obj({ description: str, section: str, placement: { type: "string", enum: ["full-bleed", "inset-left", "inset-right", "figure", "background"] } }),
    },
  }),
  imagery: obj({ treatment: str }),
  sections: {
    type: "array",
    items: obj({
      name: str,
      container: str,
      width: { type: "string", enum: ["full-bleed", "wide", "measure"] },
      align: { type: "string", enum: ["left", "centred", "split"] },
      artDirection: str,
    }),
  },
});

const directionSystemPrompt = `You are the art direction stage of a landing page engine.
You do not write markup. You commit to decisions the drafting stage must follow.

Work the procedure in order and do not skip a step.

1. VOICE. Read the brief and write three concrete brand-voice words. Physical-object
   words, not "modern" or "clean" or "professional". "Warm and mechanical and opinionated"
   or "calm and clinical and careful" are the right shape. At least one of the three names
   a colour, a material or a temperature.

2. PHYSICAL OBJECT AND MATERIAL. Name the object this brand would be if it were
   manufactured, and what it is made of. The object may be anything with a surface: a
   brushed-steel appliance panel, a glazed ceramic cup, a cotton canvas tote, a backlit
   pharmacy sign, a cast-iron pan, a linen-bound menu, a lacquered speaker cabinet, a
   coated-stock film poster, a wax-sealed jar, an enamelled street sign, a woven seat.
   Typewritten paper of any kind (manuals, receipts, ledgers, logs, forms, manifests,
   captions, notebooks) is refused by the code that reads your answer; do not spend the
   slot on it. Be specific. This anchors every later choice, including the material the
   page's surfaces imitate and the photographs' light.

3. REJECT THE REFLEX. Name the three fonts you would reach for first, the aesthetic lane
   you would land in first, and the palette you would pick first. Then reject all of them.
   These are training-data defaults: they are what every model produced today, so they
   guarantee the page looks generated. Three reflexes to watch for specifically:
   - The category reflex: if the palette is guessable from the industry alone (security
     and IT to navy, healthcare to white and teal, finance to navy and gold, crypto to
     neon on black, coffee to brown), it is the first reflex. Reach past it.
   - The lane reflex: display serif, often italic, plus small tracked labels, ruled
     separators, monochrome restraint and no imagery, is currently the most saturated lane
     in existence. Do not land there unless the brief is literally a magazine.
   - The second-order reflex: after refusing the category palette and the editorial lane,
     the next thing every model reaches for is a DOCUMENT: a terminal printout for IT, a
     government form for anything regulated, a ledger for anything with a price, a field
     notebook for anything outdoors. Name the document you would have picked in
     reflexRejected.secondOrder and refuse it. Your lane may not be "document" and your
     object may not be printed paper.
   Choose your lane from: photographic, editorial, typographic, product, poster,
   illustrated, brutalist. It may not equal the lane you rejected.

4. INVERSE TEST. Write one sentence describing the page the way a competitor would
   describe theirs. If that sentence fits the modal page in this category, start over and
   choose differently. Then say why what you are building is not that.

   When you need an anchor, take it from work that has not been cloned into the training
   set a hundred thousand times, each for a specific move: Klim Type Foundry for
   controlled asymmetry and metadata as typographic texture; Grilli Type for a hard
   flush-left Swiss grid; Every Layout for composition as algorithm; The Pudding for
   generous whitespace with objects breaking the grid's regularity; Tighten for a services
   page that carries itself on outcomes with no feature grid and no pricing tiers;
   21oaks.org for a page carried by photography and one line of type, with hand-drawn
   marks on hover; riangle.com for a statement on the left and one object on the right,
   then the work as big media; Museum Department and San Rita for editorial pages where
   the photograph is the layout; Serotoninn and Cecilie Bahnsen for product photography
   as structure rather than decoration; Amie and Pitch for alternating copy blocks and
   full-bleed product frames on a neutral base with colour spent at a few points. Do not
   anchor on Linear, Vercel, Stripe, Notion or any shadcn-derived surface: those are the
   saturated set.

5. THEME. Light or dark is never a default. Write one sentence of physical scene: who is
   reading this, where, under what light, in what mood. If the sentence does not force the
   answer, it is not concrete enough. The mode you name is enforced against the rendered
   page: a "light" page whose bands are mostly dark fails.

6. COLOR. Name a real reference before choosing a strategy, because unnamed ambition
   becomes beige. Then pick a strategy: restrained (tinted neutrals plus one accent under
   ten percent), committed (one saturated colour carrying thirty to sixty percent of the
   surface), full-palette (three or four named roles each used deliberately), or drenched
   (the surface is the colour). A landing page has permission for the committed and
   drenched end. Brown and orange are never page-scale grounds.
   If the brief supplies a palette, those hex values ARE the brand and are not yours to
   replace. Use them as the primary roles and give each role's value as that exact hex
   string, unchanged. Your strategy choice then decides how much surface each one covers,
   which is the real decision. You may add at most two supporting tones, in OKLCH, derived
   from the brief's hues. If the brief supplies no palette, express every role in OKLCH.
   Never pure black or pure white: tint the neutrals toward the brand hue. Reduce chroma
   as lightness approaches either extreme.

7. TYPE. Choose a display family and a body family available on Google Fonts, chosen for
   the physical object and material from step 2, and NOT on this reject list:
   ${REFLEX_FONTS.join(", ")}.
   A single family with committed weight and size contrast beats a timid display plus body
   pair, so using one family for both is allowed when the voice wants it. Give a modular
   scale ratio of at least 1.25; flatter than that reads as uncommitted. If the brief comes
   with a list of choices already used for this brand, none of them may appear again.

8. SECTIONS. Plan four to eight sections. For each, name the container archetype, its
   width (full-bleed, wide, or measure), its alignment (left, centred, or split) and give
   one sentence of art direction. Use a different archetype for each unless a repeat is
   deliberate. Archetypes available, none of which are cards: full-bleed band, asymmetric
   two-column with deliberately unequal columns, definition list of term and detail,
   running paragraph at reading measure, horizontal row of figures, bordered data block,
   plain list, single oversized line of type, image with caption, table.
   Do not plan a row of big statistics with small labels under them. That is the
   hero-metric template and it is the most cloned block in the category. Do not plan a
   grid of cards. A page whose sections are all "measure" and "left" is one stranded
   column with a dead band beside it; at most half the sections may be measure-width.

9. HERO. For a client-services or product page the hero is a conversion surface.
   Headline: the outcome for the buyer, one sentence, taken from the brief. Exactly one
   call to action, naming the real action and its target (email, phone or url). Exactly
   one proof element, one fact from the brief's facts. Nothing else above the fold: no
   subtext paragraph, no second button, no three feature cards beneath it. Choose the
   treatment: photo-full-bleed, photo-split, type-only, colour-field, product-shot or
   illustration. If the brief has imagery, say which image the hero uses (imageIndex, zero
   based) or null. A dark photograph under a headline is not a decision unless the theme
   sentence asked for it.

10. COMPOSITION. Decide the grid (columns, gutter, which columns the reading measure sits
    in and what occupies the rest), the asymmetry (which side is heavy and why), which
    single section breaks the grid and how, and a density map: every section is tight,
    normal or airy, with at least one tight and one airy. Place each photograph from the
    brief by section and placement, copying its description character for character. A
    reading measure is set on the paragraph, never on a wrapper; if a section is a single
    measure, say what sits beside it or centre it.

11. IMAGERY TREATMENT. One sentence of photographic direction the image generator will
    receive instead of the copy voice: film or digital, lens, light, grain, colour cast,
    time of day. It must agree with the material in step 2 and the theme in step 5.

Return only the JSON object. No commentary.`;

const slugOf = (brand) => String(brand ?? "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// What this brand has already been given. The convergence was four runs deep before anyone
// noticed; the prompt now sees the last four directions and the code refuses a repeat.
export function recentChoices(brand, outRoot = "out/runs", limit = 4) {
  if (!existsSync(outRoot)) return { fonts: [], voiceWords: [], objects: [] };
  const suffix = `-${slugOf(brand)}`;
  const directions = readdirSync(outRoot)
    .filter((dir) => dir.endsWith(suffix))
    .sort()
    .reverse()
    .map((dir) => {
      try { return JSON.parse(readFileSync(join(outRoot, dir, "run.json"), "utf8")).direction ?? null; } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, limit);
  const unique = (list) => [...new Set(list.map((s) => String(s).trim().toLowerCase()))];
  return {
    fonts: unique(directions.flatMap((d) => [d.type?.displayFamily, d.type?.bodyFamily].filter(Boolean))),
    voiceWords: unique(directions.flatMap((d) => d.voiceWords ?? [])),
    objects: directions.map((d) => d.physicalObject).filter(Boolean),
  };
}

// Every reason a direction is refused, as sentences the model can act on. The reject lists
// are in the prompt, but a prompt is a request and these are requirements.
export function refusals(direction, used) {
  const reasons = [];
  const families = [direction.type.displayFamily, direction.type.bodyFamily].map((f) => f.trim().toLowerCase());
  const reflexHit = families.filter((f) => REFLEX_FONTS.some((r) => r.toLowerCase() === f));
  if (reflexHit.length) reasons.push(`reflex-reject font(s): ${reflexHit.join(", ")}`);
  const usedFont = families.filter((f) => used.fonts.includes(f));
  if (usedFont.length) reasons.push(`font(s) already used for this brand: ${usedFont.join(", ")}`);
  const usedVoice = direction.voiceWords.map((w) => w.trim().toLowerCase()).filter((w) => used.voiceWords.includes(w));
  if (usedVoice.length) reasons.push(`voice word(s) already used for this brand: ${usedVoice.join(", ")}`);
  if (direction.lane === "document") reasons.push(`lane "document" is the second-order reflex`);
  const surface = `${direction.physicalObject} ${direction.material} ${direction.aestheticLane}`;
  const doc = surface.match(DOCUMENT_REFLEX);
  if (doc) reasons.push(`physical object or lane is typewritten paper ("${doc[0]}" in "${surface.slice(0, 80)}")`);
  if (direction.lane === direction.reflexRejected.lane) reasons.push(`lane "${direction.lane}" is the lane you rejected as reflex`);
  const measureOnly = direction.sections.filter((s) => s.width === "measure").length;
  if (measureOnly > direction.sections.length / 2) reasons.push(`${measureOnly} of ${direction.sections.length} sections are measure-width: that is one stranded column`);
  return reasons;
}

export async function directPage(briefBody, { outRoot = "out/runs" } = {}) {
  const used = recentChoices(briefBody.brand, outRoot);
  const spent = used.fonts.length || used.voiceWords.length
    ? `\n\nALREADY USED FOR THIS BRAND, do not repeat any of these:\nfonts: ${used.fonts.join(", ") || "none"}\nvoice words: ${used.voiceWords.join(", ") || "none"}\nobjects: ${used.objects.join("; ") || "none"}`
    : "";
  let userPrompt = `Direct the landing page for this brief:\n\n${JSON.stringify(briefBody, null, 2)}${spent}`;
  let totalUsage = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { directionText, usage } = await directionCompletion(directionSystemPrompt, userPrompt, DIRECTION_SCHEMA);
    totalUsage = totalUsage
      ? { input_tokens: totalUsage.input_tokens + usage.input_tokens, output_tokens: totalUsage.output_tokens + usage.output_tokens }
      : { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
    const direction = JSON.parse(directionText);
    const reasons = refusals(direction, used);
    if (!reasons.length) return { direction, usage: totalUsage, costUsd: usageCostUsd(totalUsage), retried: attempt };
    process.stderr.write(`  direction refused: ${reasons.join("; ")}${attempt ? "" : ", retrying once"}\n`);
    if (attempt) throw new Error(`direction refused twice: ${reasons.join("; ")}`);
    userPrompt += `\n\nYour previous direction was REFUSED for these reasons. Choose differently on each of them and keep everything else:\n${reasons.map((r) => `- ${r}`).join("\n")}`;
  }
  throw new Error("unreachable");
}

// The drafter reads this, not the raw JSON: a brief in prose is followed more closely
// than a schema dump, and the ordering here is the order the decisions were made.
export function directionBrief(direction) {
  const roles = direction.color.roles
    .map((role) => `  ${role.name}: ${role.oklch}, ${role.use}`)
    .join("\n");
  const sections = direction.sections
    .map((section, i) => `  ${i + 1}. ${section.name} [${section.container}, ${section.width}, ${section.align}] ${section.artDirection}`)
    .join("\n");
  const density = direction.composition.densityMap.map((d) => `${d.section}: ${d.density}`).join("; ");
  const photos = direction.composition.imagePlacement.length
    ? direction.composition.imagePlacement.map((p) => `  "${p.description}" in ${p.section}, ${p.placement}`).join("\n")
    : "  none";
  const heroImage = direction.hero.imageIndex === null ? "no photograph" : `photograph ${direction.hero.imageIndex + 1}`;

  return `ART DIRECTION. These decisions are made. Follow them exactly; do not
re-litigate them and do not substitute your own.

Voice: ${direction.voiceWords.join(", ")}
Physical object: ${direction.physicalObject}, made of ${direction.material}
Lane: ${direction.lane}. ${direction.aestheticLane}
Rejected as reflex: fonts ${direction.reflexRejected.fonts.join(", ")}; lane ${direction.reflexRejected.lane}; palette ${direction.reflexRejected.palette}; the document it would have become, ${direction.reflexRejected.secondOrder}
This page is not the modal one because: ${direction.inverseTest.whyThisIsNotThat}

Theme: ${direction.theme.mode}. ${direction.theme.scene}
The rendered page is checked against that mode: a light page is mostly light bands.

Colour strategy: ${direction.color.strategy}, after ${direction.color.reference}
${roles}
Use these values as the page's custom properties. Do not introduce a different
palette, and do not hedge a committed or drenched strategy with neutrals at the edges.

Type: ${direction.type.displayFamily} for display at weights ${direction.type.displayWeights.join(", ")},
${direction.type.bodyFamily} for body at weights ${direction.type.bodyWeights.join(", ")}.
${direction.type.pairingReason}
Modular scale ratio ${direction.type.scaleRatio}. Both families are embedded for you in a
style block prepended to your output: reference them by name in font-family and do NOT add
any @font-face rule, @import, or link element of your own.

Hero: ${direction.hero.treatment}, ${heroImage}.
Headline: "${direction.hero.headline}"
One call to action: "${direction.hero.cta.label}" (${direction.hero.cta.target}). It is the only
link above the fold. Proof beside it: ${direction.hero.proof}. Nothing else above the fold.

Grid: ${direction.composition.grid}
Heavy side: ${direction.composition.asymmetry}
The section that breaks the grid: ${direction.composition.breakSection}
Density: ${density}
Photographs, each placed (copy the description into its {{IMAGE: ...}} placeholder character for character):
${photos}
Photographic treatment for every image: ${direction.imagery.treatment}

Sections, in order, each in its named container at its named width and alignment:
${sections}`;
}
