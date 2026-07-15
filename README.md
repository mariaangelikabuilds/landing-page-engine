# landing-page-engine

Brief in, QA'd landing page out. Claude drafts one self-contained HTML file against a
versioned rules file; a deterministic gate decides whether it ships. The model reviews,
the checks decide.

## Run it

```
npm install
npx playwright install chromium
echo ANTHROPIC_API_KEY=sk-ant-... > .env
node engine.mjs run briefs/demo-brief.json
```

Each run lands in `out/runs/<timestamp-brand>/` with `page.html`, screenshots at 1440
and 375, `qa-report.json`, a readable `qa-report.md`, and one ledger line appended to
`out/runs.jsonl` (verdict, check counts, token cost). Stages also run individually:
`draft <brief>`, `qa <run-dir>`, `bundle <run-dir>`. Exit code follows the verdict, so
`run` and `qa` drop straight into CI.

## What the first real run taught me

The demo brief (a fictional Manila managed-backup provider) passed all five
deterministic checks first try, and the review pass still earned its keep: it flagged
two copy claims the draft invented ("the keys stay with you", "no term, no penalty")
that appear nowhere in the brief. That is the split working as designed. Mechanical
properties (parseability, self-containment, broken links, overflow, contrast) are
cheap to check exactly, so a model should never vote on them. Judgment calls
(is this claim actually in the brief?) are where review tokens are worth spending,
and where a violations list with rule IDs beats a vibes paragraph.

## Architecture

```
brief (json or md)
      |
      v
 draft.mjs ── claude-sonnet-5, plain text ──> page.html  (one file, inline CSS, no JS)
      |
      v
 qa.mjs
      |── deterministic gate ── decides pass/fail
      |     1. document structure + single-file scan   (regex + URL parse, no DOM dep)
      |     2. link audit on external hrefs            (native fetch, HEAD then GET)
      |     3. Playwright render at 1440 and 375       (fails on horizontal overflow)
      |     4. axe-core injected into the same page    (fails on serious/critical)
      |
      |── Claude review ── advisory ──> violations[] citing rules/page-rules.md IDs
      v
 bundle.mjs ──> qa-report.md + screenshots + out/runs.jsonl ledger line
```

`rules/page-rules.md` is the contract both model passes read: the drafter obeys it,
the reviewer cites it. It is versioned and has a change log because it is a product
artifact, not a prompt fragment.

## MCP server

The same three stages are exposed as MCP tools (`draft_page`, `qa_page`,
`bundle_run`) over stdio:

```
claude mcp add --transport stdio page-engine -- node mcp-server.mjs
```

## Technical decisions

**Why vanilla single-file output.** The May 2026 comparisons of Lovable, Bolt, and v0
(wz-it.com, May 22, 2026) describe framework-locked output on all three: React,
Tailwind, shadcn/ui, Supabase or Vercel coupling, with "production hardening still
required" left to the user. Coverage of the same trio (uibakery.io, 2026) notes they
converge on one landing page skeleton, differing mainly in backgrounds and button
sizes. A dependency-free single HTML file is the counter-position: it deploys anywhere,
diffs cleanly, and the rules file can ban the shared skeleton outright
(`no-template-skeleton`).

**Why deterministic checks decide and the model only advises.** This is the eval
pyramid pattern as documented in 2026 (futureagi.com, Feb 15, 2026, updated May 20):
a deterministic floor of schema, regex, and exact-match checks runs on everything at
near-zero cost and reportedly catches 30 to 60 percent of production failures before
any judge token is spent, with model judgment reserved for what cheaper layers cannot
decide. Here the floor is the five gate checks; the judge is one structured review
call. Framer's June 16, 2026 launch of Agents, which audit pages for broken links,
contrast, and accessibility inside their canvas, validates the QA direction, but it
lives in a closed SaaS. This is the terminal-demoable, log-everything version.

**Why claude-sonnet-5 for both passes.** Drafting wants speed and a 128k output
ceiling more than maximum depth, and Sonnet 5 is intro-priced at $2/$10 per MTok
through Aug 31, 2026. The demo run cost $0.13 end to end. The review pass is a
constrained judgment task, so the same model does both; swapping the review to
`claude-haiku-4-5` is a one-line change in `claude.mjs`.

**Why structured outputs for the review only.** JSON outputs via `output_config.format`
went GA (no beta header), compiling the schema into a grammar that constrains decoding,
so the gate never parses free text. The draft stays plain text on purpose: escaping a
full HTML page inside a JSON string wastes tokens and the schema adds nothing to
markup quality.

**Why MCP SDK v1.** `@modelcontextprotocol/sdk` 1.29 is the supported production line;
v2 (renamed to `@modelcontextprotocol/server`) targets the 2026-07-28 spec and its
docs say the API can still change. The v1-to-v2 move is a small documented migration
to do after it stabilizes. One consequence: v1's `registerTool` takes zod shapes for
input schemas, so zod is in the dependency list for `mcp-server.mjs` alone; the
pipeline validates the review JSON by hand.

**What was deliberately not added.** No linkinator (the audit is a fetch loop), no
pa11y or second browser (axe-core injects into the Playwright page already open), no
dotenv (reading one line of `.env` is five lines of fs), no framework, no scaffold.
Dependencies: `@anthropic-ai/sdk`, `playwright`, `axe-core`, plus `zod` for the MCP
file as noted.
