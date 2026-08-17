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
];

// Defects the deterministic gate is known not to catch. These are not scored;
// they are recorded so the scorecard states the gate's edges instead of implying
// it has none. The tel: mismatch is real and still sits in the golden fixture:
// the advisory review pass caught it on the original run, the checks did not.
export const KNOWN_BLIND_SPOTS = [
  {
    id: "tel-href-digit-mismatch",
    defect:
      'tel: href digits disagree with the link text (href "+6328845220" vs text "+63 2 8845 2210")',
    whyMissed:
      "the link audit only probes http(s) anchors; no check compares a tel: href against its own label",
    caughtBy: "the advisory review pass, on the 2026-07-15T19-21-30 run",
  },
];
