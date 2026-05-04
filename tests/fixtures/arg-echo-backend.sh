#!/usr/bin/env bash
# Fake backend for testing ClaudeAdapter.
# Echoes the last positional argument to stdout (mirrors how claude -p <prompt> works).
# Exits with code from ECHO_BACKEND_EXIT env var (default 0).
# If ECHO_BACKEND_EXTRA env var is set, prints it before the arg echo.

set -euo pipefail

if [ -n "${ECHO_BACKEND_EXTRA:-}" ]; then
  printf '%s\n' "$ECHO_BACKEND_EXTRA"
fi

printf '%s' "${@: -1}"

exit "${ECHO_BACKEND_EXIT:-0}"
