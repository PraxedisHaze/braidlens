# Changelog

## 2026-06-07 (parity update)

- Brought `install/chatgpt.user.js` (v2.4.1 → v2.6) and `install/perplexity.user.js` (v2.0 → v2.1) up to functional parity with the Gemini bridge:
  - `[APPEND_FILE]` support
  - Stream-aware processed-flag fix (`hasIncompleteCommandTag`) so large `[WRITE_FILE]`/`[APPEND_FILE]` blocks no longer silently fail
  - `CHUNK_LIMIT` raised 25,000 → 100,000
  - Truncation notice corrected/aligned to point at the real local tool (`query_casey.py`, run by a Braid member with shell access)
  - Reliable send: replaced fixed-delay-plus-fake-Enter-keypress with a poll loop that waits for the real Send button to enable
- Each fix was adapted to the target script's existing selectors and naming conventions (`quaidProcessed`/`quaidDirectoryHandle` for ChatGPT, `braidProcessed`/`directoryHandle` and the React value-setter pattern for Perplexity) rather than copy-pasted wholesale.
- Updated `README.md` to list all three install targets and the `APPEND_FILE` command.

## 2026-06-07

- Bumped Gemini bridge to v2.6.
- Merged `[APPEND_FILE]` support into the canonical script (parity with the v2.5 build already in field use).
- Fixed a bug where the observer permanently marked a still-streaming response node as "processed" before its closing tag arrived — silently dropping `[WRITE_FILE]`/`[APPEND_FILE]` commands on large blocks. Added `hasIncompleteCommandTag()` so incomplete tag blocks are left unstamped and re-checked.
- Corrected an in-progress edit to the truncation notice that referenced a nonexistent `CASEY_SEARCH` command; reworded to point at the real local tool (`Lenny/query_casey.py`, run by a Braid member with shell access and relayed back).
- Raised `CHUNK_LIMIT` from 25,000 to 100,000 characters. The bridge already reads the full file into memory before slicing — the limit only ever governed how much got pasted into chat per round-trip. The old value forced most real project files into several manual `[READ_FILE_CHUNK]` round-trips; the new value lets the large majority arrive in one read.
- Added `applings/BraidLens/POTCH.md`.
- Fixed intermittent "typed but not sent" behavior: `injectTextAndSend` now polls (every 150ms, up to 5s) for Gemini's Send button to actually become enabled, instead of guessing a flat 300ms delay and falling back to a synthetic Enter keypress that Gemini's framework silently ignores.

## 2026-05-27

- Created permanent Braid Lens appling home.
- Added Gemini install script.
- Added `WRITE_FILE` support restricted to `QuAId/`.
- Added path normalization and traversal blocking.
- Added loop-breaker handling for write/list/read result blocks.
- Added command and safety documentation.

