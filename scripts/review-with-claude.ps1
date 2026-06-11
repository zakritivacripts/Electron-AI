param(
  [string]$Model = "claude-opus-4-8"
)

$ErrorActionPreference = "Stop"

$prompt = @"
Act as the independent Claude Code reviewer for Electron AI.

Read AGENTS.md and CLAUDE.md, then inspect the current repository and Git diff.
Focus on correctness, security, provider API compatibility, browser regressions,
deployment failures, and missing verification. Do not edit files.

Return actionable findings ordered by severity with file and line references.
If there are no findings, say so and identify any remaining test gaps.
"@

& claude `
  --print `
  --model $Model `
  --effort max `
  --tools "Read,Grep,Glob,Bash(git diff *),Bash(git status *)" `
  --permission-mode dontAsk `
  --no-session-persistence `
  $prompt

if ($LASTEXITCODE -ne 0) {
  throw "Claude Code review failed. Open 'claude', run '/login', and try again."
}
