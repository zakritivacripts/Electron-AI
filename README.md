# Electron AI

Electron AI is a multi-model chat and coding workspace built for GitHub Pages. It
routes a request to specialist models, combines their recommendations, asks Claude
to review the draft, and asks GPT-5.5 to verify the final revision.

The static interface works immediately in demo mode. Real model calls use the
included Cloudflare Worker so provider keys never appear in browser JavaScript or
the public repository.

## What is included

- Responsive GitHub Pages interface with persistent local chat history
- New-chat sidebar, model council, effort controls, and four approval policies
- Website code editor with copy, download, and explicit VS Code handoff
- Secure Worker adapters for OpenAI, Anthropic, Gemini, and Qwen-compatible APIs
- Parallel specialist calls with partial-failure handling
- Claude review followed by GPT verification
- Automatic GitHub Pages deployment workflow

## Codex and Claude Code

The repository includes `AGENTS.md`, `CLAUDE.md`, and a read-only review command:

```powershell
.\scripts\review-with-claude.ps1
```

This asks Claude Code Opus 4.8 for an independent max-effort review, then leaves
the findings for Codex to verify and resolve. Claude Code must be authenticated
locally first. The production Worker uses the Claude API for its model-level
quality pass; it does not pretend that an API model call is the Claude Code CLI.

## Model council

| Display name | Default API model ID | Assignment |
| --- | --- | --- |
| ChatGPT 5.5 | `gpt-5.5` | Lead reasoning and final verification |
| Claude Opus 4.8 | `claude-opus-4-8` | Primary independent review |
| Claude Opus 4.7 | `claude-opus-4-7` | Architecture alternatives |
| Claude Opus 4.6 | `claude-opus-4-6` | Long-horizon planning |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Research and tool-use perspective |
| Qwen 3.7 Max | `qwen3.7-max` | Diverse reasoning pass |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Fast implementation |

OpenAI, Anthropic, and Google IDs above match their public documentation as of
June 11, 2026. Qwen availability and naming can differ by Alibaba Cloud region or
account; set `QWEN_MODEL_ID` to the exact ID shown in your Model Studio console.
Every model is also subject to provider access, pricing, quotas, and retirement.

## Publish the frontend

1. Create a GitHub repository named `electron-ai`.
2. Put these files on its `main` branch.
3. Open **Settings → Pages** in the repository.
4. Set **Source** to **GitHub Actions**.
5. The included `pages.yml` workflow publishes `index.html`, `styles.css`, and
   `app.js`.

The site will be available at:

```text
https://YOUR-GITHUB-USER.github.io/electron-ai/
```

The interface stores chats and non-secret preferences in browser `localStorage`.
The backend access token is held in memory only and must be entered again after a
page reload. Use a dedicated custom domain instead of a shared
`username.github.io` origin for sensitive conversations because browser storage
is origin-scoped, not repository-path-scoped. Demo mode works on the normal
GitHub Pages URL; live backend mode should use the dedicated domain.

## Deploy the Worker backend

Cloudflare Workers is one convenient backend option; GitHub Pages itself cannot
execute server code or keep API keys secret.

From the `worker` directory:

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put QWEN_API_KEY
npx wrangler secret put ELECTRON_ACCESS_TOKEN
npx wrangler deploy
```

Before deployment, connect the Pages site to a dedicated custom domain and change
`ALLOWED_ORIGINS` in `worker/wrangler.toml` to that origin. The Worker refuses to
start with the checked-in placeholder:

```toml
ALLOWED_ORIGINS = "https://electron.example.com"
```

Then open **Connection** inside Electron AI and enter the deployed Worker URL and
the same `ELECTRON_ACCESS_TOKEN`.

For local Worker development:

```bash
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:8000
```

The `ELECTRON_RATE_LIMITER` binding allows six council runs per minute per access
token in each Cloudflare location. Change its namespace to an integer unique in
your Cloudflare account.

Provider keys:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `QWEN_API_KEY`

Optional configuration:

- `OPENAI_MODEL_ID`
- `GEMINI_MODEL_ID`
- `QWEN_MODEL_ID`
- `OPENAI_BASE_URL`
- `ANTHROPIC_BASE_URL`
- `GEMINI_BASE_URL`
- `QWEN_BASE_URL`
- `ALLOWED_ORIGINS`
- `ELECTRON_ACCESS_TOKEN`

## Effort behavior

- **Fast** uses low reasoning effort and smaller output budgets.
- **Balanced** uses high OpenAI/Anthropic effort and medium Gemini thinking.
- **Maximum** uses OpenAI `xhigh`, Anthropic `max`, Gemini `high`, and larger
  bounded output budgets.

There is intentionally no literal “unlimited” mode. Provider rate limits, context
windows, output limits, account quotas, latency, and billing still apply. Removing
all safeguards would enable runaway spend and denial-of-service failures. The
Worker keeps generous but explicit request and output caps that can be tuned in
`worker/worker.js`.

## VS Code handoff

Browsers cannot silently write into a local VS Code workspace. Electron AI uses an
explicit handoff:

1. It downloads the generated artifact.
2. It requests the `vscode://` protocol.
3. You choose the downloaded file in VS Code.

If this frontend is later wrapped in an Electron desktop shell, provide a
validated `window.electronAI.openInVSCode()` bridge. The frontend already detects
and uses that bridge without exposing arbitrary shell commands.

## Security notes

- Never add provider keys to `app.js`, repository secrets exposed to Pages, or
  browser build variables.
- Set `ELECTRON_ACCESS_TOKEN` and a strict `ALLOWED_ORIGINS` value.
- The reference Worker requires the access token, Cloudflare rate-limiting
  binding, and bounded per-isolate concurrency. Add durable per-user
  authentication, audit logs, and persistent spend controls before offering this
  as a public multi-user service.
- Approval settings govern this text-generation workflow. The included Worker
  does not execute tools or modify projects. A future tool-execution service must
  use server-side pending actions and bind each approval to exact arguments.
- Generated code is untrusted until reviewed.

## Current provider documentation

- [OpenAI GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [Anthropic models](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Gemini 3.1 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Alibaba Cloud Model Studio models](https://help.aliyun.com/zh/model-studio/models)

## License

MIT
