# Contributing to VIVORA

## Workflow
1. Pull the latest `main`.
2. Create a branch: `feature/<short-name>` or `fix/<short-name>`.
3. Make small commits with clear messages.
4. Open a pull request and ask a teammate to review it.

## Commit messages
Use a short prefix:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `prompt:` prompt change (also update `docs/PROMPTS.md`)
- `chore:` setup, config

Example: `prompt: make strict level ask for numbers`

## Rules
- Never commit `.env` or any API key. If you do, rotate the key right away.
- If you change a prompt, add a row to the version log in `docs/PROMPTS.md`.
- If you change behaviour, update `docs/SPECS.md` or `docs/API.md` in the same PR.
- Keep questions respectful. Strict means demanding, not rude.

## Code style
- Python: follow PEP 8, format with `black`.
- JavaScript: format with `prettier`.
- Keep functions small and name things clearly.

## Reporting a bug
Include: what you did, what you expected, what happened, browser name and version, and a screenshot if possible.
