# Contributing to Guard Angels

Thanks for your interest in contributing. This document explains how to set up the project locally and what we expect from contributions.

## Requirements

- Node.js >= 22
- npm (comes with Node.js)

## Getting started

1. Fork the repository on GitHub.
2. Clone your fork:

   ```bash
   git clone https://github.com/<your-username>/guard-angels.git
   cd guard-angels
   ```

3. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

## Development workflow

1. Create a branch from `main`:

   ```bash
   git checkout -b feat/short-description
   ```

2. Make your changes.
3. Verify everything passes before opening a PR:

   ```bash
   npm run build      # TypeScript compilation
   npm run lint       # ESLint
   npm test           # vitest run
   ```

4. Push your branch and open a pull request against `main`.

## Coding standards

- **TypeScript strict mode.** The project compiles with `strict: true`; do not weaken compiler options or sprinkle `any` / `@ts-ignore` to silence errors — fix the underlying type issue.
- **ESLint.** `npm run lint` must pass with no errors. The config lives in `eslint.config.js`.
- **Fail loud.** Errors should surface clearly; do not add silent fallbacks or swallow exceptions.
- **Tests.** New behavior needs tests. Unit tests live in `tests/unit/`, integration tests in `tests/integration/`. Run them with `npm test`.
- **Match the existing style.** Follow the naming, structure, and comment density of the surrounding code.

## Pull request checklist

Before requesting review, make sure:

- [ ] `npm run build` passes
- [ ] `npm run lint` passes with no errors
- [ ] `npm test` passes (all tests green)
- [ ] New behavior is covered by tests
- [ ] `CHANGELOG.md` is updated under `[Unreleased]` if the change is user-visible
- [ ] Documentation (README, docs/) is updated if commands, flags, or config change
- [ ] The PR description explains *what* changed and *why*

## Reporting bugs and requesting features

Open an issue at <https://github.com/compota335/guard-angels/issues>. For bugs, include the CLI version (`angels --version`), your Node.js version, and steps to reproduce.

For security vulnerabilities, do **not** open a public issue — see [SECURITY.md](SECURITY.md).
