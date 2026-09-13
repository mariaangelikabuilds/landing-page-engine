#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { draftPage } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { bundleRun } from "./bundle.mjs";
import { runBrief } from "./run.mjs";

// zod stays out of the pipeline itself; the MCP SDK's registerTool API takes
// zod shapes for input schemas, so it is a dependency of this file only.
const server = new McpServer({ name: "page-engine", version: "0.2.0" });

const asText = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

// The same fields the JSON briefs carry. `imagery` was missing here until 2026-09-14, so a
// brief sent over MCP silently lost its photographs.
const briefShape = {
  brand: z.string(),
  offer: z.string().describe("What is sold, with real specifics and price"),
  audience: z.string(),
  voice: z.string().describe("Tone notes for the copy"),
  palette: z.array(z.string()).optional().describe("Hex values, if the client has them"),
  facts: z.array(z.string()).optional().describe("Verifiable claims the page may use"),
  contact: z.object({ email: z.string().optional(), phone: z.string().optional() }).optional(),
  imagery: z.array(z.string()).optional().describe("Photographs to generate and embed, one description each, at most three"),
  fontUrl: z.string().optional().describe("Only external request the page may make"),
  referenceUrl: z.string().optional(),
};

const GATE_LIST =
  "document, single-file, contact integrity, palette, directed type, imagery, side stripes, page weight, " +
  "links, 375px overflow, axe-core, copy tells, motion visibility, hero CTA, type measure, type scale, " +
  "decorative labels, theme mode";

server.registerTool(
  "run_page",
  {
    description:
      `Brief in, gated landing page out: art direction, draft, embedded fonts and photographs, the deterministic gate (${GATE_LIST}), ` +
      "an advisory rules review, a composition judge that looks at the rendered page, and up to two repairs of each kind. Returns the run directory and the ledger line.",
    inputSchema: briefShape,
  },
  async (briefBody) => {
    // Progress goes to stderr: stdout carries the JSON-RPC stream and must stay clean.
    const { runDir, ledgerLine } = await runBrief(briefBody, { say: (line) => process.stderr.write(line + "\n") });
    return asText({ runDir, ...ledgerLine });
  },
);

server.registerTool(
  "draft_page",
  {
    description:
      "Draft a self-contained landing page from brief fields, no gate and no repair. Returns the run directory for qa_page.",
    inputSchema: briefShape,
  },
  async (briefBody) => {
    const { runDir, usage } = await draftPage(briefBody);
    return asText({ runDir, outputTokens: usage.output_tokens });
  },
);

server.registerTool(
  "qa_page",
  {
    description:
      `Run the QA gate on a drafted page: the deterministic checks (${GATE_LIST}) decide the verdict; an advisory Claude review against rules/page-rules.md is attached. The composition judge runs inside run_page.`,
    inputSchema: { runDir: z.string().describe("Run directory from draft_page") },
  },
  async ({ runDir }) => asText(await qaRun(runDir)),
);

server.registerTool(
  "bundle_run",
  {
    description:
      "Write the human-readable qa-report.md for a run and append its ledger line to out/runs.jsonl.",
    inputSchema: { runDir: z.string().describe("Run directory that has a qa-report.json") },
  },
  async ({ runDir }) => asText(bundleRun(runDir)),
);

await server.connect(new StdioServerTransport());
