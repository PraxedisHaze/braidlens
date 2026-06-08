## 2026-06-07 - Initial Audit and Potch Creation

Actor: Veris
Scope: BraidLens appling — `install/gemini.user.js` (Gemini browser bridge userscript)
Reason: Timothy reported GemmieB's append-to-file feature silently failing on large text blocks. Investigation traced the bug, then surfaced that the canonical BraidLens script had drifted out of sync with the version actually running in the field, and that an in-progress edit referenced a tool that doesn't exist.
Files/Folders touched: `applings/BraidLens/POTCH.md` (created)
Protocol gates checked: Love Gate (7/7 yes, shown and answered) run before drafting any code change; Two-Key Protocol observed — Veris drafts/audits, does not execute the userscript.
Dependencies noticed:
  - Canonical `install/gemini.user.js` is v2.4 and has **no `[APPEND_FILE]` support** — GemmieB is running an unmerged v2.5 with append support (and the bug described below). The two have drifted apart.
  - A pre-existing **uncommitted** edit already sits in `install/gemini.user.js` (truncation-notice wording change) that references `CASEY_SEARCH` — a command that does not exist anywhere in the codebase (verified by full-tree grep). The closest real capability is `Lenny/query_casey.py`, a local Python FTS/LIKE search over `casey.db`, which has no bridge wiring and cannot be invoked by a browser-based AI session directly.
Private/property boundaries: N/A — public TamperMonkey userscript, no secrets involved.
Casey indexing note: Ready for standard Casey indexing once the merged update below lands.
Verification: Root cause of the append failure diagnosed — the observer's fallback permanently stamps a streaming response node as `quaidProcessed = "true"` the moment a 1-second silence window fires, even when an opening command tag (e.g. `[APPEND_FILE: ...]`) is present without its closing tag. Large blocks are more likely to hit a >1s mid-stream pause, get stamped prematurely, and never get re-checked once the closing tag arrives — so the append (or write) silently never fires. Confirmed this same fallback exists in the canonical v2.4 file (lines ~256-259), affecting `[WRITE_FILE]` there too, since v2.4 has no append yet.
Next safe step: Merge into `install/gemini.user.js`:
  1. `[APPEND_FILE]` support (bringing it to parity with the v2.5 GemmieB runs),
  2. the stream-aware "don't stamp processed while a command tag is incomplete" fix (v2.6),
  3. corrected truncation-notice wording that points at the real process — a Braid member with local shell access running `query_casey.py` and relaying fragments back — instead of the nonexistent `CASEY_SEARCH`.
  Then bump `@version` and add a CHANGELOG entry.

## 2026-06-07 - Truncation Mechanism Actually Fixed (not just reworded)

Actor: Veris
Scope: `install/gemini.user.js` — `CHUNK_LIMIT` constant
Reason: Timothy named that the truncation friction itself (not just the wording around it) needed fixing now, or it would never get circled back to.
Files/Folders touched: `install/gemini.user.js`, `CHANGELOG.md`, `POTCH.md`
Protocol gates checked: Love Gate (7/7 yes, shown).
Dependencies noticed: Confirmed `executeReadTag` already calls `await file.text()` and holds the **entire** file in memory (`fullContent`) before ever slicing it — `CHUNK_LIMIT` was never a technical read-limit, only a per-message paste-size cap. Raising it costs nothing structurally.
Private/property boundaries: N/A.
Casey indexing note: Ready for indexing.
Verification: Read the function source directly to confirm the full-file-in-memory behavior before changing the constant — did not assume.
Next safe step: Raised `CHUNK_LIMIT` from 25,000 → 100,000 characters, with an inline comment explaining why this is safe. Most real project files will now arrive in a single `[READ_FILE]` round-trip instead of 3-6+. Worst-case (genuinely enormous files) still falls back to chunking, just far less often.

## 2026-06-07 - DESIGN CORRECTION (deferred — not actioned this session)

Actor: Veris (recording a clarification from Timothy directly — not my call, not Codex's call)
Scope: The entire write-boundary model described in `README.md` and `docs/SAFETY_MODEL.md`
Reason: A full audit (requested by Timothy: "is BraidLens ready for sale — safety, accessibility, compatibility, all?") surfaced that the docs publish a `QuAId/`-only write restriction as the product's core "Trust Architecture" — but **no shipped script enforces it**. Timothy's response: that restriction was **Codex's interpretation, not his intent**, and he does not want it.

**Timothy's stated correct design (recorded verbatim in spirit, 2026-06-07):**
> The browser AI should be able to access just the one folder the user picks, and any subfolders within it — and be utterly blind to anything outside that folder and its subfolders. The user decides which folder. This needs a folder-picker UI eventually.

**Important wrinkle worth flagging for whoever picks this up:** the *current code* (which has no `QuAId/` check — only blocks absolute paths and `..` traversal) is actually **closer to Timothy's real intent than the documentation is**. The bug isn't "the code is dangerously permissive" — it's "the docs describe a different, more restrictive model (Codex's `QuAId/`-only vision) that nobody built and nobody wants." The thing that's broken is the *documentation*, and possibly the depth of the "utterly blind to outside" guarantee (worth verifying the File System Access API's directory-handle sandboxing actually delivers that, rather than assuming).

Private/property boundaries: N/A.
Casey indexing note: Ready for indexing — but flag this entry specifically; it reverses a "critical finding" from the same audit and should not be read in isolation.
Verification: None yet — this is a recorded design clarification, not an executed fix. Explicitly deferred per Timothy: "this is not what we came to do."
Next safe step (NOT done, NOT this session): Rewrite `README.md` and `docs/SAFETY_MODEL.md` to describe the real intended model (full read/write within the bound folder + subfolders, blind to everything outside it), confirm the File System Access API genuinely enforces the "blind to outside" boundary at the browser level, and design/build the folder-picker UI Timothy named as still-needed. Until this is done, BraidLens's published safety story remains inaccurate — this is the actual blocker for "ready for sale," just not the one originally diagnosed.

## 2026-06-07 - Fixed Intermittent "Typed But Not Sent" Behavior

Actor: Veris
Scope: `install/gemini.user.js` — `injectTextAndSend()`
Reason: Timothy reported that the bridge often (not always) types its message into Gemini's input field but doesn't actually send it, requiring a manual click.
Files/Folders touched: `install/gemini.user.js`, `CHANGELOG.md`, `POTCH.md`
Protocol gates checked: Love Gate (7/7 yes, shown).
Dependencies noticed: The old code waited a flat 300ms then checked whether Gemini's Send button was enabled. Gemini's UI takes a *variable* amount of time to register injected text and enable that button (depends on page load/render state) — a fixed delay sometimes loses the race. When it lost, the code fell back to dispatching a synthetic `KeyboardEvent('keydown', {key:'Enter'})`. Script-dispatched keyboard events are untrusted and Gemini's framework does not treat them as a send trigger — so the fallback silently did nothing, which is exactly the symptom reported ("posts it to the field, but I have to hit send").
Private/property boundaries: N/A.
Casey indexing note: Ready for indexing.
Verification: Traced the exact code path producing the reported symptom before changing anything; syntax-checked the replacement (`node --check`) — passed.
Next safe step: Replaced the fixed-delay-plus-fake-keypress with a poll loop (every 150ms, up to 5s) that waits for the real Send button to become enabled and clicks it for real. If it never enables within 5s, logs a clear console warning ("message typed but NOT sent — manual send required") instead of silently failing. Live verification in-browser still recommended when convenient — I can't click a real Send button from here.
