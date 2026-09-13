# buzz-mcp-bridge

A small stdio MCP server that gives [Buzz](https://github.com/block/buzz)
managed agents the MCP servers already configured in Claude Code user scope
and Claude Desktop, behind an explicit per-agent allowlist. One file,
`index.mjs`, Node 20+, one runtime dependency (`@modelcontextprotocol/sdk`).
It is not deployed anywhere: an operator clones the repo, runs `npm install`,
and points a Buzz agent's `mcp_command` at a wrapper script that execs it.
Public, Apache-2.0, not affiliated with Block.

```sh
npm install                                   # the only setup step
node index.mjs --allow blotato,grafana        # run with an allowlist
BUZZ_MCP_ALLOW=blotato node index.mjs         # same, allowlist from env
node --check index.mjs                        # syntax check, no test suite exists
```

There is no build step, no test suite and no CI. `.github/` does not exist.

---

## 1. The one rule

**No allowlist, no startup. Grants are per agent, explicitly.**

`main()` in `index.mjs` exits with code 2 when neither `--allow` nor
`BUZZ_MCP_ALLOW` names a server, and again when an allowlisted name is not in
any config. The user's MCP config is their credentialed keyring, and an agent
gets only what it was granted. Never add a wildcard, an "allow all" mode, a
default allowlist, or a fallback that starts with zero upstreams. Any of those
removes the reason this project exists.

## 2. Layout

```
index.mjs          the whole bridge: config loading, upstream links, the server
package.json       bin entry buzz-mcp-bridge -> index.mjs, engines node >=20
package-lock.json  committed; pins @modelcontextprotocol/sdk (1.30.0 today)
README.md          install, the Buzz wiring, v0.1 limits
LICENSE            Apache-2.0
```

`index.mjs` has three parts, marked by comment rules:

- **config loading**: `loadServerConfigs()` reads `mcpServers` from
  `~/Library/Application Support/Claude/claude_desktop_config.json` and then
  `~/.claude.json`. Later sources win, so **Claude Code user scope beats
  Desktop on a name collision.** The README states this; keep them in step.
- **upstream links**: `connectUpstream()` builds a stdio or streamable-http
  client per allowlisted server, then snapshots `listTools()`.
- **bridge**: `main()` parses the allowlist, connects each upstream in order,
  and serves `ListTools` and `CallTool` over `StdioServerTransport`.

## 3. Invariants an edit could break

- **stdout is the MCP wire.** All diagnostics go through `log()`, which is
  `console.error`. A single `console.log` corrupts the protocol stream for
  the agent. Upstream stdio servers are spawned with `stderr: "ignore"`.
- **Tool names are `<server>__<tool>`**, the naming Claude Code uses natively.
  `CallTool` routes by splitting at the **first** `__`, so a tool name may
  contain `__` but a server name that contains `__` will not route. Nothing
  guards against that today.
- **Exit codes mean things.** 2 is a refusal (no allowlist, or an allowlisted
  name missing from config, which also logs the known server names). 1 is a
  fatal error from `main()`. Connections are sequential and unguarded, so one
  upstream that fails to connect takes the whole bridge down with exit 1.
- **Transport selection.** `type` defaults to `http` when `url` is set, else
  `stdio`. Any config with a `command` is treated as stdio. `sse` is sent to
  `StreamableHTTPClientTransport`, not a legacy SSE transport. Interactive
  OAuth is out of scope; remote servers use static headers.
- **`${VAR}` expansion is for header values only** (`expandEnv()`), read from
  the bridge's own environment, and an unset variable expands to the empty
  string. It does not touch `url`, `args` or `env`. Stdio upstreams get the
  bridge's full `process.env` merged with the server's own `env`.
- **Tools only, snapshotted at startup.** No resources, no prompts, no
  `listChanged`. Adding any of these is a feature; update the "v0.1 limits"
  section of the README and the header comment in `index.mjs` with it.
- **Version `0.1.0` is written in three places**: `package.json`, the
  `Client` name in `connectUpstream()`, and the `Server` in `main()`. Bump
  them together.

## 4. Truth and safety boundaries

- **Never log a secret.** Today `log()` prints server names, config source
  labels and tool counts only. Never print header values, env values, args or
  a merged config object, because every one of them can hold a key.
- **This repo is public.** Never commit a wrapper script with real paths or
  keys, a copy of anyone's `~/.claude.json`, or a `managed-agents.json`.
  Examples use placeholder names like `blotato` and `/path/to/`.
- **The README describes Buzz, which we do not own.** The
  `managed-agents.json` location, "that field has no UI" and the
  quit-edit-relaunch order are observations about upstream Buzz. Re-check
  against `block/buzz` before changing them, and do not add claims about Buzz
  internals that you have not confirmed.
- **The README's limits must match the code.** If `index.mjs` gains or loses a
  capability, the "v0.1 limits (deliberate)" section changes in the same
  commit.
- The Desktop config path is macOS only. Do not document other platforms as
  supported until the code reads their paths.

## 5. Working here

- `git pull --rebase` before pushing. Never force-push.
- New behaviour arrives with tests. There is no harness yet; the first tests
  should use Node's built-in `node --test`, like the sibling hachiflow repos,
  rather than adding a test framework.
- One runtime dependency, on purpose. Do not add another without a clear
  reason, and commit `package-lock.json` with any dependency change.
- Commit messages so far: a summary line (`buzz-mcp-bridge v0.1: ...`) and a
  body saying what changed and how it was proven.

---

## Engram: mandatory company memory (all operations, all subagents, all tickets)

engram is Hachiflow's company brain (CLI `engram` on PATH; MCP server `engram`). Using it is **required** for every session, operation, subagent, and ticket in this repo.

1. **Search first**: `engram search "<topic>"` and `engram tasks list` before starting any task. Never ask the user for context engram may already hold.
2. **Capture as you work**: every decision (with the why), root cause, incident, milestone, durable insight, and pivotal user feedback, via `engram capture "<fact>" --category <cat> --tags <...> --metadata '{...}'`. One entry per fact, self-contained, dated, with a concrete pointer (commit SHA, PR/issue, file). Never put credentials/tokens/keys in content.
3. **Tickets are engram tasks**: create with `engram tasks create`, keep status current with `engram tasks update`; fall back to a `task_note` entry if task creation fails. Mirror GitHub issues into engram on open and close.
4. **Subagents inherit this policy**: every spawned agent's prompt MUST state these requirements (search before duplicating; capture findings via the CLI before returning). The parent verifies its children captured.
5. **Historical events**: pass `--occurred-at <RFC-3339>` (never future). `created_at` = capture time; `occurred_at` = event time.
6. **Before ending a substantive turn**: verify the turn's decisions/outcomes are captured; if not, capture them then.

Environment note: category `incident` currently requires a hardware signing key, so file incidents as `insight` until one is provisioned.
