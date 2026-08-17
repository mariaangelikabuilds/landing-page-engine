import { directionCompletion, usageCostUsd } from "./claude.mjs";

// The gate could tell a page was wrong and never why it was dull. Checks catch defects;
// nothing in the pipeline was making a decision. This stage does: it commits to a voice,
// a lane, a palette strategy and a typeface before a line of markup exists, and the
// drafter writes to that brief instead of inventing one implicitly.
//
// Everything here is a procedure borrowed from working art direction: name the reflex and
// reject it, name a real reference so ambition does not decay into beige, and describe the
// page the way a competitor would describe theirs. If that sentence fits the category's
// modal page, start over.

// Training-data defaults. A font on this list is what every model reaches for first, so
// reaching for it produces the same page everyone else generated today. The names are
// here precisely so they can be refused.
const REFLEX_FONTS = [
  "Fraunces", "Newsreader", "Lora", "Crimson", "Crimson Pro", "Crimson Text", // ai-ok: this is the reject list
  "Playfair Display", "Cormorant", "Cormorant Garamond", "Syne", // ai-ok: this is the reject list
  "IBM Plex Mono", "IBM Plex Sans", "IBM Plex Serif", // ai-ok: this is the reject list
  "Space Mono", "Space Grotesk", "Inter", "DM Sans", // ai-ok: this is the reject list
  "DM Serif Display", "DM Serif Text", "Outfit", "Plus Jakarta Sans", // ai-ok: this is the reject list
  "Instrument Sans", "Instrument Serif", "Geist", "Cal Sans", // ai-ok: this is the reject list
  "Roboto", "Open Sans", "Lato", "Manrope", "Satoshi", "Sora", // ai-ok: this is the reject list
  "Poppins", "Montserrat", "Urbanist", "Lexend", "Nunito", // ai-ok: this is the reject list
  "Work Sans", "Mulish", "Karla", // ai-ok: this is the reject list
];

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    voiceWords: { type: "array", items: { type: "string" } },
    physicalObject: { type: "string" },
    reflexRejected: {
      type: "object",
      properties: {
        fonts: { type: "array", items: { type: "string" } },
        lane: { type: "string" },
        palette: { type: "string" },
      },
      required: ["fonts", "lane", "palette"],
      additionalProperties: false,
    },
    aestheticLane: { type: "string" },
    inverseTest: {
      type: "object",
      properties: {
        competitorSentence: { type: "string" },
        whyThisIsNotThat: { type: "string" },
      },
      required: ["competitorSentence", "whyThisIsNotThat"],
      additionalProperties: false,
    },
    theme: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["light", "dark"] },
        scene: { type: "string" },
      },
      required: ["mode", "scene"],
      additionalProperties: false,
    },
    color: {
      type: "object",
      properties: {
        reference: { type: "string" },
        strategy: {
          type: "string",
          enum: ["restrained", "committed", "full-palette", "drenched"],
        },
        roles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              oklch: { type: "string" },
              use: { type: "string" },
            },
            required: ["name", "oklch", "use"],
            additionalProperties: false,
          },
        },
      },
      required: ["reference", "strategy", "roles"],
      additionalProperties: false,
    },
    type: {
      type: "object",
      properties: {
        displayFamily: { type: "string" },
        displayWeights: { type: "array", items: { type: "integer" } },
        bodyFamily: { type: "string" },
        bodyWeights: { type: "array", items: { type: "integer" } },
        pairingReason: { type: "string" },
        scaleRatio: { type: "number" },
      },
      required: [
        "displayFamily", "displayWeights", "bodyFamily", "bodyWeights",
        "pairingReason", "scaleRatio",
      ],
      additionalProperties: false,
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          container: { type: "string" },
          artDirection: { type: "string" },
        },
        required: ["name", "container", "artDirection"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "voiceWords", "physicalObject", "reflexRejected", "aestheticLane",
    "inverseTest", "theme", "color", "type", "sections",
  ],
  additionalProperties: false,
};

const directionSystemPrompt = `You are the art direction stage of a landing page engine.
You do not write markup. You commit to decisions the drafting stage must follow.

Work the procedure in order and do not skip a step.

1. VOICE. Read the brief and write three concrete brand-voice words. Physical-object
   words, not "modern" or "clean" or "professional". "Warm and mechanical and opinionated"
   or "calm and clinical and careful" are the right shape.

2. PHYSICAL OBJECT. Name the object this brand would be if it were printed or
   manufactured: a museum caption, a 1970s terminal manual, a fabric label, a receipt from
   a mid-century diner, a shipping manifest, a field notebook. Be specific. This anchors
   every later choice.

3. REJECT THE REFLEX. Name the three fonts you would reach for first, the aesthetic lane
   you would land in first, and the palette you would pick first. Then reject all of them.
   These are training-data defaults: they are what every model produced today, so they
   guarantee the page looks generated. Two reflexes to watch for specifically:
   - The category reflex: if the palette is guessable from the industry alone (security
     and IT to navy, healthcare to white and teal, finance to navy and gold, crypto to
     neon on black), it is the first reflex. Reach past it.
   - The lane reflex: display serif, often italic, plus small tracked labels, ruled
     separators, monochrome restraint and no imagery, is currently the most saturated lane
     in existence. Do not land there unless the brief is literally a magazine. It is the
     trap one tier deeper than picking a default font.

4. INVERSE TEST. Write one sentence describing the page the way a competitor would
   describe theirs. If that sentence fits the modal page in this category, start over and
   choose differently. Then say why what you are building is not that.

   When you need an anchor, take it from work that has not been cloned into the training
   set a hundred thousand times. Useful ones, each for a specific move: Klim Type Foundry
   for controlled asymmetry and metadata as typographic texture; Tufte CSS for sidenotes
   in the margin instead of a sidebar; gwern.net for dense technical prose made readable
   with a strict measure and no cards at all; Practical Typography for a document where
   the type is the entire design; Grilli Type for a hard flush-left Swiss grid; Every
   Layout for composition as algorithm; The Pudding for generous whitespace with objects
   breaking the grid's regularity; Tighten for a services page that carries itself on
   outcomes with no feature grid and no pricing tiers. Do not anchor on Linear, Vercel,
   Stripe, Notion or any shadcn-derived surface: those are the saturated set.

5. THEME. Light or dark is never a default. Write one sentence of physical scene: who is
   reading this, where, under what light, in what mood. If the sentence does not force the
   answer, it is not concrete enough.

6. COLOR. Name a real reference before choosing a strategy, because unnamed ambition
   becomes beige. Then pick a strategy: restrained (tinted neutrals plus one accent under
   ten percent), committed (one saturated colour carrying thirty to sixty percent of the
   surface), full-palette (three or four named roles each used deliberately), or drenched
   (the surface is the colour). A landing page has permission for the committed and
   drenched end.
   If the brief supplies a palette, those hex values ARE the brand and are not yours to
   replace. Use them as the primary roles and give each role's value as that exact hex
   string, unchanged. Your strategy choice then decides how much surface each one covers,
   which is the real decision. You may add at most two supporting tones, in OKLCH, derived
   from the brief's hues. If the brief supplies no palette, express every role in OKLCH.
   Never pure black or pure white: tint the neutrals toward the brand hue. Reduce chroma
   as lightness approaches either extreme.

7. TYPE. Choose a display family and a body family available on Google Fonts, chosen for
   the physical object from step 2, and NOT on this reject list:
   ${REFLEX_FONTS.join(", ")}.
   A single family with committed weight and size contrast beats a timid display plus body
   pair, so using one family for both is allowed when the voice wants it. Give a modular
   scale ratio of at least 1.25; flatter than that reads as uncommitted.

8. SECTIONS. Plan four to eight sections. For each, name the container archetype and give
   one sentence of art direction. Use a different archetype for each unless a repeat is
   deliberate. Archetypes available, none of which are cards: full-bleed band, asymmetric
   two-column with deliberately unequal columns, definition list of term and detail,
   running paragraph at reading measure, horizontal row of figures, bordered data block,
   plain list, single oversized line of type, image with caption, table.
   Do not plan a row of big statistics with small labels under them. That is the
   hero-metric template and it is the most cloned block in the category.

Return only the JSON object. No commentary.`;

export async function directPage(briefBody) {
  const userPrompt = `Direct the landing page for this brief:\n\n${JSON.stringify(briefBody, null, 2)}`;
  const { directionText, usage } = await directionCompletion(
    directionSystemPrompt,
    userPrompt,
    DIRECTION_SCHEMA,
  );

  const direction = JSON.parse(directionText);
  const reflexHit = [direction.type.displayFamily, direction.type.bodyFamily].filter((family) =>
    REFLEX_FONTS.some((rejected) => rejected.toLowerCase() === family.trim().toLowerCase()),
  );
  // The reject list is in the prompt, but a prompt is a request and this is a
  // requirement. Checking it here means the rule holds even when the model drifts.
  if (reflexHit.length) {
    throw new Error(`direction picked reflex-reject font(s): ${reflexHit.join(", ")}`);
  }

  return { direction, usage, costUsd: usageCostUsd(usage) };
}

// The drafter reads this, not the raw JSON: a brief in prose is followed more closely
// than a schema dump, and the ordering here is the order the decisions were made.
export function directionBrief(direction) {
  const roles = direction.color.roles
    .map((role) => `  ${role.name}: ${role.oklch}, ${role.use}`)
    .join("\n");
  const sections = direction.sections
    .map((section, i) => `  ${i + 1}. ${section.name} [${section.container}] ${section.artDirection}`)
    .join("\n");

  return `ART DIRECTION. These decisions are made. Follow them exactly; do not
re-litigate them and do not substitute your own.

Voice: ${direction.voiceWords.join(", ")}
Physical object: ${direction.physicalObject}
Aesthetic lane: ${direction.aestheticLane}
Rejected as reflex: fonts ${direction.reflexRejected.fonts.join(", ")}; lane ${direction.reflexRejected.lane}; palette ${direction.reflexRejected.palette}
This page is not the modal one because: ${direction.inverseTest.whyThisIsNotThat}

Theme: ${direction.theme.mode}. ${direction.theme.scene}

Colour strategy: ${direction.color.strategy}, after ${direction.color.reference}
${roles}
Use these OKLCH values as the page's custom properties. Do not introduce a different
palette, and do not hedge a committed or drenched strategy with neutrals at the edges.

Type: ${direction.type.displayFamily} for display at weights ${direction.type.displayWeights.join(", ")},
${direction.type.bodyFamily} for body at weights ${direction.type.bodyWeights.join(", ")}.
${direction.type.pairingReason}
Modular scale ratio ${direction.type.scaleRatio}. Both families are embedded for you in a
style block prepended to your output: reference them by name in font-family and do NOT add
any @font-face rule, @import, or link element of your own.

Sections, in order, each in its named container:
${sections}`;
}
