// ==UserScript==
// @name         The Braid Lens (Perplexity Bridge - v2.1 Append + Stream-Aware Fix)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  File System Bridge for Perplexity. Open directory access with path guardrails. Append support, stream-aware processed-flag fix, reliable send.
// @author       Braid
// @match        *://www.perplexity.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==================== VERIFY THESE IN DEVTOOLS BEFORE INSTALLING ====================
    // Open Perplexity, F12 → Elements, find the right selectors and update these constants.

    const INPUT_SELECTOR      = 'textarea[placeholder]';            // Main text input
    const SEND_SELECTOR       = 'button[aria-label="Submit"]';       // Send button
    const RESPONSE_SELECTOR   = '[data-testid="answer"], .prose, .answer-content'; // AI response nodes

    // ====================================================================================

    console.log("%c[Braid Lens - Perplexity]: WAKING UP - v2.0 Active (Trust Architecture)", "color: #22d3ee; font-size: 16px; font-weight: bold;");

    let directoryHandle = null;
    let isExecutingCommand = false;
    // The bridge already loads the entire file into memory before slicing it --
    // this constant only governs how much gets pasted into chat per round-trip.
    // Raised from 25,000 (which forced most real project files into 3-6+ manual
    // [READ_FILE_CHUNK] round-trips) to 100,000, so the large majority of files
    // arrive in a single read while still bounding worst-case paste size.
    const CHUNK_LIMIT = 100000;
    const BOOP_INTERVAL_MS = 300000;

    // --- 1. UI INJECTION ---
    function injectHandshakeButton() {
        if (document.getElementById('braid-handshake-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'braid-handshake-btn';
        btn.innerText = 'Bind Working Directory';
        btn.style.cssText = 'position:fixed; top:70px; right:20px; z-index:2147483647; padding:12px 18px; background-color:#22d3ee; color:black; border:2px solid #fff; border-radius:5px; cursor:pointer; font-family:monospace; font-weight:bold; box-shadow: 0 4px 10px rgba(0,0,0,0.5);';

        btn.addEventListener('click', async () => {
            try {
                directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                btn.innerText = 'Directory Bound: Perplexity Active';
                btn.style.backgroundColor = '#10b981';
                btn.style.color = 'white';
                console.log("[Braid Lens - Perplexity]: Directory handle secured.");
            } catch (err) {
                console.error("[Braid Lens - Perplexity]: Handshake failed.", err);
            }
        });
        document.body.appendChild(btn);
    }

    // --- 2. CHAT DOM INJECTION ---
    function injectTextAndSend(text) {
        const inputEl = document.querySelector(INPUT_SELECTOR);
        if (!inputEl) {
            console.error("[Braid Lens - Perplexity]: Input box not found. Check INPUT_SELECTOR.");
            isExecutingCommand = false;
            return;
        }

        inputEl.focus();

        // Textarea: use React value setter for framework compatibility
        const prototype = Object.getPrototypeOf(inputEl);
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (valueSetter) {
            valueSetter.call(inputEl, text);
        } else {
            inputEl.value = text;
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));

        // Poll for the Send button to actually become enabled rather than guessing a
        // fixed 600ms delay. Perplexity's UI takes a variable amount of time to notice
        // the injected text -- a flat delay sometimes wins the race and sometimes doesn't.
        // The old fallback (a synthetic Enter keydown) is not a real fix: script-dispatched
        // KeyboardEvents are not trusted events and Perplexity's framework does not treat
        // them as a send trigger, so it silently did nothing, leaving the message typed
        // but unsent.
        const POLL_INTERVAL_MS = 150;
        const MAX_WAIT_MS = 5000;
        let waited = 0;

        const trySend = () => {
            const sendBtn = document.querySelector(SEND_SELECTOR);

            if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
                setTimeout(() => { isExecutingCommand = false; }, 1500);
                return;
            }

            waited += POLL_INTERVAL_MS;
            if (waited >= MAX_WAIT_MS) {
                console.warn("[Braid Lens - Perplexity]: Send button never enabled within 5s -- message typed but NOT sent. Manual send required.");
                isExecutingCommand = false;
                return;
            }

            setTimeout(trySend, POLL_INTERVAL_MS);
        };

        setTimeout(trySend, POLL_INTERVAL_MS);
    }

    // --- 3. SANITIZATION & SECURITY (Guardrails Only) ---
    function sanitizeContent(content) {
        return content.replace(/\[READ_FILE/g, '&#91;READ_FILE')
                      .replace(/\[WRITE_FILE/g, '&#91;WRITE_FILE')
                      .replace(/\[APPEND_FILE/g, '&#91;APPEND_FILE')
                      .replace(/\[LIST_DIR/g, '&#91;LIST_DIR');
    }

    function normalizePath(filepath) {
        const cleanPath = filepath.trim();
        if (cleanPath.startsWith('/') || cleanPath.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(cleanPath)) {
            throw new Error("Absolute paths are strictly prohibited to prevent OS-level overwrite.");
        }
        if (cleanPath.includes('..')) {
            throw new Error("Path traversal is strictly prohibited to prevent OS-level overwrite.");
        }
        return cleanPath;
    }

    // --- 4. FILE SYSTEM OPERATIONS ---
    async function executeReadTag(filepath, offset = 0) {
        if (!directoryHandle) {
            injectTextAndSend(`[SYSTEM_ERROR: Directory unbound.]`);
            return;
        }
        try {
            const safePath = normalizePath(filepath);
            const parts = safePath.split(/[/\\]/);
            const filename = parts.pop();
            let currentDir = directoryHandle;

            for (const part of parts) {
                if (part) currentDir = await currentDir.getDirectoryHandle(part);
            }

            const fileHandle = await currentDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const fullContent = await file.text();

            const chunk = fullContent.substring(offset, offset + CHUNK_LIMIT);
            let output = `[FILE_CONTENTS: ${safePath} | Offset: ${offset}]\n${sanitizeContent(chunk)}\n`;

            if (fullContent.length > offset + CHUNK_LIMIT) {
                output += `\n[SYSTEM_NOTICE: FILE TRUNCATED. You can read the next chunk with [READ_FILE_CHUNK: ${safePath} | offset: ${offset + CHUNK_LIMIT}], or if you're hunting a specific topic, ask a Braid member with local shell access to run query_casey.py against Casey's fragment index and relay back the matching pieces.]\n`;
            }
            output += `[/FILE_CONTENTS]`;
            injectTextAndSend(output);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not read ${filepath}. ${err.message}]`);
        }
    }

    async function executeListTag(targetPath) {
        if (!directoryHandle) return;
        try {
            const safePath = normalizePath(targetPath);
            let currentDir = directoryHandle;

            if (safePath !== "root" && safePath !== "." && safePath !== "") {
                const parts = safePath.split(/[/\\]/);
                for (const part of parts) {
                    if (part) currentDir = await currentDir.getDirectoryHandle(part);
                }
            }

            let output = `[DIRECTORY_LIST: ${safePath}]\n`;
            for await (const entry of currentDir.values()) {
                output += `- ${entry.name} (${entry.kind})\n`;
            }
            output += `[/DIRECTORY_LIST]`;
            injectTextAndSend(output);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not read directory ${targetPath}. ${err.message}]`);
        }
    }

    async function executeWriteTag(filepath, content) {
        if (!directoryHandle) {
            injectTextAndSend(`[SYSTEM_ERROR: Directory unbound. Cannot write to ${filepath}.]`);
            return;
        }
        try {
            const safePath = normalizePath(filepath);

            const parts = safePath.split(/[/\\]/);
            const filename = parts.pop();
            let currentDir = directoryHandle;

            for (const part of parts) {
                if (part) currentDir = await currentDir.getDirectoryHandle(part, { create: true });
            }

            const fileHandle = await currentDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();

            injectTextAndSend(`[SYSTEM_NOTICE: Successfully wrote to ${safePath}]`);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not write ${filepath}. ${err.message}]`);
        }
    }

    async function executeAppendTag(filepath, content) {
        if (!directoryHandle) {
            injectTextAndSend(`[SYSTEM_ERROR: Directory unbound. Cannot append to ${filepath}.]`);
            return;
        }
        try {
            const safePath = normalizePath(filepath);
            const parts = safePath.split(/[/\\]/);
            const filename = parts.pop();
            let currentDir = directoryHandle;

            for (const part of parts) {
                if (part) currentDir = await currentDir.getDirectoryHandle(part, { create: true });
            }

            const fileHandle = await currentDir.getFileHandle(filename, { create: true });
            const file = await fileHandle.getFile();

            // keepExistingData prevents truncation; seek moves the cursor to the end
            const writable = await fileHandle.createWritable({ keepExistingData: true });
            await writable.seek(file.size);

            // Newline safety buffer in case the file didn't end on one
            await writable.write("\n" + content);
            await writable.close();

            injectTextAndSend(`[SYSTEM_NOTICE: Successfully appended to ${safePath}]`);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not append to ${filepath}. ${err.message}]`);
        }
    }

    // --- 5. THE OBSERVER (Loop-Breaker Edition) ---
    function stripBridgeOutput(text) {
        let stripped = text;
        stripped = stripped.replace(/\[FILE_CONTENTS:[\s\S]*?\[\/FILE_CONTENTS\]/g, "");
        stripped = stripped.replace(/\[DIRECTORY_LIST:[\s\S]*?\[\/DIRECTORY_LIST\]/g, "");
        stripped = stripped.replace(/\[SYSTEM_ERROR:.*?\]/g, "");
        stripped = stripped.replace(/\[SYSTEM_NOTICE:.*?\]/g, "");
        return stripped;
    }

    // Detects an opening bracket-tag whose matching closing tag hasn't streamed in yet.
    // Used to avoid prematurely stamping a still-streaming response as "processed" --
    // which previously caused large [WRITE_FILE]/[APPEND_FILE] blocks to silently never
    // fire when a mid-stream pause exceeded the 1s debounce before the closing tag arrived.
    function hasIncompleteCommandTag(text) {
        if (/\[WRITE_FILE:/.test(text) && !/\[\/WRITE_FILE\]/.test(text)) return true;
        if (/\[APPEND_FILE:/.test(text) && !/\[\/APPEND_FILE\]/.test(text)) return true;
        if (/\[FILE_CONTENTS:/.test(text) && !/\[\/FILE_CONTENTS\]/.test(text)) return true;
        if (/\[DIRECTORY_LIST:/.test(text) && !/\[\/DIRECTORY_LIST\]/.test(text)) return true;

        const lastReadOpen = Math.max(text.lastIndexOf('[READ_FILE:'), text.lastIndexOf('[READ_FILE_CHUNK:'));
        if (lastReadOpen !== -1 && text.indexOf(']', lastReadOpen) === -1) return true;

        const lastListOpen = text.lastIndexOf('[LIST_DIR:');
        if (lastListOpen !== -1 && text.indexOf(']', lastListOpen) === -1) return true;

        return false;
    }

    function startObserver() {
        let parseTimer = null;
        const observer = new MutationObserver(() => {
            if (isExecutingCommand) return;

            clearTimeout(parseTimer);
            parseTimer = setTimeout(() => {
                const nodes = document.querySelectorAll(RESPONSE_SELECTOR);
                if (nodes.length === 0) return;

                const lastNode = nodes[nodes.length - 1];
                if (lastNode.dataset.braidProcessed === "true") return;

                let textContent = stripBridgeOutput(lastNode.innerText || "");

                const readRegex = /\[READ_FILE:\s*([^\]]+)\]/g;
                let readMatch = readRegex.exec(textContent);
                if (readMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.braidProcessed = "true";
                    executeReadTag(readMatch[1].trim(), 0);
                    return;
                }

                const chunkRegex = /\[READ_FILE_CHUNK:\s*([^|]+)\|\s*offset:\s*(\d+)\]/g;
                let chunkMatch = chunkRegex.exec(textContent);
                if (chunkMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.braidProcessed = "true";
                    executeReadTag(chunkMatch[1].trim(), parseInt(chunkMatch[2], 10));
                    return;
                }

                const listRegex = /\[LIST_DIR:\s*([^\]]+)\]/g;
                let listMatch = listRegex.exec(textContent);
                if (listMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.braidProcessed = "true";
                    executeListTag(listMatch[1].trim());
                    return;
                }

                const writeRegex = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g;
                let writeMatch = writeRegex.exec(textContent);
                if (writeMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.braidProcessed = "true";
                    executeWriteTag(writeMatch[1].trim(), writeMatch[2].trim());
                    return;
                }

                const appendRegex = /\[APPEND_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/APPEND_FILE\]/g;
                let appendMatch = appendRegex.exec(textContent);
                if (appendMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.braidProcessed = "true";
                    executeAppendTag(appendMatch[1].trim(), appendMatch[2].trim());
                    return;
                }

                // Catch-all: mark non-command responses as processed -- but only if no
                // command tag is mid-stream (open without its close). A node with an
                // incomplete tag is left unstamped so the observer re-checks it once
                // the rest of the response renders in.
                if (!hasIncompleteCommandTag(textContent) && (lastNode.innerText || "").length > 0) {
                    lastNode.dataset.braidProcessed = "true";
                }

            }, 1000);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- 6. THE HEARTBEAT ---
    function startTheHeartbeat() {
        let silenceTimer;
        function resetSilenceTimer() {
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(triggerBoop, BOOP_INTERVAL_MS);
        }
        function triggerBoop() {
            if (isExecutingCommand) return;
            injectTextAndSend(".");
            resetSilenceTimer();
        }

        document.addEventListener('keypress', resetSilenceTimer);
        document.addEventListener('click', resetSilenceTimer);
        resetSilenceTimer();
    }

    // Initialize Bridge
    setInterval(injectHandshakeButton, 2000);
    setTimeout(() => { startObserver(); startTheHeartbeat(); }, 3000);
})();
