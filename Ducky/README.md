# Braid Lens — Ducky (Duck.ai)

Dedicated BraidLens package for Duck.ai (DuckDuckGo AI Chat).

## Files
- `duck.user.js`: Tampermonkey/Violentmonkey userscript.
- Workspace symlink/copy: `C:\Users\Praxillax\Documents\apps\braid-lens-duck.user.js`

## Configuration
- **Target URLs:** `*://duck.ai/*`, `*://duckduckgo.com/?q=DuckDuckGo+AI+Chat*`, `*://duckduckgo.com/chat*`
- **Holodox 2 Seat ID:** `duck`
- **Relay Token:** `7X5mDxTsFG3DKgbL1D-Bjsh7LkaNSQsEAjyd19M-14Y`
- **Relay Address:** `http://127.0.0.1:43921`

## Features
1. **Drive Bridge:** Bound directory via File System Access API with IndexedDB handle persistence (`[READ_FILE:]`, `[WRITE_FILE:]`, `[LIST_DIR:]`).
2. **Holodox 2 Transport:** Live bidirectional polling and dispatching to the local Holodox 2 relay.
3. **Presence:** 5-minute opt-in boop heartbeat and Orient Duck quick-action.
