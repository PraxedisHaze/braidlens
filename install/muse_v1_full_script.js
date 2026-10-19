        panel.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;width:360px;padding:14px;background:linear-gradient(160deg,#111827 0%,#064e3b 100%);color:#f9fafb;border:2px solid #10b981;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;';
// ==UserScript==
// @name         The Braid Lens (Muse Bridge - v1.0.0)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  User-selected-folder bridge for Muse. Reads and writes inside the chosen folder; IndexedDB handle persistence; Orient Muse button; opt-in boop.
// @author       Timothy & Muse
// @match        *://muse.ai/*
// @match        *://*.muse.ai/*
// @match        *://agent.meta.ai/*
// @grant        none
// ==/UserScript==
​
/*
  MUSE BRIDGE COMMAND MANUAL
​
  Click "Orient Muse" to send the live instructions into this Muse
  conversation. Muse emits one exact tag when it needs a local-folder
  operation; the bridge performs it and sends an evidence receipt back.
​
  Root listing:       [LIST_DIR:]
  Root file:          [READ_FILE: README.md]
  Nested file:        [READ_FILE: PRESERVATION/TIMOTHY/5 Regarding Qualia.txt]
  Write:              [WRITE_FILE: relative/path.md]...[/WRITE_FILE]
  Append:             [APPEND_FILE: relative/path.md]...[/APPEND_FILE]
​
  The single period is reserved for the optional five-minute boop. It is not
  root-folder syntax. The boop is opt-in and defaults to OFF on every page load.
*/
​
(function () {
    'use strict';
​
    /* ================= CONFIG — tune without touching the machinery =================
       1. ALLOWED_HOST_SUFFIXES: the domains this bridge wakes up on. If you open
          Muse on a domain not listed here, add it (and a matching @match line).
       2. ASSISTANT_SELECTORS: CSS selectors tried in order to find Muse's
          assistant message containers. A text-node fallback below catches
          anything these miss; if Diagnose reports 0 assistant messages while
          Muse has clearly replied, add a selector here.
    */
    var ALLOWED_HOST_SUFFIXES = ['muse.ai', 'agent.meta.ai'];
​
    var ASSISTANT_SELECTORS = [
        '[data-message-author-role="assistant"]',
        '[data-message-author-role="model"]',
        '[data-role="assistant"]',
        '.assistant-message',
        '.message-assistant',
        '[data-testid="assistant-message"]',
        '[data-testid*="assistant-message"]',
        '[class*="assistant-message"]',
        '.markdown'
    ];
    /* ============================================================================== */
​
    var VERSION = '1.0.0';
    var CHUNK_LIMIT = 100000;
    var DB_NAME = 'braid-lens-muse';
    var DB_STORE = 'handles';
    var HANDLE_KEY = 'bound-directory';
    var PROCESSED_ATTR = 'data-braid-lens-processed';
    var PANEL_ID = 'braid-lens-muse-panel';
​
    var directoryHandle = null;
    var commandBusy = false;
    var statusElement = null;
    var boopEnabled = false;