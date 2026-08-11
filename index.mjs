#!/usr/bin/env node
// buzz-mcp-bridge
//
// Buzz managed agents run as embedded engines (buzz-acp spawns the runtime in
// ACP mode) and inherit NONE of your interactive MCP config. The one hook Buzz
// gives an agent is `mcp_command`: a single command that speaks stdio MCP.
//
// This bridge is that command. It reads the MCP servers you already manage in
//   1. Claude Code user scope   (~/.claude.json, top-level mcpServers)
//   2. Claude Desktop           (~/Library/Application Support/Claude/
//                                claude_desktop_config.json)
// connects to the ones you EXPLICITLY allow, and re-exposes their tools as one
// aggregated stdio MCP server, namespaced `<server>__<tool>` (the same naming
// Claude Code itself uses).
//
// Security stance: the allowlist is REQUIRED. Your user config is your
// credentialed keyring; an agent should get the servers you grant it, not
// everything you have. Run one bridge per agent, each with its own allowlist.
//
// Usage (as a Buzz agent's mcp_command, via a small wrapper script):
//   buzz-mcp-bridge --allow blotato
//   buzz-mcp-bridge --allow blotato,grafana
//   BUZZ_MCP_ALLOW=blotato buzz-mcp-bridge
//
// v0.1 limits, on purpose: stdio and streamable-http upstreams with static
// headers only (no interactive OAuth flows); tool lists are snapshotted at
// startup; tools only (no resources/prompts passthrough yet).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const log = (...a) => console.error("[buzz-mcp-bridge]", ...a);

// ------------------------------------------------------------ config loading

function readJsonIfExists(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/** ${VAR} expansion from the bridge's own environment, for header values. */
function expandEnv(value) {
  return typeof value === "string"
    ? value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? "")
    : value;
}

function loadServerConfigs() {
  const home = homedir();
  const sources = [
    // Later entries win on name collision: Claude Code user scope is the
    // source of truth, Desktop fills in anything Code doesn't know about.
    { label: "claude-desktop", data: readJsonIfExists(join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")) },
    { label: "claude-code-user", data: readJsonIfExists(join(home, ".claude.json")) },
  ];
  const merged = new Map();
  for (const { label, data } of sources) {
    const servers = data?.mcpServers ?? {};
    for (const [name, cfg] of Object.entries(servers)) {
      merged.set(name, { ...cfg, __source: label });
    }
  }
  return merged;
}

// ------------------------------------------------------------ upstream links

async function connectUpstream(name, cfg) {
  const client = new Client({ name: `buzz-mcp-bridge:${name}`, version: "0.1.0" });
  let transport;
  const type = cfg.type ?? (cfg.url ? "http" : "stdio");
  if (type === "stdio" || cfg.command) {
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) },
      stderr: "ignore",
    });
  } else if (type === "http" || type === "sse") {
    const headers = {};
    for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = expandEnv(v);
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers },
    });
  } else {
    throw new Error(`unsupported server type "${type}" for ${name}`);
  }
  await client.connect(transport);
  const { tools } = await client.listTools();
  log(`connected ${name} (${cfg.__source}): ${tools.length} tools`);
  return { client, tools };
}

// ------------------------------------------------------------------- bridge

async function main() {
  const argAllow = process.argv.includes("--allow")
    ? process.argv[process.argv.indexOf("--allow") + 1]
    : null;
  const allowRaw = argAllow ?? process.env.BUZZ_MCP_ALLOW ?? "";
  const allow = allowRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) {
    log("refusing to start: no allowlist.");
    log("Pass --allow <name>[,<name>...] or set BUZZ_MCP_ALLOW.");
    log("Your user config is your keyring; grant servers per agent, explicitly.");
    process.exit(2);
  }

  const configured = loadServerConfigs();
  const missing = allow.filter((n) => !configured.has(n));
  if (missing.length) {
    log(`allowlisted but not found in any config: ${missing.join(", ")}`);
    log(`known servers: ${[...configured.keys()].join(", ") || "(none)"}`);
    process.exit(2);
  }

  const upstreams = new Map(); // prefix -> { client, tools }
  for (const name of allow) {
    upstreams.set(name, await connectUpstream(name, configured.get(name)));
  }

  const server = new Server(
    { name: "buzz-mcp-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...upstreams.entries()].flatMap(([prefix, u]) =>
      u.tools.map((t) => ({ ...t, name: `${prefix}__${t.name}` })),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const full = req.params.name;
    const sep = full.indexOf("__");
    if (sep === -1) throw new Error(`unknown tool ${full}`);
    const prefix = full.slice(0, sep);
    const upstream = upstreams.get(prefix);
    if (!upstream) throw new Error(`unknown server prefix ${prefix}`);
    return upstream.client.callTool({
      name: full.slice(sep + 2),
      arguments: req.params.arguments ?? {},
    });
  });

  await server.connect(new StdioServerTransport());
  log(`serving ${allow.length} upstream(s) over stdio`);
}

main().catch((err) => { log("fatal:", err?.message ?? err); process.exit(1); });
