# landing-page-engine

Brief in, QA'd landing page out. An art direction stage commits to the look, Claude drafts
one self-contained HTML file against a versioned rules file, a deterministic gate decides
whether it ships, and a composition judge looks at the rendered page and sends it back if
the layout is wrong. The model reviews, the checks decide.

## Run it

```
npm install
npx playwright install chromium        # playwright 1.61 wants chromium build 1228
echo ANTHROPIC_API_KEY=sk-ant-... > .env
node engine.mjs run briefs/salcedo-systems.json
```

Each run lands in `out/runs/<timestamp-brand>/` with `page.html`, screenshots at 1440 and
375, `qa-report.json`, a readable `qa-report.md`, `judge.json`, `run.log` (the terminal
transcript) and one ledger line appended to `out/runs.jsonl` (verdict, check counts,
attempts, judge findings, every model call costed). A repaired run keeps its earlier
attempts under `attempts/`. Stages also run individually: `draft <brief>`, `qa <run-dir>`,
`judge <run-dir>`, `bundle <run-dir>`. Exit code follows the verdict.

Three briefs ship in `briefs/`: a managed-backup provider (B2B services), a coffee
subscription (warm consumer) and clinic scheduling software (the category where the
default look is strongest). Same fields, three different pages.

## What a run does

1. **Direction.** Before any markup, the model commits to three voice words, a physical
   object and its material, a lane from a fixed list, a palette strategy against a named
   reference, both typefaces, the hero (an outcome headline, one call to action, one proof
   fact), the grid, the one section that breaks it, a density map, where each photograph
   sits, and a photographic treatment. It names its own first reflexes and refuses them.
   The code refuses what the prompt cannot enforce: 40 training-data fonts, the "document"
   lane and any typewritten-paper object (the second-order reflex every IT brief lands on),
   a lane already rejected, and any font, voice word or lane already carrying this brand's
   last four runs or any other brand's latest. A refused direction is retried once with the
   refusal quoted.
2. **Draft.** Claude writes the page to that direction and to `rules/page-rules.md`. The two
   families are fetched from Google Fonts once and embedded as woff2 data URIs; the
   photographs are generated (gpt-image-1, then gemini-2.5-flash-image if it is out) and
   embedded as webp. The page makes zero external requests.
3. **Gate.** Eighteen deterministic checks decide the verdict: document structure,
   single file, contact integrity, palette fidelity, directed type, resolved imagery, no
   side stripes, page weight, link audit, 375px overflow, axe-core, copy tells, motion
   visibility, and five composition checks measured on the rendered text ink: one call to
   action above the fold, no decorative labels, type measure, type scale, theme mode.
   Four more composition metrics are reported as advisory with their numbers.
4. **Review and judge.** An advisory review reads the markup against the rules file. A
   composition judge reads the page as screenshot tiles at 1440 and 375 and returns
   findings with a severity; "serious" is defined narrowly (a stranded column, a hero that
   fails the one-CTA rule, the stock skeleton, a repeated formula, a stat row, a duplicated
   photograph). Neither can change the verdict.
5. **Repair.** A failing check is read back to the drafter with the exact node, colour
   and ratio, or the exact element that overflowed, and the page is redrafted up to three
   times. A page that passes but draws serious judge findings is redrafted up to twice
   with a prompt that may move the grid but not the palette, the type or a sentence of
   copy. Direction, fonts and photographs are prepared once and reused, so a repair pays
   for markup only.

## Why the 2.0.0 rules exist

On 2026-08-17 the engine passed 13 of 13 checks on a page that was, to its owner, the
generic AI landing page: a dark stock server room with a mono headline over it, twelve
small-caps labels, a 60ch measure set on the wrapper so everything stranded left with a
dead band beside it. Four directed runs had converged on the same laminated maintenance
log in Courier Prime, "unhurried" four times out of four. Three things were wrong, and
`rules/page-rules.md` records each.

The direction prompt's example objects were all typewritten paper and its anchors were
all text-forward restraint, so the model went where it was pointed. Nothing in the
pipeline ever looked at the render: the screenshots were written and read by no code, the
review read markup with the images elided (and 150 KB of embedded fonts not elided, which
is where its $0.44 cost and its dropped streams came from), and its findings fed nothing.
And the gate could not tell a good page from a harmless one: every composition rule was
advisory, and the one attempt to measure canvas use had measured element boxes, so a
block heading in a wide wrapper reported a right edge it never inked.

The 2.0.0 gates were calibrated on the nineteen runs on record before they went in, and
`evals/calibrate.mjs` reprints that table from `out/runs` against `evals/labels.json`.
`stranded-column` is the ink-based successor to the cut metric; it ships advisory until
the labels say it discriminates, and the judge covers the same defect meanwhile.

## Measuring the gate

`evals/` tests the gate from the other direction: it takes a page that already passed,
injects exactly one known defect at a time, and asks whether the right check fires, and
only the right check.

```
npm run evals
```

Labels are correct by construction. Every mutation is local, so the suite runs with no
API key and no network, which is why CI runs it on fork pull requests.
`evals/SCORECARD.md` and `evals/results.json` are rewritten on every run and CI fails on
a diff. The golden fixture is always a real passing run; replacing it is recorded in
`evals/history.md`, never hand-edited.

The suite carries twenty-two mutations: fourteen for the original checks and eight for
the composition gates (a long measure, a flat scale, a tracked-caps label, a small-caps
label, a numbered heading, a missing hero CTA, two hero CTAs, a theme flip). Two blind
spots are named rather than implied: a copy claim the brief does not support, and
composition beyond the measurable set, which is the judge's job.

The lesson that repeats through `evals/history.md`: a check that reports a count teaches
the repair nothing. Contrast failed twice in a row as "5 node(s)" and overflow three times
as "393px too wide" before the checks named the nodes and the elements.

## Cost

Measured 2026-09-14 at Sonnet 5's $2/$10 per million tokens. Direction about $0.09,
a draft about $0.15 at medium effort (31k output tokens at high against 13k at medium,
and the judge preferred the medium page), review about $0.08, judge about $0.06, two
photographs about $0.13 outside the ledger. A run that passes first time costs about
$0.40; one that needs a repair of each kind about $0.75. Effort per stage is overridable
with `PAGE_ENGINE_EFFORT_<STAGE>`.

## Architecture

```
brief (json)
   |
   v
direction.mjs ── refuses reflex fonts, the document lane, repeats ──> direction (JSON)
   |
   v
draft.mjs ── claude-sonnet-5 ──> page.html   font.mjs embeds woff2, image.mjs embeds webp
   |
   v
qa.mjs ── 18 deterministic checks decide ── qa-composition.mjs measures the rendered ink
   |── rulesReview ── advisory, markup with data URIs elided
   v
judge.mjs ── advisory, screenshot tiles at 1440 and 375 (tiles.mjs)
   |
   v
run.mjs ── up to 3 deterministic and 2 composition repairs into one run dir
   |
   v
bundle.mjs ──> qa-report.md + out/runs.jsonl ledger line
```

`rules/page-rules.md` is the contract every model pass reads: the drafter obeys it, the
reviewer cites it, the judge reads its Structure and Composition sections. It is versioned
and has a change log because it is a product artifact, not a prompt fragment.
`evals/convergence.mjs` prints what each brand was given and exits non-zero when brands
share a lane, a font or a voice word.

## MCP server

Four tools over stdio: `run_page` (the whole loop), `draft_page`, `qa_page`, `bundle_run`.

```
claude mcp add --transport stdio page-engine -- node mcp-server.mjs
```

## Technical decisions

**Why vanilla single-file output.** Framework-locked generators converge on one landing
page skeleton and leave production hardening to the user. A dependency-free single HTML
file deploys anywhere, diffs cleanly, and the rules file can ban the shared skeleton
outright.

**Why deterministic checks decide and the models only advise.** Mechanical properties
are cheap to check exactly, so a model never votes on them. Judgement (is this claim in
the brief, is this page well composed) is where model tokens are spent, and the output of
that judgement is a repair prompt, never a verdict. An LLM judge is not reproducible
enough to fail a build; a measured check is.

**Why the judge sees tiles, not the full page.** The API downsizes anything over about
1568px on its long edge, so a 1440 by 4000 capture is unreadable. Eight 1440x900 tiles
and ten 375x812 tiles cost about 19k input tokens and the judge can read the type.

**Why claude-sonnet-5 for every pass.** Drafting wants speed and a large output ceiling;
the review and the judge are constrained judgement tasks. Sonnet 5 is $2/$10 per million
tokens (the scheduled September increase did not happen).

**Why structured outputs for direction, review and judge only.** JSON schema output
constrains decoding, so nothing parses free text. The draft stays plain text on purpose:
escaping a page inside a JSON string wastes tokens and adds nothing to markup quality.

**Why MCP SDK v1.** `@modelcontextprotocol/sdk` 1.29 is the supported production line; the
v2 migration is small and documented and can wait until it stabilises. zod is in the
dependency list for `mcp-server.mjs` alone.

**What was deliberately not added.** No linkinator, no pa11y, no dotenv, no framework,
no scaffold. Dependencies: `@anthropic-ai/sdk`, `playwright`, `axe-core`, plus `zod`.
