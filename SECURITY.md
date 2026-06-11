# Security Policy

## Reporting

Please report security issues privately to the repository owner. Do not open a
public issue containing API keys, access tokens, user prompts, or exploit details.

## Deployment requirements

- Keep all provider credentials in Worker secrets.
- Limit GitHub tokens to one repository, use short expirations, and grant only
  Contents read/write. Add Workflows write and Pages plus Administration
  read/write only when Pages setup is required.
- Set a long random `ELECTRON_ACCESS_TOKEN`.
- Restrict `ALLOWED_ORIGINS` to the deployed frontend.
- Rotate any credential that appears in browser code, logs, commits, or issues.
- Add an external rate limiter before enabling public access.
- Treat model output and generated code as untrusted input.

The frontend stores chats and non-secret preferences in browser `localStorage`.
Backend and GitHub tokens remain in memory only. A script running on the same
origin can still access in-memory credentials, so use a dedicated custom domain,
avoid untrusted third-party scripts, and close or reload the page after repository
work. The direct token flow is for personal deployments, not a multi-tenant
credential store.
