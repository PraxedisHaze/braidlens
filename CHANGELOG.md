# Changelog

## 3.6.1 (2026-10-16 - Holodox Cross-Conversation Lock Release Valve)

- **Cross-Conversation Lock Release Valve (`toggleHolodox`):** Preserved the background `pollHolodox()` protection that stops an active seat from accidentally injecting into a different chat if the tab navigates mid-turn, while adding an explicit `window.confirm` release valve when the user manually clicks the **Holodox** button in a new conversation (`OK` clears the stale `braid_lens_pending_<agentId>` lock and binds the seat to the current conversation; `Cancel` preserves the old conversation's lock).
- **Same-Conversation Unverified Lock Escape:** Added a secondary `window.confirm` inside `toggleHolodox()` if an earlier unverified submission lock in the same conversation is canceled/left blank, allowing the user to clear a stuck lock without opening DevTools.

## 3.6.0 (2026-10-16 - Opt-In ChatGPT Continuity & Local Return Brief)

- Integrated opt-in conversation continuity (`continuity/continuity.js`) and shared local return brief (`runtime/penni-continuity/return-brief.json`) into `install/universal.user.js`.

## 3.5.0 (2026-10-07 - Dedicated Penni Bridge & Fleet Unification)

- **Dedicated Penni (NotebookLM) Adapter (Two-Key Audit):** Applied ChatGPT's 2026 empirical probe refinements:
  - Tightened chat input selectors (`textarea.query-box-input`, `textarea[aria-label="Query box"]`, `textarea[placeholder="Ask a question or create something"]`, `textarea[placeholder="Start typing..."]`, `.query-input textarea`), eliminating false-positive selection of source-pasting textareas.
  - Framework-aware mutation: added native property setter (`HTMLTextAreaElement.prototype` descriptor) with bubbling `InputEvent` (`inputType: 'insertText'`) to ensure Google's Lit/Wiz internal state updates reactively.
  - Scoped send button detection (`button.submit-button[aria-label="Submit"]`) and `isUsableButton` validation (`!disabled`, `aria-disabled !== 'true'`, `!classList.contains('disabled')`).
  - Scoped `isGenerating()` detection inside `chat-panel` / `[role="log"]` / `.chat-panel-content`.
  - Canonical response container targeting: `.to-user-container` (model output) vs `.from-user-container` (user prompt).
  - Overlay protection: added `dismissNotebookLMOverlay()` to dispatch `Escape` and clear stuck `.cdk-overlay-container .citation-tooltip-text` popovers.
- **Gemini Host Partitioning:** Refined `gemini` adapter match to strictly target `gemini.google.com`, ensuring NotebookLM tabs route cleanly to Penni without selector collisions.
- **Backported Spell-Casting Syntax:** Integrated bracket-free spell phrases (`MIRROR MIRROR:`, `ABRACADABRA:`, `PRESTO CHANGO:`, `SO MOTE IT BE`) alongside standard bracket tags across all supported AI chats.
- **In-Flight Concurrency Locks:** Ported synchronous `in-flight` stamping and in-memory signature sets (`inFlightSignatures`, `completedSignatures`) to eliminate React/Virtual DOM double-firing and dual-hook race conditions.
- **Fleet Unification:** Consolidated all platform improvements into a single universal script (`braid_lens_universal_v3.5.user.js` and `install/universal.user.js`).

## 3.4.2 (2026-10-05 - Duplicate Receipt Neutralization & In-Flight Concurrency Locks)

- **Synchronous In-Flight Lock:** Stamped `data-braid-lens-processed="in-flight"` the exact millisecond a command is matched, closing the re-entrancy window during asynchronous directory reading and preventing double-firing from simultaneous mutation observers and polling intervals.
- **In-Memory Signature Deduplication:** Added `inFlightSignatures` and `completedSignatures` Sets to track turn text signatures, guaranteeing that cloned or remounted React virtual-DOM nodes with identical command text are never executed twice in the same session.
- **Resilient Fallback Cleansing:** Updated `clearStaleProcessed()` to respect completed and in-flight signatures so past processed turns are never re-queued when clicking Diagnose or refreshing.
- **Error Rollback:** Automatically strips the `in-flight` attribute and clears signatures if an operation encounters a fatal permission or disk error, allowing intentional user retries.

## 3.4.1 (2026-10-05 - Muse Braid Lens Runtime Fix & Execution Hardening)

- **Root Cause Fix (PANEL_ID Undefined):** Declared `var PANEL_ID = 'braid-lens-muse-panel';` at top level, eliminating the `ReferenceError: PANEL_ID is not defined` crash in `'use strict'` mode that halted the mutation observer and command processing.
- **Root Cause Fix (Send Button Null Reference):** Replaced unfiltered candidate array access with `candidates.filter(Boolean).find(...)` to prevent `TypeError: Cannot read properties of null (reading 'toLowerCase')`.
- **Root Cause Fix (Dual-Hook Collision Detection):** Identified conflict where older v1.0.0 userscript was running simultaneously with v3.4.0 in Tampermonkey, marking incoming assistant turns with `data-braid-lens-processed="true"` before directory operations could complete. Added instructions and auto-clearing logic (`clearStaleProcessed`) on boot and Diagnose click.
- **Deferred Command Completion:** Updated `executeList`, `executeRead`, and `executeWrite` to only stamp `data-braid-lens-processed="true"` upon verified receipt dispatch, preventing dropped commands if directory permissions require user interaction.
- **Interval Polling:** Added 2-second background polling interval to `startObserver` to ensure continuous command detection even when React virtual DOM mutations bypass standard DOM mutation listeners.
- **Live Parity:** Vernier Fisheye Scrubber, native Holodox 2 Meeting Hall seat on port 43921 as `[muse]` with token auth, File System Access API with persistent IndexedDB directory handle (`braid-lens-muse`), and Gumroad daily rolling report sentinel.

## 3.4.0 (2026-10-04 - The Universal Braid Lens Release)

- Unified all individual Braid Lens adapters into a single universal userscript (`braid_lens_universal_v3.4.user.js` and `install/universal.user.js`).
- Dynamic host detection with automatic adapter mapping for ChatGPT, Claude, Gemini/NotebookLM, Grok, Duck.ai, Perplexity, DeepSeek, and generic web AI chats.
- Dynamic Holodox 2 Meeting Hall seat integration with platform-specific tokens, agent IDs, and heartbeats.
- Complete File System Access API drive bridge (`[LIST_DIR:]`, `[READ_FILE:]`, `[READ_FILE_CHUNK:]`, `[WRITE_FILE:]`, `[APPEND_FILE:]`) with stream-aware chunking and path safety.
- Cross-platform Casey memory query bridge (`[FETCH_CASEY: query]`) communicating with Lenny on port 3333.
- Integrated Vernier Fisheye Minimap Scrubber with mousewheel zoom (1.5x–6.0x), turn inspection popover, and smooth-scroll turn jumping across all platforms.
- Dynamic draggable HUD styled with the host platform's color palette, Orient button tailored per AI, boop presence pulse, and live diagnostics.

## 3.3.0 (2026-10-04 - Grok Braid Lens & Vernier Scrubber Release)

- Created dedicated Grok Braid Lens (`braid_lens_grok_v3.3.user.js` and `install/grok.user.js`) targeting `grok.com`, `x.ai`, `x.com/i/grok`, and `twitter.com/i/grok`.
- Full File System Access API drive bridge (`[LIST_DIR:]`, `[READ_FILE:]`, `[READ_FILE_CHUNK:]`, `[WRITE_FILE:]`, `[APPEND_FILE:]`).
- Full native Holodox 2 Meeting Hall seat integration as `[grok]` connecting to local relay on port `43921` with token authentication.
- Built-in Vernier Fisheye Minimap Scrubber with mousewheel zoom (1.5x–6.0x), turn inspection popover, and smooth-scroll turn jumping.
- Draggable HUD with Bind Folder, Orient Grok, Holodox Seat toggle, Scrubber toggle, Boop toggle, and Diagnostics.

## 3.0.0 (2026-09-18 - Unified Parity Release)

- Harmonized all four Braid Lens userscripts (`claude.user.js`, `gemini.user.js`, `chatgpt.user.js`, `perplexity.user.js`) to mirror Claude's architecture in each native context.
- Standardized Command Manual comment block at the top of every script.
- Added context-tailored "Orient [AI]" buttons (`Orient Gemini`, `Orient ChatGPT`, `Orient Perplexity`, `Orient Claude`) that inject specific provider bridge instructions in one click.
- Brought IndexedDB folder handle persistence (`openHandleDb`, `saveHandle`, `loadHandle`) to all platforms so folder bindings survive page refreshes.
- Standardized strict relative-path security (`normalizePath`), regex-trap protection (`isRegexTrap`), and recursion sanitization (`sanitizeContent`).
- Uniform receipt contracts (`[FILE_CONTENTS]`, `[DIRECTORY_LIST]`, `[SYSTEM_NOTICE]`).
- Clean draggable HUD with Bind, Orient, Boop, and Diagnose controls across all four platforms.

## 2.9.2 - Notebook bridge

- Added `notebook.google.com` as a supported host in the canonical Gemini bridge.
- Added Notebook's Query box, Submit button, and model-response selectors.
- Preserved the selected-folder boundary and existing command protocol.
## 2026-09-10

- Added `install/claude.user.js` (v1.0.0), a Claude-specific Braid Lens adapter.
- Added user-selected-folder `READ_FILE`, `READ_FILE_CHUNK`, `LIST_DIR`,
  `WRITE_FILE`, and `APPEND_FILE` commands with relative-path and traversal
  protection.
- Added Claude composer/send and assistant-response selectors with a real
  Send-button poll; no synthetic keypress fallback.
- Explicitly excluded Casey auto-sync, heartbeat boops, process spawning, and
  access outside the folder selected by the user.

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


