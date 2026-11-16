# VIS Nexo — Security policy

## Reporting
**Do not open public issues with exploits, keys, credentials or private user data.**
Report vulnerabilities using the repository's **Security → Report a vulnerability** private advisory.
For account compromise, revoke affected credentials immediately before discussing the issue.

## Scope
VIS Nexo (Tauri client), VIS Ceibo / Social Worker, VIS Universe and associated
GitHub Actions are in scope. The Horizon fork is maintained separately.
This repository does not host secrets, private keys, OAuth refresh tokens or user worlds.

## Release principles
- No unreviewed code or untrusted pull request may access release, Cloudflare or signing credentials.
- Cloudflare production deployment uses a protected GitHub Environment and least-privilege API token.
- Every download must be size-limited and source-checked; executable releases must additionally be
  signed with an independently verified release key.
- Windows Authenticode (SignPath, if approved) and the Tauri updater key are separate trust layers.
- A world backup synced via a third-party desktop folder is not guaranteed uploaded remotely.
- Never run native mods or scripts from untrusted project metadata.
- Do not assume a SHA-256 published alongside an archive is independently authenticated.

## Repository controls (configured in GitHub Settings, not by this file)
Enable rulesets for main and release tags; prevent force pushes/deletions; require pull requests,
CI and code-owner reviews. Require an approving human for production environments,
restrict GitHub Actions token privileges to read-only by default, and enable push protection.
