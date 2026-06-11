# Security Policy

## Reporting

Please report security issues privately to the repository owner. Do not open a
public issue containing API keys, access tokens, user prompts, or exploit details.

## Deployment requirements

- Keep all provider credentials in Worker secrets.
- Set a long random `ELECTRON_ACCESS_TOKEN`.
- Restrict `ALLOWED_ORIGINS` to the deployed frontend.
- Rotate any credential that appears in browser code, logs, commits, or issues.
- Add an external rate limiter before enabling public access.
- Treat model output and generated code as untrusted input.

The demonstration frontend stores chats and non-secret preferences in browser
`localStorage`. The backend token remains in memory only. Browser storage is still
shared by every project on the same origin, so use a dedicated custom domain for
sensitive work. This is not a multi-tenant data store.
