#!/usr/bin/env bash
# Unified fake backend script for Guard Angels integration tests.
# Reads the prompt from stdin, extracts the PHASE and response file path,
# dispatches to a phase-specific handler, and writes a canned response.
#
# Portable POSIX bash. No external deps beyond grep/sed/awk.
#
# Supported phases: REVIEW, EXECUTE, INIT, SWEEP
#
# Environment variables (all optional):
#
# Common:
#   FAKE_BACKEND_VERDICT     Response verdict (default varies by phase)
#   FAKE_BACKEND_CONCERNS    Concerns text (default: empty)
#   FAKE_BACKEND_EXIT        Exit code (default: 0)
#   FAKE_BACKEND_DELAY       Sleep seconds before responding (default: 0)
#
# EXECUTE / SWEEP only:
#   FAKE_BACKEND_FILES_CHANGED     Comma-separated list of files "changed"
#   FAKE_BACKEND_ANGEL_MD_UPDATED  true|false (default: false)
#   FAKE_BACKEND_CABLES_SENT       Cables sent text (default: none)
#   FAKE_BACKEND_DRIFT_REPORT      Drift report text (default: empty)
#
# EXECUTE only:
#   FAKE_BACKEND_WRITE_FILES    Comma-separated ABSOLUTE paths to actually create
#   FAKE_BACKEND_WRITE_CONTENT  Content for each created file (default: "modified by angel")
#
# INIT only:
#   (Uses VERDICT=done by default; writes a minimal response)
#
# Echo backend mode (no response file):
#   FAKE_BACKEND_ECHO_MODE   Set to "true" to just echo stdin (like echo-backend.sh)
#   ECHO_BACKEND_EXTRA       Extra text to print before echoing stdin
#   ECHO_BACKEND_EXIT        Exit code for echo mode (default: 0)
#
# Stderr mode:
#   FAKE_BACKEND_STDERR_MODE Set to "true" to write to stderr and exit non-zero

set -euo pipefail

# --- Stderr mode (replaces stderr-backend.sh) ---
if [ "${FAKE_BACKEND_STDERR_MODE:-}" = "true" ]; then
  cat >/dev/null
  echo "something went wrong" >&2
  exit "${ECHO_BACKEND_EXIT:-1}"
fi

# --- Echo mode (replaces echo-backend.sh) ---
if [ "${FAKE_BACKEND_ECHO_MODE:-}" = "true" ]; then
  if [ -n "${ECHO_BACKEND_EXTRA:-}" ]; then
    printf '%s\n' "$ECHO_BACKEND_EXTRA"
  fi
  cat
  exit "${ECHO_BACKEND_EXIT:-0}"
fi

# --- Standard fake backend: read prompt, detect phase, write response ---

PROMPT=$(cat)

# Extract response path from the prompt
RESPONSE_PATH=$(echo "$PROMPT" | sed -n 's/^Write your response to: //p' | head -1)

if [ -z "$RESPONSE_PATH" ]; then
  echo "ERROR: Could not find response path in prompt" >&2
  exit 1
fi

# Detect phase from the prompt (look for PHASE: line in the brief section)
PHASE=$(echo "$PROMPT" | sed -n 's/^PHASE: //p' | head -1)
if [ -z "$PHASE" ]; then
  PHASE="review"
fi

# Common parameters
EXIT_CODE="${FAKE_BACKEND_EXIT:-0}"
DELAY="${FAKE_BACKEND_DELAY:-0}"
CONCERNS="${FAKE_BACKEND_CONCERNS:-}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$DELAY" != "0" ]; then
  sleep "$DELAY"
fi

# Ensure the response directory exists
mkdir -p "$(dirname "$RESPONSE_PATH")"

# --- EXECUTE phase ---
if [ "$PHASE" = "execute" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"
  FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"
  ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
  CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
  DRIFT_REPORT="${FAKE_BACKEND_DRIFT_REPORT:-}"
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

  if [ "$VERDICT" = "done" ]; then
    cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: done

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
Changes applied as requested.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

CABLES SENT: ${CABLES_SENT}
FILES CHANGED: ${FILES_CHANGED}
ANGEL_MD_UPDATED: ${ANGEL_MD_UPDATED}
RESPONSE
  else
    cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
Document findings and notify main agent.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

RESPONSE
  fi

  echo "Fake execute backend invoked. Verdict: ${VERDICT}"

# --- SWEEP phase ---
elif [ "$PHASE" = "sweep" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"
  DRIFT_REPORT="${FAKE_BACKEND_DRIFT_REPORT:-No drift detected.}"
  ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
  CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
  FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"

  if [ "$VERDICT" = "done" ]; then
    cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: done

CONCERNS:
${CONCERNS}

PROPOSED PLAN:

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

CABLES SENT: ${CABLES_SENT}
FILES CHANGED: ${FILES_CHANGED}
ANGEL_MD_UPDATED: ${ANGEL_MD_UPDATED}
RESPONSE
  else
    cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
Document findings and notify main agent.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

RESPONSE
  fi

  echo "Fake sweep backend invoked. Verdict: ${VERDICT}"

# --- DISCOVERY / INIT phase ---
elif [ "$PHASE" = "discovery" ] || [ "$PHASE" = "init" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"

  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
## Charter
Owns authentication and session management utilities for the project.

## Public contract
Exports session middleware and auth helpers consumed by the application layer.

## Invariants
- Session tokens must never be logged in plaintext.
- Auth state is managed exclusively within this folder.

## Decision log
Initial discovery by fake backend.

## Open questions

## Dependencies
None identified during fake discovery.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

CABLES SENT: none
FILES CHANGED: none
ANGEL_MD_UPDATED: yes
RESPONSE

  echo "Fake discovery/init backend invoked. Verdict: ${VERDICT}"

# --- ASK phase ---
elif [ "$PHASE" = "ask" ]; then
  ANSWER="${FAKE_BACKEND_ANSWER:-The answer to your question is: this is a fake backend response.}"

  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: done

CONCERNS:


PROPOSED PLAN:
${ANSWER}

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

CABLES SENT: none
FILES CHANGED: none
ANGEL_MD_UPDATED: no
RESPONSE

  echo "Fake ask backend invoked."

# --- REVIEW phase (default) ---
else
  VERDICT="${FAKE_BACKEND_VERDICT:-proceed}"

  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: ${TIMESTAMP}
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
No changes needed.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

RESPONSE

  echo "Fake backend invoked successfully. Verdict: ${VERDICT}"
fi

exit "${EXIT_CODE}"
