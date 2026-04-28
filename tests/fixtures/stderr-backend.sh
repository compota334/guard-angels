#!/usr/bin/env bash
# Fake backend that writes to stderr and exits with non-zero code.
set -uo pipefail

cat >/dev/null
echo "something went wrong" >&2
exit "${ECHO_BACKEND_EXIT:-1}"
