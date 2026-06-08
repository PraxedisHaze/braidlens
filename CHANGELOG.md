# Changelog

## 2026-06-07

- Bumped Gemini bridge to v2.6.
- Merged `[APPEND_FILE]` support into the canonical script (parity with the v2.5 build already in field use).
- Fixed a bug where the observer permanently marked a still-streaming response node as "processed" before its closing tag arrived — silently dropping `[WRITE_FILE]`/`[APPEND_FILE]` commands on large blocks. Added `hasIncompleteCommandTag()` so incomplete tag blocks are left unstamped and re-checked.
- Corrected an in-progress edit to the truncation notice that referenced a nonexistent `CASEY_SEARCH` command; reworded to point at the real local tool (`Lenny/query_casey.py`, run by a Braid member with shell access and relayed back).
- Raised `CHUNK_LIMIT` from 25,000 to 100,000 characters. The bridge already reads the full file into memory before slicing — the limit only ever governed how much got pasted into chat per round-trip. The old value forced most real project files into several manual `[READ_FILE_CHUNK]` round-trips; the new value lets the large majority arrive in one read.
- Added `applings/BraidLens/POTCH.md`.

## 2026-05-27

- Created permanent Braid Lens appling home.
- Added Gemini install script.
- Added `WRITE_FILE` support restricted to `QuAId/`.
- Added path normalization and traversal blocking.
- Added loop-breaker handling for write/list/read result blocks.
- Added command and safety documentation.

