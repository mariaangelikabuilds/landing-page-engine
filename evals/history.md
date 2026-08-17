# Eval history

Every score this suite has produced, and what changed between them. Newest first.

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
