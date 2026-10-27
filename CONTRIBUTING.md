# Contributing to Portcull

Thanks for helping! New attack scenarios, defenses, fixes, translations and
ideas are all welcome.

## Ways to help

- **Suggest a scenario** — open an issue describing the attack, how it works,
  and how it's detected/defended.
- **Report a bug** — open an issue with steps to reproduce and a screenshot.
- **Send a pull request** — fork, branch, commit, open a PR.

Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## Project layout

```
public/index.html   the whole app: simulator, library, sandbox, VoidScript
src/                the API (Cloudflare Worker)
schema.sql          the D1 database schema
```

## Adding an attack scenario

Scenarios live in `public/index.html`:

1. **`SCENARIOS`** — the network (`nodes`, `links`) and two step lists,
   `attack` and `defend`. Each step describes the packet path, what the user
   sees, and the OSI details.
2. **`META`** — category, short description and the *How it works* text.
3. **`TERM`** — typical real-world commands and indicators (attack mode) and
   how to detect them (defense mode). Keep these **educational**: explain
   techniques and detection, never ship working exploit code or payloads.
4. **`CODE`** — VoidScript attack and defense code at `easy`, `medium`, `hard`.

Run it locally by opening `public/index.html` in a browser.

## Guidelines

- Keep everything inside the simulation — no real network calls, no `eval`.
- Render user content as text, never as HTML.
- Keep the app dependency-free (vanilla JS).
- Be kind in issues and reviews.
