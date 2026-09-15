# GitHub deployment configuration

Credentials are GitHub **environment secrets**. Public settings are GitHub
**environment variables**. The same name is reused across environments with
independent values. Do not add PROD_ or STAGING_ prefixes.

These commands set configuration only; they do not deploy. Each `gh secret set`
command prompts for a hidden value. Paste at that prompt, never into `--body`,
shell history, a PR or a checked-in file. For a multiline private key, redirect
stdin from the existing protected key file. `gh variable set` prompts for a
public value; public values may also use `--body`.

The deployment workflows currently target production resources only and refuse
staging/development dispatches. Creating GitHub environments and credentials
alone does not provision isolated Workers, hosts, routes, buckets or databases.
Use the same commands with the new environment name when those targets exist,
and supply its own credentials and public configuration. Never copy production
credentials or resource IDs into staging to make a job pass.

Existing correctly scoped values do not need to be reset. Optional integrations
should be configured as complete groups, not populated with dummy credentials.
The GitHub-provided `github.token` is automatic and needs no `gh secret set`.

This repository has no GitHub deployment workflow or user-managed CI
credential consumer. No `gh secret set` commands are required. Runtime user
credentials must continue to follow their existing runtime configuration path.


CLI references: [secret set](https://cli.github.com/manual/gh_secret_set) and
[variable set](https://cli.github.com/manual/gh_variable_set).
