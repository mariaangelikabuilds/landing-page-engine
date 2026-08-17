# Gate scorecard

Written by `npm run evals`. Do not edit by hand. CI regenerates it and fails on a diff,
so this file and the code cannot drift apart.

The golden page is a real run that passed 6/6 (`2026-07-15T19-21-30-salcedo-systems`).
Each mutation injects exactly one defect into it and names the check that should fire.

**Detection: 8/8 (100%).
False fails on the clean page: 0.
Collateral failures across all mutants: 0.**

| mutation | target check | result | also failed |
|----------|--------------|--------|-------------|
| `strip-closing-html` | valid-document | caught | none |
| `inline-script` | single-file | caught | none |
| `broken-cta-link` | cta-specific | caught | none |
| `fixed-width-overflow` | responsive | caught | none |
| `low-contrast-text` | semantic-html / contrast-aa | caught | none |
| `copy-tell-em-dash` | copy-tells | caught | none |
| `tel-digit-drop` | contact-integrity | caught | none |
| `tel-space-separator` | contact-integrity | caught | none |

"Also failed" measures whether a defect trips checks it has no business tripping.
Zero means each check is independent, so a failure names its own cause.

## Known blind spots

Not scored. Recorded so this states the gate's edges rather than implying it has none.

- **unsourced-copy-claims**: a claim in the copy that appears nowhere in the brief, such as the drafter's invented "the keys stay with you" and "no term, no penalty"
  Missed because checking a sentence against a brief is a judgement, not a comparison; nothing deterministic can decide it. Caught instead by the advisory review pass, which is why that pass exists.

## Method

- Labels are correct by construction: the harness knows what it broke, so nothing here
  is hand-labelled.
- The clean page runs first. If it fails any check, the suite aborts, since detection
  numbers measured against a broken baseline would mean nothing.
- Every check is local and the unreachable host uses the RFC 2606 `.invalid` TLD, so
  the suite needs no network and no API key. That is why CI can run it on fork pull
  requests, where secrets are unavailable.
- The advisory review pass is excluded on purpose: it is not what decides a verdict.
- Timings are printed to stderr, not written here, so this file stays byte-stable and a
  diff always means the score moved.
