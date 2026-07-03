# Security Policy

## Supported versions

Only the latest published version of `@guard-angels/cli` receives security fixes.

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, email **opensource@guardangels.dev** with:

- A description of the vulnerability and its impact
- Steps to reproduce (a proof of concept if possible)
- The version affected (`angels --version`)

You should receive an acknowledgment within a few days. Please give us a reasonable window to investigate and release a fix before any public disclosure.

Areas of particular interest for this project:

- Path traversal or writes escaping the project root
- Prompt injection paths that could make an angel act outside its territory
- Lock-file races or privilege issues in `.angels/` handling
