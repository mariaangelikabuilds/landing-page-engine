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
];

// Graduated out of the list above: the tel: href digit mismatch. It was a blind spot
// until 2026-08-17, when a second run of the same brief produced the same defect in a
// different position and the advisory review missed it that time. Two occurrences and
// one miss made the case that a digit comparison belongs in the deciding half. It is
// now the contact-integrity check, with tel-digit-drop as its mutation.
