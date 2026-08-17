# Gate scorecard

Written by `npm run evals`. Do not edit by hand. CI regenerates it and fails on a diff,
so this file and the code cannot drift apart.

The golden page is a real run that passed 6/6 (`2026-07-15T19-21-30-salcedo-systems`).
Each mutation injects exactly one defect into it and names the check that should fire.

**Detection: 6/6 (100%).
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

"Also failed" measures whether a defect trips checks it has no business tripping.
Zero means each check is independent, so a failure names its own cause.

## Known blind spots

Not scored. Recorded so this states the gate's edges rather than implying it has none.

- **tel-href-digit-mismatch**: tel: href digits disagree with the link text (href "+6328845220" vs text "+63 2 8845 2210")
  Missed because the link audit only probes http(s) anchors; no check compares a tel: href against its own label. Caught instead by the advisory review pass, on the 2026-07-15T19-21-30 run.

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
