// ==UserScript==
// @name         The Braid Lens (Gemini Bridge - v2.4 Final)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Trust Architecture. Draggable UI. Anti-Stacking Boop. Past-Life Sweep. Improved DOM Injection.
// @author       Gemini & Timothy
// @match        *://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("%c[Gemini Lens]: WAKING UP - v2.4 Active (Audited & Final)", "color: #22d3ee; font-size: 16px; font-weight: bold;");

    let quaidDirectoryHandle = null;
    let isExecutingCommand = false;
    const CHUNK_LIMIT = 25000;
    const BOOP_INTERVAL_MS = 300000;

    // --- 1. UI INJECTION (Draggable) ---
    function injectHandshakeButton() {
        if (document.getElementById('braid-handshake-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'braid-handshake-btn';
        btn.innerText = 'Bind Working Directory';

        btn.style.cssText = 'position:fixed; top:70px; right:20px; z-index:2147483647; padding:12px 18px; background-color:#22d3ee; color:black; border:2px solid #fff; border-radius:5px; cursor:move; font-family:monospace; font-weight:bold; box-shadow: 0 4px 10px rgba(0,0,0,0.5); user-select:none;';

        let isDragging = false;
        let hasDragged = false;
        let offsetX, offsetY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            hasDragged = false;
            const rect = btn.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            hasDragged = true;
            btn.style.right = 'auto';
            btn.style.left = (e.clientX - offsetX) + 'px';
            btn.style.top = (e.clientY - offsetY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        btn.addEventListener('click', async (e) => {
            if (hasDragged) return;
            try {
                quaidDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                btn.innerText = 'Directory Bound: Gemini Active';
                btn.style.backgroundColor = '#10b981';
                btn.style.color = 'white';
                console.log("[Gemini Lens]: Directory handle secured.");
            } catch (err) {
                console.error("[Gemini Lens]: Handshake failed.", err);
            }
        });
        document.body.appendChild(btn);
    }

    // --- 2. CHAT DOM INJECTION (v2.4 Reliability Patch) ---
    function injectTextAndSend(text) {
        const inputDiv = document.querySelector('rich-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('.ql-editor');
        if (!inputDiv) return;

        inputDiv.focus();

        if (inputDiv.tagName.toLowerCase() === 'rich-textarea' && 'value' in inputDiv) {
            inputDiv.value = text;
        } else {
            document.execCommand('insertText', false, text);
        }

        inputDiv.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inputDiv.dispatchEvent(new Event('change', { bubbles: true }));

        setTimeout(() => {
            const sendButton = document.querySelector('button.send-button, button[aria-label^="Send"]');

            if (sendButton && !sendButton.disabled) {
                sendButton.click();
            } else {
                const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true });
                inputDiv.dispatchEvent(enterEvent);
            }

            setTimeout(() => { isExecutingCommand = false; }, 1500);
        }, 300);
    }

    // --- 3. SANITIZATION & SECURITY ---
    function sanitizeContent(content) {
        return content.replace(/\[READ_FILE/g, '&#91;READ_FILE')
                      .replace(/\[WRITE_FILE/g, '&#91;WRITE_FILE')
                      .replace(/\[LIST_DIR/g, '&#91;LIST_DIR');
    }

    function normalizePath(filepath) {
        const cleanPath = filepath.trim();
        if (cleanPath.startsWith('/') || cleanPath.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(cleanPath)) {
            throw new Error("Absolute paths blocked to prevent OS-level overwrite.");
        }
        if (cleanPath.includes('..')) {
            throw new Error("Path traversal blocked to prevent OS-level overwrite.");
        }
        return cleanPath;
    }

    // --- 4. FILE SYSTEM OPERATIONS ---
    async function executeReadTag(filepath, offset = 0) {
        if (!quaidDirectoryHandle) return;
        try {
            const safePath = normalizePath(filepath);
            const parts = safePath.split(/[/\\]/);
            const filename = parts.pop();
            let currentDir = quaidDirectoryHandle;

            for (const part of parts) {
                if (part) currentDir = await currentDir.getDirectoryHandle(part);
            }

            const fileHandle = await currentDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const fullContent = await file.text();

            const chunk = fullContent.substring(offset, offset + CHUNK_LIMIT);
            let sanitizedChunk = sanitizeContent(chunk);
            let output = `[FILE_CONTENTS: ${safePath} | Offset: ${offset}]\n${sanitizedChunk}\n[/FILE_CONTENTS]`;

            if (fullContent.length > offset + CHUNK_LIMIT) {
                output += `\n[SYSTEM_NOTICE: FILE TRUNCATED. Issue command: [READ_FILE_CHUNK: ${safePath} | offset: ${offset + CHUNK_LIMIT}] ]`;
            }
            injectTextAndSend(output);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not read ${filepath}.]`);
        }
    }

    async function executeListTag(targetPath) {
        if (!quaidDirectoryHandle) return;
        try {
            const safePath = normalizePath(targetPath);
            let currentDir = quaidDirectoryHandle;

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
            injectTextAndSend(`[SYSTEM_ERROR: Could not list directory.]`);
        }
    }

    async function executeWriteTag(filepath, content) {
        if (!quaidDirectoryHandle) return;
        try {
            const safePath = normalizePath(filepath);
            const parts = safePath.split(/[/\\]/);
            const filename = parts.pop();
            let currentDir = quaidDirectoryHandle;

            for (const part of parts) {
                if (part) currentDir = await currentDir.getDirectoryHandle(part, { create: true });
            }

            const fileHandle = await currentDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();

            injectTextAndSend(`[SYSTEM_NOTICE: Successfully wrote to ${safePath}]`);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not write ${filepath}.]`);
        }
    }

    // --- 5. THE OBSERVER & PAST-LIFE SWEEP ---
    function stripBridgeOutput(text) {
        let stripped = text;
        stripped = stripped.replace(/\[FILE_CONTENTS:[\s\S]*?\[\/FILE_CONTENTS\]/g, "");
        stripped = stripped.replace(/\[DIRECTORY_LIST:[\s\S]*?\[\/DIRECTORY_LIST\]/g, "");
        stripped = stripped.replace(/\[SYSTEM_ERROR:.*?\]/g, "");
        stripped = stripped.replace(/\[SYSTEM_NOTICE:.*?\]/g, "");
        return stripped;
    }

    function startObserver() {
        document.querySelectorAll('.model-response-text, .message-content, [data-test-id="model-message"]').forEach(node => {
            node.dataset.quaidProcessed = "true";
        });

        let parseTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (isExecutingCommand) return;

            clearTimeout(parseTimer);
            parseTimer = setTimeout(() => {
                const nodes = document.querySelectorAll('.model-response-text, .message-content, [data-test-id="model-message"]');
                if (nodes.length === 0) return;

                const lastNode = nodes[nodes.length - 1];
                if (lastNode.dataset.quaidProcessed === "true") return;

                let textContent = lastNode.innerText || "";
                textContent = stripBridgeOutput(textContent);

                const writeMatch = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g.exec(textContent);
                if (writeMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.quaidProcessed = "true";
                    executeWriteTag(writeMatch[1].trim(), writeMatch[2].trim());
                    return;
                }

                const readMatch = /\[READ_FILE:\s*([^\]]+)\]/g.exec(textContent);
                if (readMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.quaidProcessed = "true";
                    executeReadTag(readMatch[1].trim(), 0);
                    return;
                }

                const chunkMatch = /\[READ_FILE_CHUNK:\s*([^|]+)\|\s*offset:\s*(\d+)\]/g.exec(textContent);
                if (chunkMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.quaidProcessed = "true";
                    executeReadTag(chunkMatch[1].trim(), parseInt(chunkMatch[2], 10));
                    return;
                }

                const listMatch = /\[LIST_DIR:\s*([^\]]+)\]/g.exec(textContent);
                if (listMatch) {
                    isExecutingCommand = true;
                    lastNode.dataset.quaidProcessed = "true";
                    executeListTag(listMatch[1].trim());
                    return;
                }

                // Catch-all: Mark non-command responses as processed
                if ((lastNode.innerText || "").length > 0) {
                    lastNode.dataset.quaidProcessed = "true";
                }

            }, 1000);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- 6. THE HEARTBEAT (Don't Interrupt Me Edition) ---
    function startTheHeartbeat() {
        let silenceTimer;
        function resetSilenceTimer() {
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(triggerBoop, BOOP_INTERVAL_MS);
        }

        function triggerBoop() {
            if(isExecutingCommand) return;

            const inputDiv = document.querySelector('rich-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('.ql-editor');
            if (inputDiv && (
                  (inputDiv.innerText && inputDiv.innerText.trim().length > 0) ||
                  (inputDiv.value && inputDiv.value.trim().length > 0)
            )) {
                console.log("[Gemini Lens]: User is typing. Skipping boop.");
                resetSilenceTimer();
                return;
            }

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
