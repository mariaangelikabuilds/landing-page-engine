# Page Rules

Version 1.6.0 (2026-08-17)

Every drafted page is written against this file, and the review pass cites these IDs
when it flags a violation. Rules marked **gate** are also enforced by deterministic
checks in `qa.mjs`; the model review is advisory and never decides pass/fail on its own.

## Delivery

- `single-file` (gate): One self-contained HTML file. All CSS inline in a single
  `<style>` block. No JavaScript. No external requests of any kind, with one
  exception: a font URL explicitly named in the brief.
- `valid-document` (gate): A doctype, one `<html>` element with a `lang` attribute,
  one `<title>`, and a `<meta name="viewport">` tag. The document must parse without
  unclosed structural tags.
- `responsive` (gate): No horizontal overflow at 375px, measured with the page's own
  `overflow-x` neutralised so it cannot hide the problem. Build with flex or grid and
  relative units. Concretely, the three things that actually break it: every display size
  is a `clamp()` whose minimum fits a 320px viewport; no element declares a fixed pixel
  width above 320px; and any long unbroken string, a URL or an email address, carries
  `overflow-wrap: anywhere`. A table needs a scroll container, not a minimum width.

## Copy

- `copy-from-brief`: Every claim, number, name, and price on the page comes from the
  brief. Nothing invented: no fabricated testimonials, star ratings, client counts,
  awards, or statistics. If the brief gives three facts, the page has three facts.
- `copy-brevity`: One sharp sentence beats three padded ones. No filler adjectives,
  no stacked qualifiers, no "in today's world" openers.
- `cta-specific`: Buttons and links name the actual action ("Book a pickup",
  "Email Marco"), never generic labels like "Get Started" or "Learn More". Every
  `href` resolves to a real destination from the brief (a URL, `mailto:`, or `tel:`).
  No dead `#` links.
- `contact-integrity` (gate): A `tel:` or `mailto:` href must carry exactly the contact
  detail from the brief, and must agree with its own visible label. Copy the number and
  the address character by character; do not retype them from memory while writing the
  markup. A label that reads correctly over an href missing one digit is the failure
  this rule exists for. The `tel:` href itself carries no spaces: write
  `tel:+63288452210`, not `tel:+63 2 8845 2210`. Spaces are not valid separators in a
  tel URI even though the visible label should keep them.
- `copy-tells` (gate): No em or en dashes anywhere in page copy; use a period,
  comma, or colon instead. None of these words: leverage, seamless, robust,
  comprehensive, streamline, elevate, unlock, transform, delve, cutting-edge,
  game-changer, empower. No "In today's ..." openers. Enforced by an exact scan
  of the rendered text; a single hit fails the build.

## Structure

- `no-template-skeleton`: The page must not follow the stock AI layout: centered
  hero with subtext and two buttons, then a three-card feature grid, then a
  testimonial band, then a footer CTA. Structure follows the brief's content.
- `no-section-rhythm`: Do not repeat one visual formula per section (label, heading,
  lead paragraph, card grid). Vary density and composition; let content dictate form.

## Composition

These are requirements, not bans. A page that breaks none of the rules above can still
be badly composed, and usually is: the failure mode is a single left column of heading
plus paragraph, repeated down the page, with a third of the viewport left empty.

- `canvas-use`: At 1440 the page uses its width on purpose. Content may not sit in one
  narrow column with a large dead band beside it. Either commit to the full width with
  full-bleed bands and multi-column blocks, or commit to a centred measure with balanced
  margins. A left-aligned column with empty space only on the right is the defect.
  Advisory, not a gate: I tried to measure it as leftmost-to-rightmost content span over
  viewport width and calibrated on four real runs. A page judged badly composed scored
  63.3 percent, identical to one judged well composed, because full-bleed bands and wide
  headers mask a stranded column. The metric did not discriminate, so it is not in the
  gate. Composition is judgement, and this file is where judgement is written down.
- `container-variety`: Build from a kit of containers and do not use any one shape more
  than twice. Available shapes, none of them cards: a full-bleed band, an asymmetric
  two-column split where the columns are deliberately unequal, a definition list of term
  and detail, a running paragraph at reading measure, a wide horizontal row of figures,
  a bordered data block, a plain list, a single oversized line of type. Same content,
  different formal containers. Sectional sameness is the tell being avoided.
- `grid-break`: At least one section departs from the page's dominant grid. Bleed to an
  edge, overlap two blocks, run type oversized, or go off-axis. One is enough, and one
  is required. Without it the page reads as output from a layout library.
- `type-scale`: The largest and smallest type differ by at least a factor of four, and the
  sizes form a visible scale rather than a crowd. Six or so distinct sizes is normal once a
  page has a headline, a section heading, a lede, body, a caption and a figure. Two ratios,
  not one: about 1.2 at 375px and about 1.333 at 1440px, interpolated with `clamp()`. A
  flat 1.1 scale reads as uncommitted; 1.5 and above starves the middle of the page. The
  scale is a tool and not a law, so one deliberate off-scale size is allowed where it
  looks better. Hierarchy comes from scale, weight and colour, never from decorative
  italic, tracked-out caps, or a rule above a heading.
- `type-measure`: Body copy sits between 45 and 75 characters per line, 60ch as the
  working ceiling. Set the measure on the text element, never on a wrapper that then
  constrains unrelated content. Body size 16px and up; line-height moves inversely to
  size, roughly 1.45 to 1.6 for body and 1.0 to 1.15 for display. Weight steps are at
  least 200 apart, so 400 against 700, never 500 against 600.
- `spacing-ratio`: Space between sections is at least twice the space inside them, which
  is what makes a section read as one thing. Vary the gaps deliberately rather than
  stepping a single scale uniformly down the page.
- `figure-ground`: Two surface levels, three at the very most. Name what earns elevation
  before using it. Everything sitting on its own tinted surface is the card reflex wearing
  a different hat.
- `density-variation`: Sections do not all breathe the same. At least one is tight and
  data-dense, at least one is generous and near-empty. Uniform vertical padding down the
  whole page is the rhythm tell in spacing form.
- `no-decorative-labels`: No tracked-out all-caps kicker labels, no numbered section
  prefixes.
- `no-side-stripe` (gate): No single-edge accent stripe. A `border-left` or `border-right`
  thicker than a hairline, on a card, callout, list item or blockquote, is the most
  recognisable generated-UI pattern in existence. A 1px rule is a rule and is fine.
  Anything thicker on one edge only is the tell. If a passage needs lift, use a full
  border, a background tint, a leading figure, or nothing.
- `semantic-html` (gate, via axe): Landmarks (`header`, `main`, `footer`), a single
  `h1`, heading levels in order, lists marked up as lists, buttons versus links used
  by function. Images carry meaningful `alt` text or `alt=""` when decorative.

## Motion

The page ships no JavaScript, so all motion is CSS. That is a constraint, not a
limitation: transitions, keyframes, and scroll-driven animations
(`animation-timeline: view()` and `scroll()`) all run without a script tag.

- `motion-visible` (gate): No animation may leave content invisible. Every entrance
  effect must define a resting state that is fully visible, and the page is checked
  twice, once normally and once under `prefers-reduced-motion: reduce`. Any text that
  ends up at zero opacity, `visibility: hidden`, or zero size fails the build. The
  failure this exists for is the entrance animation that never fires, on a browser
  without support or for a reader with motion reduced, leaving a blank page that looked
  correct on the machine that built it. Never start an element at `opacity: 0` without a
  guaranteed path back to `1`.
- `motion-reduced`: Under `prefers-reduced-motion: reduce`, motion is removed, content
  is not. Reduce to the final state, never to nothing. Nothing disappears, no section
  collapses, no meaning is lost.
- `motion-restraint`: Motion earns its place or it does not ship. No fade-up on every
  section, which is the framer-motion default rhythm in CSS clothing. At most one
  orchestrated entrance for the page, plus motion tied to real interaction. If every
  section animates the same way on scroll, delete all of it.
- `motion-cheap`: Never animate a property that triggers layout: `width`, `height`,
  `top`, `left`, `margin`, `padding`, `font-size`. Prefer `transform` and `opacity`.
  Paint-only properties such as `background-color`, `border-color`, and `color` are fine
  on hover and focus, where a colour change is usually the honest signal.
- `motion-curve`: No single universal easing on everything. Pick a curve per interaction:
  fast and sharp for a press, slower and settled for an entrance. A default
  `transition: all 0.3s ease-in-out` across the page is the tell.
- `motion-real`: Hover and focus states change something real, and focus is never
  weaker than hover. A pointer effect that a keyboard cannot reach is not shipped.

## Visual

- `palette-from-brief` (gate): If the brief gives hex values, every one of them appears
  in the page. Derive shades from them freely, but the brief's own colours must be
  present, not replaced by a nearby tone. Two drafts quietly swapped the brand accent
  `#c1502e` for a darker rust; the page looked deliberate and was off-brand. If it gives none, choose a palette grounded in the subject matter,
  and never default to indigo-on-white, purple-to-blue gradients, or pure black text
  on pure white.
- `type-deliberate`: The art direction stage chooses both families for the brand's voice
  and rejects training-data defaults by name, and the pipeline embeds them as woff2 data
  URIs before you see the page. Reference them by family name and write no `@font-face`,
  `@import`, or `<link>` of your own. Do not substitute a system stack for the directed
  family, and do not add a third family.
- `contrast-aa` (gate, via axe): All text meets WCAG 2.1 AA contrast. Check hover
  and focus states too.
- `no-stock-effects`: No glassmorphism, gradient text, bento grids, marquee logo
  strips, typewriter headlines, or emoji used as icons.
- `imagery-resolved` (gate): Photographs are requested, not linked. Write
  `<img src="{{IMAGE: what the photograph shows}}" alt="...">` and the pipeline replaces
  each placeholder with an embedded image before QA runs, so the page stays one file.
  Any placeholder still present at QA time fails the build. At most three per page.
  If the brief carries an `imagery` list, every entry in it appears on the page as a
  placeholder, worded from that entry. If the brief carries none, ask for no photographs:
  an unillustrated page is the right answer rather than an invented scene.
- `page-weight` (gate): The finished page stays under 900kb. Embedding keeps it a single
  file, which is the point, but base64 costs about a third more than the bytes it encodes
  and nothing caches it. Generated images are re-encoded to webp at 1600px before they
  land, and a page that still misses the budget wants fewer photographs, not a bigger
  budget.
- `imagery-restraint`: Ask for a photograph only where one carries information the copy
  cannot. Describe a real scene tied to the brief, in plain terms: the room, the light,
  the object. Never a person facing camera, never a screen with legible text, never a
  logo, and never a stock composition (team at a laptop, handshake, glass tower,
  abstract gradient blob). Every image carries `alt` that says what it shows, and
  decorative images carry `alt=""`.

## Change log

- 1.6.0: An art direction stage now runs before drafting. The rules could say what a page
  must not be and never made a decision, so pages passed every check and stayed dull. The
  new stage commits to voice, physical object, aesthetic lane, colour strategy against a
  named reference, and both typefaces, rejecting its own first reflexes by name before it
  chooses. Typography is no longer a system stack: the direction picks two families off a
  reject list of training-data defaults, and the pipeline embeds them as woff2 data URIs
  so the page still makes no external request. `type-deliberate` is a gate on the directed
  families actually being referenced. Craft numbers added from working typographers:
  measure 45 to 75 characters, two interpolated scale ratios rather than one, weight steps
  at least 200 apart, section spacing at least twice intra-section spacing, and at most
  three surface levels. The brief's palette outranks the direction's: client hex values
  are the brand and the strategy only decides how much surface each one covers.
- 1.5.0: Photographs. The draft asks for one with `{{IMAGE: description}}` in a src and
  the pipeline embeds it before QA, so a page with imagery is still a single file with
  no external requests. `imagery-resolved` is a gate: a leftover placeholder fails the
  build rather than shipping a broken image. Capped at three per page.
- 1.4.0: Motion section added, all of it CSS since the page ships no JavaScript.
  `motion-visible` is a gate: the page is rendered twice, once normally and once under
  `prefers-reduced-motion: reduce`, and any text left invisible fails. `palette-from-brief`
  promoted to a gate after the advisory review caught two separate drafts swapping the
  brief's accent for a darker rust, which is a comparison rather than a judgement.
  `motion-cheap` corrected: it banned animating colour, which is paint-only and fine.
  The intent was always to ban layout-triggering properties.
- 1.3.0: Composition section added. The earlier rules only banned bad structure and
  never asked for good composition, so drafts kept landing as one left column of
  heading plus paragraph repeated down the page with a third of the viewport dead.
  `canvas-use`, `container-variety`, `grid-break`, `type-scale`, and
  `density-variation` are requirements rather than bans. `canvas-use` was drafted as a
  gate and demoted after calibration: a badly composed page and a well composed one
  both measured 63.3 percent content span, so the metric did not discriminate.
- 1.2.0: `contact-integrity` added as a gate. Two runs of the same brief produced a
  `tel:` href missing one digit, in different positions, while the visible label read
  correctly both times. The advisory review caught the first and missed the second, so
  the comparison moved into the deciding half where it is exact.
- 1.1.0: `banned-vocabulary` replaced by `copy-tells` and promoted to a gate:
  dashes, an expanded banned word list, and "In today's" openers are now
  exact-scanned in QA. Prompted by the first real run, whose draft shipped em
  dashes in the page copy.
- 1.0.0: initial rule set.
