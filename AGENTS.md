<!-- AI_ACROBATICS_SOURCE_PREFLIGHT_START -->
# AI Acrobatics Agent Contract

Before non-trivial AI Acrobatics work, run the local source preflight:

```bash
~/.ai-acrobatics/agent-preflight/agent-source-preflight.sh --print
```

Use Obsidian as the source router:

```bash
OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/opt/agency-workspace/obsidian-vault}" /opt/agency-workspace/obsidian-vault/Tools/obsidian-context-router.sh route "<task>"
```

Load the cited MOCs, SOPs, Laws, and project files before editing or debugging. Verify live evidence before reporting status. If blocked, name the exact missing file, auth, service, platform signal, or source-of-truth mismatch. Write durable workflow/source changes back to the vault or memory.
<!-- AI_ACROBATICS_SOURCE_PREFLIGHT_END -->

## Graphify and Graft
Use the repo-local graphify-out graph for structural context and query it before broad exploration. Use repo-local Graft wiring via \`graft ask\`/\`graft check\`; keep generated /graft/ cache uncommitted.
