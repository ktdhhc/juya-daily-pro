# Triage Labels

This repo uses the five canonical triage role strings as-is (local markdown tracker — labels are written as `Status:` lines in issue files):

- `needs-triage` — maintainer needs to evaluate
- `needs-info` — waiting on reporter
- `ready-for-agent` — fully specified, AFK-ready (an agent can pick it up with no human context)
- `ready-for-human` — needs human implementation
- `wontfix` — will not be actioned

No aliases or overrides are configured. In this repo's spec-driven workflow, issues created by `to-issues` from an approved spec are born `ready-for-agent`; issues that require user decisions (credentials, product calls, Cloudflare account) are marked `ready-for-human`.
