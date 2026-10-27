# Security Policy

Portcull stores user accounts and user-made content, so security reports are
taken seriously and handled quickly.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**Security → Report a vulnerability** on this repository
(GitHub private vulnerability reporting).

Please include:

- what the issue is and where (URL, endpoint or file),
- steps to reproduce or a proof of concept,
- the impact you expect.

You'll get a reply as soon as possible. Once a fix is deployed, you're welcome
to be credited in the release notes if you'd like.

## Scope

In scope:

- the live site and API at `portcull.com`,
- the code in this repository (`public/`, `src/`, `schema.sql`).

Out of scope:

- the *simulated* attacks inside Portcull — they are educational content, not
  vulnerabilities;
- denial-of-service or load testing against the live site;
- social engineering of the maintainer or users;
- issues in Cloudflare or GitHub themselves.

## Rules for testing

- Only use your **own** account and data. Never access, modify or delete other
  people's data.
- Don't publish spam or abusive content to the Community.
- Stop and report as soon as you've confirmed an issue.

Good-faith research that follows these rules will not be pursued.

## How Portcull is protected

A summary is in the [README](README.md#security--privacy). In short: GitHub
OAuth only (no passwords), HttpOnly signed session cookies, CSRF header + CORS
allowlist + OAuth `state`, strict schema validation with size caps, escaped
rendering, a sandboxed interpreter instead of `eval`, moderation and rate
limits, and secrets kept in Cloudflare — never in git.
