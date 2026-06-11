# Electron AI Agent Rules

## Objective

Build Electron AI as a secure static frontend plus an authenticated orchestration
backend. Preserve the trust boundary: browser code must never contain provider
keys or privileged tool execution.

## Codex and Claude Code loop

1. The implementing agent reads the existing code and makes a focused change.
2. The other agent reviews the actual diff for correctness, security, regressions,
   provider compatibility, and missing tests.
3. The implementing agent resolves every actionable finding or records why it is
   not applicable.
4. Run syntax checks, Worker mock tests, and browser interaction checks before
   committing.

Do not claim a cross-review occurred unless the second agent actually completed
the review. `scripts/review-with-claude.ps1` runs a read-only Claude Code pass.

## Verification

Use the bundled or system Node runtime:

```powershell
node --check app.js
node --check worker/worker.js
```

Render the frontend at desktop and mobile widths. Exercise new chat, approval
cancel, run stop/restart, artifact generation, and the website editor.

## Security

- Never persist access tokens in browser storage.
- Keep the Worker fail-closed when auth or allowed origins are missing.
- Do not add arbitrary command execution to the VS Code handoff.
- Treat model output, attachments, Markdown, and generated code as untrusted.
- Keep request, concurrency, output, and provider timeout limits explicit.
