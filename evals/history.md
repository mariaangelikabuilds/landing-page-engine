# Eval history

Every score this suite has produced, and what changed between them. Newest first.

## 2026-08-17, 14/14, and the yield problem the gate created

Detection 14/14, 0 collateral, 0 false fails. `no-side-stripe` added: a `border-left`
thicker than a hairline on a callout is the most recognisable generated-UI pattern there
is, and the new art direction stage produced one on its first genuinely good page.

The more useful number is not the detection rate. Across twelve runs of the demo brief
that day the first-pass verdict was 8 pass and 4 fail, and all four failures land in the
last four runs, after the gate grew from six checks to thirteen. Yield fell as the gate
tightened. That is the gate working, and on its own it is worthless: a page that is
rejected and then re-rolled by hand is not a pipeline.

So `run` now reads the failing checks back to the drafter and re-drafts, up to two
repairs, reusing the direction, the embedded typefaces and the already-generated
photographs. A repair pays for markup only. The checks were already saying exactly what
was wrong and where; nothing was listening.

## 2026-08-17, 13/13, after composition, motion and photographs

Detection 13/13, 0 collateral, 0 false fails. Five new mutations across four new checks.

The pages were passing every check and still looking wrong: one left column of heading and
paragraph, repeated, with a third of the viewport dead. The rules banned bad structure and
never asked for good composition, so the drafter had nothing to aim at. Rules 1.5.0 adds
composition and motion as requirements.

`canvas-use` was written as a gate and demoted before it shipped. The metric was leftmost
to rightmost content span over viewport width, and calibrating it on four real runs killed
it: the page judged badly composed scored 63.3 percent, identical to the one judged well
composed, because full-bleed bands and a wide header mask a stranded column. It stays in
the rules as judgement rather than pretending to be measurable.

Four checks did survive, each because the comparison is exact:

- `motion-visible` renders the page twice, once normally and once under
  `prefers-reduced-motion: reduce`, walking a viewport at a time so scroll-driven
  timelines actually fire, and fails on any text left invisible. Its first false positive
  was mine: `<script>` holds a text node and never renders, so the inline-script mutation
  tripped it as collateral. Non-rendered elements are excluded now.
- `palette-from-brief` promoted to a gate after the advisory review caught two separate
  drafts substituting a darker rust for the brief's `#c1502e`.
- `imagery-resolved` fails on a leftover `{{IMAGE:}}` placeholder. `single-file` could not
  catch it, because a placeholder is not an http URL and gets skipped.
- `page-weight` caps the finished page at 900kb, after a generated PNG arrived at 2MB.

Four bugs surfaced in the same pass, none of them found by reading the code:

1. Adding animations broke the screenshots. `capture` fired immediately after `goto`, so
   the 1440 shot caught the hero headline part way through a 0.6s fade. The page was
   correct and the artifact a human reviews was not. Animations settle before capture now.
2. A failed image call threw out of the draft stage and left an empty run directory,
   discarding a draft that had already been paid for. Image failures degrade now, the
   placeholder stays, and the gate refuses the page on `imagery-resolved`.
3. The review was handed raw base64 and hit 1,989,538 tokens against a 1,000,000 ceiling.
   Image data is elided before the reviewer sees the page.
4. A draft came back at exactly 32,000 output tokens, truncated mid-document with no
   closing tags. `valid-document` caught it rather than shipping it, which is the split
   working, but the ceiling was the cause. Draft raised to 64,000, review to 16,000.

Photographs generate through gpt-image-1 and fall back to gemini-2.5-flash-image, then get
re-encoded to webp at 1600px through a canvas round trip in the Playwright already present
for QA. 2074kb became 33kb, 1997kb became 20kb, and the finished page is 63kb.

The advisory review then flagged `type-scale` on the finished page, counting nine sizes
against a ceiling of five. It was right and the rule was wrong: a page with a headline, a
section heading, a lede, body, a caption and a stat numeral needs about six. The rule now
asks for contrast and a visible scale instead of scarcity.

## 2026-08-17, 8/8, after adding contact-integrity

Detection 8/8, 0 collateral, 0 false fails. Two new mutations, both targeting one new check.

Running the engine on the demo brief again produced a `tel:` href missing one digit while its
label read correctly. The same defect class had appeared on the 2026-07-15 run, in a different
position, and was recorded here as a known blind spot on the grounds that the advisory review
had caught it. This time the advisory review returned zero findings and missed it.

Two occurrences and one miss retired the blind-spot argument. A digit comparison is exact, so
it moved into the deciding half as `contact-integrity`: a `tel:` or `mailto:` href must match
its own visible label and the brief's contact detail.

Adding the check immediately failed the golden fixture, which still carried the July version of
the defect. That is the check working, not a fixture problem. The fixture's href was corrected
to `tel:+63288452210` so the baseline is clean, and the correction is recorded here rather than
made quietly.

The next engine run then satisfied the digit comparison by pasting the display string straight
into the href, spaces and all, which is not a valid tel URI under RFC 3966. The fix had changed
the failure mode instead of removing it. The check now rejects whitespace in a `tel:` href, and
`tel-space-separator` is its mutation. Rules bumped to 1.2.0. The engine run after that passed
7/7 with the href written as `tel:+63288452210` and the label left readable.

One false positive was found and fixed on the way: comparing a whole label against the address
failed a correct button reading "Email hello@salcedosystems.ph". It now extracts the address
from the label.

## 2026-08-17, 6/6, after hardening the overflow measurement

Detection 6/6, 0 collateral, 0 false fails on the clean page. Baseline gate 640 ms,
suite 4.4 s, no API key and no network.

Change: `responsive` no longer trusts `document.documentElement.scrollWidth` on its own.
It neutralises `overflow-x` on `html` and `body` (set as `!important`, so a page rule
cannot win), then takes the larger of `scrollWidth` and the furthest element right edge
before restoring the original inline styles.

Verified the fix does not over-fire: the untouched golden page still passes all six
checks through the real `qa` stage, review included.

Also fixed in the same pass: `page.screenshot` failures no longer abort a run. Chromium
dropped a `fullPage` capture once across these runs, which killed the whole gate. A
screenshot is a record of the run, not an input to a verdict, so it now degrades to a
stderr note the way the advisory review already did. Three consecutive clean runs after.

Then CI failed on its first run and was right to. The suite was described as needing no
API key, and locally that held, because a `.env` happened to exist. On a clean checkout it
did not: `qa.mjs` imports `usageCostUsd` from `claude.mjs`, which built the Anthropic
client at module scope, so importing the deterministic gate demanded a key it never uses.
The client is now built on first call. Verified the way CI does it, by moving `.env` aside
and running the suite: 6/6, exit 0.

Worth keeping as the shape of the mistake. The claim "this runs offline" was tested on the
one machine where the missing thing was present.

## 2026-08-17, 5/6, first run of the suite

Detection 5/6, 0 collateral, 0 false fails.

`fixed-width-overflow` was missed. A 2000 px element on a 375 px viewport did not fail
the `responsive` check.

Cause: the golden page sets `overflow-x: hidden` on `html, body` (line 22 of the
fixture). That clamps `scrollWidth` to the viewport, so the check read 0 px of overflow
on a page that overflowed by more than 1600.

The check was not weak, it was suppressible, and the thing suppressing it was the page
under test. The drafting model wrote a line of CSS that switched off the check meant to
catch its own layout, and nothing in the pipeline could notice: the gate reported a pass,
the screenshot looked correct, and the ledger recorded a clean run.

This is the reason the suite exists. Six checks had been asserted to work because a good
page passed them. One of the six could not have failed at all.
