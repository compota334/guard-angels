#!/usr/bin/env bash
# Fake backend script for testing the EXECUTE phase.
# Reads the prompt from stdin, extracts the response file path,
# writes a canned "done" response, and optionally creates files
# to simulate angel edits.
#
# Environment variables:
# - FAKE_BACKEND_VERDICT: response verdict (default: done)
# - FAKE_BACKEND_CONCERNS: concerns text (default: empty)
# - FAKE_BACKEND_FILES_CHANGED: comma-separated list of files the angel "changed"
# - FAKE_BACKEND_ANGEL_MD_UPDATED: true|false (default: false)
# - FAKE_BACKEND_CABLES_SENT: cables sent text (default: none)
# - FAKE_BACKEND_EXIT: exit code (default: 0)
# - FAKE_BACKEND_WRITE_FILES: comma-separated list of files to actually create/touch
#   (paths relative to the working directory)
# - FAKE_BACKEND_WRITE_CONTENT: content to write to each file (default: "modified by angel")

set -euo pipefail

PROMPT=$(cat)

# Extract response path from the prompt
RESPONSE_PATH=$(echo "$PROMPT" | grep -oP 'Write your response to: \K.+' || true)

if [ -z "$RESPONSE_PATH" ]; then
  echo "ERROR: Could not find response path in prompt" >&2
  exit 1
fi

# Configurable parameters
VERDICT="${FAKE_BACKEND_VERDICT:-done}"
CONCERNS="${FAKE_BACKEND_CONCERNS:-}"
FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"
ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
EXIT_CODE="${FAKE_BACKEND_EXIT:-0}"
WRITE_FILES="${FAKE_BACKEND_WRITE_FILES:-}"
WRITE_CONTENT="${FAKE_BACKEND_WRITE_CONTENT:-modified by angel}"

# Actually create/modify files to simulate angel work
if [ -n "$WRITE_FILES" ]; then
  IFS=',' read -ra FILES <<< "$WRITE_FILES"
  for FILE in "${FILES[@]}"; do
    FILE=$(echo "$FILE" | xargs) # trim whitespace
    mkdir -p "$(dirname "$FILE")"
    echo "$WRITE_CONTENT" > "$FILE"
  done
fi

# Ensure the response directory exists
mkdir -p "$(dirname "$RESPONSE_PATH")"

# Write the response file
if [ "$VERDICT" = "done" ]; then
  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ)
RESPONSE: done

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
Changes applied as requested.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

CABLES SENT: ${CABLES_SENT}
FILES CHANGED: ${FILES_CHANGED}
ANGEL_MD_UPDATED: ${ANGEL_MD_UPDATED}
RESPONSE
else
  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ)
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:


QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

RESPONSE
fi

# Echo something to stdout for logging
echo "Fake execute backend invoked. Verdict: ${VERDICT}"

exit "${EXIT_CODE}"
