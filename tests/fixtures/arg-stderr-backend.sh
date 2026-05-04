#!/usr/bin/env bash
# Fake backend for testing ClaudeAdapter error path.
# Does NOT read stdin (mirrors claude -p which takes prompt as positional arg).
# Writes to stderr and exits non-zero.

set -uo pipefail

echo "something went wrong" >&2
exit "${ECHO_BACKEND_EXIT:-1}"
