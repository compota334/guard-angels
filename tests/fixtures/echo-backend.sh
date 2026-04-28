#!/usr/bin/env bash
# Fake backend script for testing adapters.
# Reads stdin, echoes it to stdout with optional metadata lines.
# Exits with code from ECHO_BACKEND_EXIT env var (default 0).
# If ECHO_BACKEND_EXTRA env var is set, prints it before the stdin echo.

set -euo pipefail

if [ -n "${ECHO_BACKEND_EXTRA:-}" ]; then
  printf '%s\n' "$ECHO_BACKEND_EXTRA"
fi

cat

exit "${ECHO_BACKEND_EXIT:-0}"
