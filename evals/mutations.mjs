// One defect per mutation, each naming the check that must catch it.
//
// Labels are correct by construction: the harness knows what it broke, so no
// judgement call and no hand-labelling enters the score. Every mutation is local
// (the unreachable host uses the RFC 2606 .invalid TLD), so the suite needs no
// network and no API key.

const injectBeforeBodyEnd = (pageHtml, snippet) => {
  if (!pageHtml.includes("</body>")) {
    throw new Error("fixture has no </body> to inject before");
  }
  return pageHtml.replace("</body>", `${snippet}\n</body>`);
};

export const MUTATIONS = [
  {
    id: "strip-closing-html",
    rule: "valid-document",
    defect: "closing </html> tag removed",
    apply: (pageHtml) => {
      if (!/<\/html>\s*$/i.test(pageHtml)) {
        throw new Error("fixture does not end with </html>");
      }
      return pageHtml.replace(/<\/html>\s*$/i, "");
    },
  },
  {
    id: "inline-script",
    rule: "single-file",
    defect: "a <script> tag, so the page no longer ships zero JS",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(pageHtml, "<script>/* injected by evals */</script>"),
  },
  {
    id: "broken-cta-link",
    rule: "cta-specific",
    defect: "a CTA pointing at a host that cannot resolve",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<a href="https://eval-broken-target.invalid/quote">Request a quote</a>',
      ),
  },
  {
    id: "fixed-width-overflow",
    rule: "responsive",
    defect: "a 2000px fixed-width element, far wider than the 375px viewport",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(pageHtml, '<div style="width:2000px;height:1px"></div>'),
  },
  {
    id: "low-contrast-text",
    rule: "semantic-html / contrast-aa",
    defect: "body copy at #bbbbbb on white, under the AA contrast floor",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<p style="color:#bbbbbb;background:#ffffff">Restores are tested every month.</p>',
      ),
  },
  {
    id: "copy-tell-em-dash",
    rule: "copy-tells",
    defect: "an em dash in rendered copy",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        "<p>Backups run nightly — restores are tested monthly.</p>",
      ),
  },
  {
    id: "tel-digit-drop",
    rule: "contact-integrity",
    defect: "one digit removed from a tel: href while its label still reads correctly",
    apply: (pageHtml) => {
      if (!pageHtml.includes("tel:+63288452210")) {
        throw new Error("fixture has no known tel: href to damage");
      }
      return pageHtml.replace("tel:+63288452210", "tel:+6328845221");
    },
  },
  {
    id: "tel-space-separator",
    rule: "contact-integrity",
    defect:
      "a tel: href written with spaces, so the digits match but the URI is malformed",
    apply: (pageHtml) => {
      if (!pageHtml.includes("tel:+63288452210")) {
        throw new Error("fixture has no known tel: href to damage");
      }
      return pageHtml.replace("tel:+63288452210", "tel:+63 2 8845 2210");
    },
  },
  {
    id: "page-over-weight",
    rule: "page-weight",
    defect: "an embedded image large enough to push the page past its byte budget",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        `<img alt="" src="data:image/webp;base64,${"QUJDRA".repeat(170_000)}">`,
      ),
  },
  {
    id: "side-accent-stripe",
    rule: "no-side-stripe",
    defect: "a coloured stripe down one edge of a callout, the generated-UI callout tell",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<style>.qa-callout{border-left:3px solid #c1502e;padding-left:14px}</style>' +
          '<p class="qa-callout">Restores are tested every quarter.</p>',
      ),
  },
  {
    id: "unresolved-image-placeholder",
    rule: "imagery-resolved",
    defect: "an image placeholder left in the src, so the page renders a broken image",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<img src="{{IMAGE: a server room in a Makati office at night}}" alt="Server room">',
      ),
  },
  {
    id: "accent-swapped",
    rule: "palette-from-brief",
    defect: "the brief's accent hex replaced everywhere by a nearby darker tone",
    apply: (pageHtml) => {
      if (!/#c1502e/i.test(pageHtml)) {
        throw new Error("fixture no longer carries the brief accent to swap");
      }
      return pageHtml.replace(/#c1502e/gi, "#8a3a1f");
    },
  },
  {
    id: "entrance-never-resolves",
    rule: "motion-visible",
    defect: "an entrance start state with no animation to bring it back, so the text never appears",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<style>.qa-enter{opacity:0;transform:translateY(12px)}</style>' +
          '<p class="qa-enter">Last restore drill recovered 100 percent of sampled files.</p>',
      ),
  },
  {
    id: "reduced-motion-hides-content",
    rule: "motion-visible",
    defect: "content removed entirely under prefers-reduced-motion instead of just its motion",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        "<style>@media (prefers-reduced-motion: reduce){.qa-rm{display:none}}</style>" +
          '<p class="qa-rm">Backups run nightly at 22:00.</p>',
      ),
  },
  // Composition gates, rules 2.0.0. Each injects one defect the rendered-ink metrics in
  // qa-composition.mjs must catch, and nothing else may fire.
  {
    id: "long-measure",
    rule: "type-measure",
    defect: "a paragraph allowed to run the full viewport width, far past 80 characters a line",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        `<p style="max-width:none;width:100%;padding:0;margin:0">${"Backups run every night after the office closes and copies go to two places so that one fire or one outage cannot take both. ".repeat(4)}</p>`,
      ),
  },
  {
    id: "flat-type-scale",
    rule: "type-scale",
    defect: "every heading forced to body size, so the page has no scale",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(pageHtml, "<style>h1,h2,h3,h4,h5,h6{font-size:18px!important}</style>"),
  },
  {
    id: "tracked-caps-label",
    rule: "no-decorative-labels",
    defect: "a small tracked-out all-caps label, the eyebrow kicker",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(
        pageHtml,
        '<p style="text-transform:uppercase;letter-spacing:.14em;font-size:12px">Nightly backups</p>',
      ),
  },
  {
    id: "small-caps-label",
    rule: "no-decorative-labels",
    defect: "a label set in small caps, the same kicker in a serif costume",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(pageHtml, '<p style="font-variant:small-caps">Nightly backups</p>'),
  },
  {
    id: "numbered-heading",
    rule: "no-decorative-labels",
    defect: "a section heading prefixed with a number and a separator",
    apply: (pageHtml) => {
      if (!/<main[^>]*>/i.test(pageHtml)) throw new Error("fixture has no <main> to inject into");
      return pageHtml.replace(/(<main[^>]*>)/i, "$1<h2>01. What actually happens</h2>");
    },
  },
  {
    id: "no-hero-cta",
    rule: "hero-cta",
    defect: "every call to action pushed below the fold at both viewports, so the first screen sells nothing",
    apply: (pageHtml) =>
      injectBeforeBodyEnd(pageHtml, "<style>main{padding-top:1100px!important}</style>"),
  },
  {
    id: "two-hero-ctas",
    rule: "hero-cta",
    defect: "a second call to action above the fold, the hedge the hero rule refuses",
    apply: (pageHtml) => {
      const email = pageHtml.match(/href="mailto:([^"?]+)"/i)?.[1];
      if (!email) throw new Error("fixture has no mailto: href to duplicate");
      if (!/<main[^>]*>/i.test(pageHtml)) throw new Error("fixture has no <main> to inject into");
      return pageHtml.replace(/(<main[^>]*>)/i, `$1<p><a href="mailto:${email}">${email}</a></p>`);
    },
  },
  {
    id: "theme-mode-flip",
    rule: "theme-mode",
    defect: "the direction on record says the opposite theme from the one the page renders",
    apply: (pageHtml) => `${pageHtml}<!-- theme-mode-flip: page unchanged, run.json patched -->`,
    run: (runRecord) => ({
      ...runRecord,
      direction: {
        ...runRecord.direction,
        theme: { ...runRecord.direction.theme, mode: runRecord.direction.theme.mode === "dark" ? "light" : "dark" },
      },
    }),
  },
];

// Defects the deterministic gate is known not to catch. These are not scored;
// they are recorded so the scorecard states the gate's edges instead of implying
// it has none. The tel: mismatch is real and still sits in the golden fixture:
// the advisory review pass caught it on the original run, the checks did not.
export const KNOWN_BLIND_SPOTS = [
  {
    id: "unsourced-copy-claims",
    defect:
      "a claim in the copy that appears nowhere in the brief, such as the drafter's invented \"the keys stay with you\" and \"no term, no penalty\"",
    whyMissed:
      "checking a sentence against a brief is a judgement, not a comparison; nothing deterministic can decide it",
    caughtBy: "the advisory review pass, which is why that pass exists",
  },
  {
    id: "composition-beyond-the-measurable",
    defect:
      "a page that is stranded in one column, or repeats one formula down the page, or wears the stock skeleton in a new dress, while clearing every measurable check",
    whyMissed:
      "the ink-based metrics catch what they name (a stranded section, a flat scale, a long measure, a missing call to action) and nothing else; whether a page is well composed is still a judgement",
    caughtBy: "the composition judge, which looks at the rendered tiles and can buy two layout repairs, and never decides the verdict",
  },
];

// Graduated out of the list above: the tel: href digit mismatch. It was a blind spot
// until 2026-08-17, when a second run of the same brief produced the same defect in a
// different position and the advisory review missed it that time. Two occurrences and
// one miss made the case that a digit comparison belongs in the deciding half. It is
// now the contact-integrity check, with tel-digit-drop as its mutation.
