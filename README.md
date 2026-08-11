# buzz-mcp-bridge

Give [Buzz](https://github.com/block/buzz) managed agents the MCP servers your
Claude Desktop / Claude Code config already has, behind an explicit per-agent
allowlist.

## The problem

Buzz managed agents run as embedded engines: `buzz-acp` spawns the runtime
(Claude, Goose, Codex) in ACP mode with host-controlled configuration. Your
interactive MCP config, the servers you added in Claude Desktop or with
`claude mcp add -s user`, does not inherit. That is deliberate and correct:
your user config is your credentialed keyring (billing, admin consoles, your
browser), and thirteen semi-trusted agents should not wake up holding it.

The hook Buzz gives you is `mcp_command`: one command per agent that speaks
stdio MCP. This bridge is that command.

## What it does

1. Reads `mcpServers` from Claude Code user scope (`~/.claude.json`) and
   Claude Desktop (`claude_desktop_config.json`). Code wins name collisions.
2. Connects only to the servers you **explicitly allow** for this agent.
3. Re-exposes their tools as one stdio MCP server, namespaced
   `<server>__<tool>`, the same naming Claude Code uses natively.

No allowlist, no startup. Grants are per agent, on purpose.

## Install

```sh
git clone https://github.com/hachiflow/buzz-mcp-bridge
cd buzz-mcp-bridge && npm install
```

Write a tiny wrapper per agent (keeps secrets and allowlists out of Buzz's
config file):

```sh
#!/bin/sh
# my-agent-mcp.sh
exec node /path/to/buzz-mcp-bridge/index.mjs --allow blotato,grafana
```

Point the agent's `mcp_command` at the wrapper. Today that field has no UI;
edit `managed-agents.json` in Buzz Desktop's application-support directory:

```
~/Library/Application Support/xyz.block.buzz.app/agents/managed-agents.json
  -> your agent's entry -> "mcp_command": "/path/to/my-agent-mcp.sh"
```

**The trap that will eat your evening:** Buzz Desktop reads its config at app
startup and spawns agents from memory. Restarting the *agent* is not enough.
The order is: quit Buzz Desktop fully, edit the file, relaunch. Then verify
from outside, never from inside the agent:

```sh
ps eww <agent-harness-pid> | tr ' ' '\n' | grep -c YOUR_EXPECTED_VAR
```

## v0.1 limits (deliberate)

- stdio and streamable-http upstreams with static headers. Interactive OAuth
  flows are out of scope; use API-key headers for remote servers.
- Tool lists snapshot at startup. Tools only (no resources/prompts yet).
- `${VAR}` expansion in header values reads the bridge's environment, so
  secrets can live in files your wrapper sources rather than in any config.

## Why we built it

Hachiflow runs its marketing as a Buzz agent (Gary V) in our own hosted hive.
He posts to X through Blotato's MCP, granted through exactly this bridge, and
nothing else from our keyring. Field notes: https://hachiflow.com/blog

Apache-2.0. Not affiliated with Block; Buzz is their open-source project.
