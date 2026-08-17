# Page Rules

Version 1.2.0 (2026-08-17)

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
- `responsive` (gate): No horizontal overflow at 375px. Layout is built with flex or
  grid and relative units, not fixed pixel widths on containers.

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
  testimonial band, then a footer CTA. Structure follows the brief's content. If the
  offer is one service with a price, the page can be a single strong column; it does
  not need "sections".
- `no-section-rhythm`: Do not repeat one visual formula per section (label, heading,
  lead paragraph, card grid). Vary density and composition; let content dictate form.
- `no-decorative-labels`: No tracked-out all-caps kicker labels, no numbered section
  prefixes, no colored accent bars on cards or callouts.
- `semantic-html` (gate, via axe): Landmarks (`header`, `main`, `footer`), a single
  `h1`, heading levels in order, lists marked up as lists, buttons versus links used
  by function. Images carry meaningful `alt` text or `alt=""` when decorative.

## Visual

- `palette-from-brief`: If the brief gives hex values, use them and derive shades
  only from them. If it gives none, choose a palette grounded in the subject matter,
  and never default to indigo-on-white, purple-to-blue gradients, or pure black text
  on pure white.
- `type-deliberate`: System font stacks are the default. A webfont is allowed only
  when the brief names one. Never fall back to the overused AI picks (Inter, Poppins,
  Montserrat, Space Grotesk, DM Sans and their lookalikes) even via a font URL.
- `contrast-aa` (gate, via axe): All text meets WCAG 2.1 AA contrast. Check hover
  and focus states too.
- `no-stock-effects`: No glassmorphism, gradient text, bento grids, marquee logo
  strips, typewriter headlines, or emoji used as icons.

## Change log

- 1.2.0: `contact-integrity` added as a gate. Two runs of the same brief produced a
  `tel:` href missing one digit, in different positions, while the visible label read
  correctly both times. The advisory review caught the first and missed the second, so
  the comparison moved into the deciding half where it is exact.
- 1.1.0: `banned-vocabulary` replaced by `copy-tells` and promoted to a gate:
  dashes, an expanded banned word list, and "In today's" openers are now
  exact-scanned in QA. Prompted by the first real run, whose draft shipped em
  dashes in the page copy.
- 1.0.0: initial rule set.
