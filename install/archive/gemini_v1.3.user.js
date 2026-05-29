// ==UserScript==
// @name         The Braid Lens (Gemini Bridge)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Local file bridge with loop-breaker and QuAId-confined writes.
// @author       Gemini, Timothy & Codex
// @match        *://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BRIDGE_NAME = 'Gemini Lens';
    const BUTTON_ID = 'braid-handshake-btn';
    const CHUNK_LIMIT = 25000;
    const BOOP_INTERVAL_MS = 300000;
    const SEND_DELAY_MS = 600;
    const UNLOCK_DELAY_MS = 1500;

    let quaidDirectoryHandle = null;
    let isExecutingCommand = false;

    console.log(
        `%c[${BRIDGE_NAME}]: WAKING UP - v1.3 Active (QuAId Write Gate Engaged)`,
        'color: #22d3ee; font-size: 16px; font-weight: bold;'
    );

    function normalizePath(rawPath) {
        const trimmed = String(rawPath || '').trim().replaceAll('\\', '/');
        if (!trimmed || trimmed === '.') return [];
        if (/^[a-zA-Z]:\//.test(trimmed) || trimmed.startsWith('/')) {
            throw new Error('absolute paths are not allowed');
        }

        const parts = trimmed.split('/').filter(Boolean);
        if (parts.some((part) => part === '..' || part === '.')) {
            throw new Error('path traversal is not allowed');
        }
        return parts;
    }

    function assertWritePath(parts) {
        if (parts.length < 2 || parts[0] !== 'QuAId') {
            throw new Error('writes are restricted to QuAId/');
        }
    }

    function displayPath(parts) {
        return parts.join('/');
    }

    function sanitizeContent(content) {
        return String(content)
            .replace(/\[READ_FILE/g, '&#91;READ_FILE')
            .replace(/\[READ_FILE_CHUNK/g, '&#91;READ_FILE_CHUNK')
            .replace(/\[WRITE_FILE/g, '&#91;WRITE_FILE')
            .replace(/\[LIST_DIR/g, '&#91;LIST_DIR');
    }

    function stripBridgeOutput(text) {
        return String(text || '')
            .replace(/\[FILE_CONTENTS:[\s\S]*?\[\/FILE_CONTENTS\]/g, '')
            .replace(/\[WRITE_RESULT:[\s\S]*?\[\/WRITE_RESULT\]/g, '')
            .replace(/\[DIRECTORY_LIST:[\s\S]*?\[\/DIRECTORY_LIST\]/g, '')
            .replace(/\[SYSTEM_ERROR:[\s\S]*?\[\/SYSTEM_ERROR\]/g, '')
            .replace(/\[SYSTEM_ERROR:.*?\]/g, '');
    }

    function findInput() {
        return document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('.ql-editor') ||
            document.querySelector('textarea');
    }

    function setInputText(input, text) {
        input.focus();

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const prototype = Object.getPrototypeOf(input);
            const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (valueSetter) {
                valueSetter.call(input, text);
            } else {
                input.value = text;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        input.textContent = '';
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        if (!document.execCommand('insertText', false, text)) {
            input.textContent = text;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
    }

    function clickSend(input) {
        const sendButton = document.querySelector('button[aria-label="Send message"]') ||
            document.querySelector('.send-button');

        if (sendButton && !sendButton.disabled) {
            sendButton.click();
            return;
        }

        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            which: 13,
            keyCode: 13,
            bubbles: true
        });
        input.dispatchEvent(enterEvent);
    }

    function injectTextAndSend(text) {
        const input = findInput();
        if (!input) {
            console.error(`[${BRIDGE_NAME}]: Input box not found.`);
            isExecutingCommand = false;
            return;
        }

        setInputText(input, text);
        setTimeout(() => {
            clickSend(input);
            setTimeout(() => {
                isExecutingCommand = false;
            }, UNLOCK_DELAY_MS);
        }, SEND_DELAY_MS);
    }

    function injectHandshakeButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.innerText = 'Bind QuAId Directory';
        btn.style.cssText = [
            'position:fixed',
            'top:70px',
            'right:20px',
            'z-index:2147483647',
            'padding:12px 18px',
            'background-color:#22d3ee',
            'color:black',
            'border:2px solid #fff',
            'border-radius:5px',
            'cursor:pointer',
            'font-family:monospace',
            'font-weight:bold',
            'box-shadow:0 4px 10px rgba(0,0,0,0.5)'
        ].join(';');

        btn.addEventListener('click', async () => {
            try {
                quaidDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                btn.innerText = 'QuAId Bound: Gemini Active';
                btn.style.backgroundColor = '#10b981';
                btn.style.color = 'white';
                console.log(`[${BRIDGE_NAME}]: Directory handle secured.`);
            } catch (err) {
                console.error(`[${BRIDGE_NAME}]: Handshake failed.`, err);
            }
        });

        document.body.appendChild(btn);
    }

    async function getDirectoryHandle(parts, create) {
        let currentDir = quaidDirectoryHandle;
        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part, { create });
        }
        return currentDir;
    }

    async function executeReadTag(filepath, offset = 0) {
        if (!quaidDirectoryHandle) {
            injectTextAndSend('[SYSTEM_ERROR: Directory unbound.]');
            return;
        }

        try {
            const parts = normalizePath(filepath);
            if (parts.length === 0) throw new Error('file path is empty');

            const filename = parts.at(-1);
            const dirParts = parts.slice(0, -1);
            const currentDir = await getDirectoryHandle(dirParts, false);
            const fileHandle = await currentDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const fullContent = await file.text();
            const safeOffset = Math.max(0, Number(offset) || 0);

            const chunk = fullContent.substring(safeOffset, safeOffset + CHUNK_LIMIT);
            const sanitizedChunk = sanitizeContent(chunk);
            const pathLabel = displayPath(parts);
            let output = `[FILE_CONTENTS: ${pathLabel} | Offset: ${safeOffset}]\n${sanitizedChunk}\n`;

            if (fullContent.length > safeOffset + CHUNK_LIMIT) {
                output += `\n[SYSTEM_NOTICE: FILE TRUNCATED. Issue command: [READ_FILE_CHUNK: ${pathLabel} | offset: ${safeOffset + CHUNK_LIMIT}] ]\n`;
            }
            output += '[/FILE_CONTENTS]';
            injectTextAndSend(output);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not read ${filepath}. ${err.message}]`);
        }
    }

    async function executeListTag(path) {
        if (!quaidDirectoryHandle) {
            injectTextAndSend('[SYSTEM_ERROR: Directory unbound.]');
            return;
        }

        try {
            const parts = normalizePath(path);
            const currentDir = await getDirectoryHandle(parts, false);
            const pathLabel = parts.length ? displayPath(parts) : '.';
            let output = `[DIRECTORY_LIST: ${pathLabel}]\n`;

            for await (const entry of currentDir.values()) {
                output += `- ${entry.name} (${entry.kind})\n`;
            }

            output += '[/DIRECTORY_LIST]';
            injectTextAndSend(output);
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not list ${path}. ${err.message}]`);
        }
    }

    async function executeWriteTag(filepath, content) {
        if (!quaidDirectoryHandle) {
            injectTextAndSend('[SYSTEM_ERROR: Directory unbound.]');
            return;
        }

        try {
            const parts = normalizePath(filepath);
            assertWritePath(parts);

            const filename = parts.at(-1);
            const dirParts = parts.slice(0, -1);
            const currentDir = await getDirectoryHandle(dirParts, true);
            const fileHandle = await currentDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();

            await writable.write(content);
            await writable.close();

            const bytes = new TextEncoder().encode(content).length;
            injectTextAndSend(
                `[WRITE_RESULT: ${displayPath(parts)}]\nstatus: ok\nbytes: ${bytes}\n[/WRITE_RESULT]`
            );
        } catch (err) {
            injectTextAndSend(`[SYSTEM_ERROR: Could not write ${filepath}. ${err.message}]`);
        }
    }

    function parseAndExecuteCommand(lastNode) {
        let textContent = stripBridgeOutput(lastNode.innerText || '');

        const writeRegex = /\[WRITE_FILE:\s*([^\]\r\n]+?)\s*\]\r?\n?([\s\S]*?)\[\/WRITE_FILE\]/;
        const writeMatch = writeRegex.exec(textContent);
        if (writeMatch) {
            isExecutingCommand = true;
            lastNode.dataset.quaidProcessed = 'true';
            executeWriteTag(writeMatch[1].trim(), writeMatch[2]);
            return true;
        }

        const chunkRegex = /\[READ_FILE_CHUNK:\s*([^\]\|\r\n]+?)\s*\|\s*offset:\s*(\d+)\]/;
        const chunkMatch = chunkRegex.exec(textContent);
        if (chunkMatch) {
            isExecutingCommand = true;
            lastNode.dataset.quaidProcessed = 'true';
            executeReadTag(chunkMatch[1].trim(), parseInt(chunkMatch[2], 10));
            return true;
        }

        const readRegex = /\[READ_FILE:\s*([^\]\r\n]+?)\s*\]/;
        const readMatch = readRegex.exec(textContent);
        if (readMatch) {
            isExecutingCommand = true;
            lastNode.dataset.quaidProcessed = 'true';
            executeReadTag(readMatch[1].trim(), 0);
            return true;
        }

        const listRegex = /\[LIST_DIR:\s*([^\]\r\n]*?)\s*\]/;
        const listMatch = listRegex.exec(textContent);
        if (listMatch) {
            isExecutingCommand = true;
            lastNode.dataset.quaidProcessed = 'true';
            executeListTag(listMatch[1].trim() || '.');
            return true;
        }

        return false;
    }

    function startObserver() {
        let parseTimer = null;
        const observer = new MutationObserver(() => {
            if (isExecutingCommand) return;

            clearTimeout(parseTimer);
            parseTimer = setTimeout(() => {
                const nodes = document.querySelectorAll(
                    '.model-response-text, .message-content, [data-test-id="model-message"]'
                );
                if (nodes.length === 0) return;

                const lastNode = nodes[nodes.length - 1];
                if (lastNode.dataset.quaidProcessed === 'true') return;

                if (!parseAndExecuteCommand(lastNode) && (lastNode.innerText || '').length > 0) {
                    lastNode.dataset.quaidProcessed = 'true';
                }
            }, 1000);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function startTheHeartbeat() {
        let silenceTimer;

        function resetSilenceTimer() {
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(triggerBoop, BOOP_INTERVAL_MS);
        }

        function triggerBoop() {
            if (isExecutingCommand) return;
            injectTextAndSend('.');
            resetSilenceTimer();
        }

        document.addEventListener('keypress', resetSilenceTimer);
        document.addEventListener('click', resetSilenceTimer);
        resetSilenceTimer();
    }

    setInterval(injectHandshakeButton, 2000);
    setTimeout(() => {
        startObserver();
        startTheHeartbeat();
    }, 3000);
})();
