#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { draftPage } from "./draft.mjs";
import { qaRun } from "./qa.mjs";
import { bundleRun } from "./bundle.mjs";

// zod stays out of the pipeline itself; the MCP SDK's registerTool API takes
// zod shapes for input schemas, so it is a dependency of this file only.
const server = new McpServer({ name: "page-engine", version: "0.1.0" });

const asText = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

server.registerTool(
  "draft_page",
  {
    description:
      "Draft a self-contained landing page from brief fields. Returns the run directory for qa_page.",
    inputSchema: {
      brand: z.string(),
      offer: z.string().describe("What is sold, with real specifics and price"),
      audience: z.string(),
      voice: z.string().describe("Tone notes for the copy"),
      palette: z.array(z.string()).optional().describe("Hex values, if the client has them"),
      facts: z.array(z.string()).optional().describe("Verifiable claims the page may use"),
      contact: z.object({ email: z.string().optional(), phone: z.string().optional() }).optional(),
      fontUrl: z.string().optional().describe("Only external request the page may make"),
      referenceUrl: z.string().optional(),
    },
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
      "Run the QA gate on a drafted page: deterministic checks (single-file scan, link audit, 375px overflow, axe-core) plus an advisory Claude review against rules/page-rules.md.",
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
