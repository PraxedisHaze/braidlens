// ==UserScript==
// @name         The Braid Lens (Duck.ai Bridge - v3.0.0)
// @namespace    braid.lens
// @version      3.0.0
// @description  User-selected-folder bridge and Holodox 2 relay transport for Duck.ai (DuckDuckGo AI Chat). Reads and writes inside the chosen folder; connects to local Holodox 2 Hall; Orient Duck button; opt-in boop.
// @author       Timothy, Leora, Claude & Codex
// @match        *://duck.ai/*
// @match        *://duckduckgo.com/?q=DuckDuckGo+AI+Chat*
// @match        *://duckduckgo.com/chat*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

/*
  DUCK.AI BRIDGE COMMAND MANUAL

  Click "Orient Duck" to send the live instructions into this Duck.ai
  conversation. Duck.ai emits one exact tag when it needs a local-folder
  operation; the bridge performs it and sends an evidence receipt back.

  Root listing:       [LIST_DIR:]
  Root file:          [READ_FILE: README.md]
  Nested file:        [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]
  Large file chunk:   [READ_FILE_CHUNK: path.txt | offset: 100000]
  Write:              [WRITE_FILE: relative/path.md]...[/WRITE_FILE]
  Append:             [APPEND_FILE: relative/path.md]...[/APPEND_FILE]

  Holodox 2 Transport:
  Connects this Duck.ai browser tab as a first-class seat ("duck") in
  the local Holodox 2 Meeting Hall on port 43921.
*/

(function () {
    'use strict';

    var VERSION = '3.0.0';
    var CHUNK_LIMIT = 100000;
    var DB_NAME = 'braid-lens-duck';
    var DB_STORE = 'handles';
    var HANDLE_KEY = 'bound-directory';
    var PROCESSED_ATTR = 'data-braid-lens-processed';

    var directoryHandle = null;
    var commandBusy = false;
    var statusElement = null;
    var boopEnabled = false;
    var boopTimer = null;
    var boopButton = null;

    // Holodox 2 Relay Transport State
    var relayUrl = 'http://127.0.0.1:43921';
    var relayToken = '7X5mDxTsFG3DKgbL1D-Bjsh7LkaNSQsEAjyd19M-14Y';
    var agentId = 'duck';
    var transportActive = false;
    var transportTimer = null;
    var transportButton = null;
    var lastProcessedMessageText = '';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Duck.ai Lens]');
        console.log.apply(console, args);
    }

    function uniqueNodes(nodes) {
        return Array.from(new Set(nodes));
    }

    function findInput() {
        return document.querySelector('textarea[name="user-prompt"]') ||
            document.querySelector('textarea[placeholder*="Ask" i]') ||
            document.querySelector('textarea[placeholder*="message" i]') ||
            document.querySelector('textarea[placeholder*="type" i]') ||
            document.querySelector('div[contenteditable="true"][role="textbox"]') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('textarea') ||
            document.querySelector('[role="textbox"]');
    }

    function findSendButton() {
        var candidates = [
            document.querySelector('button[type="submit"]'),
            document.querySelector('button[aria-label="Send message"]'),
            document.querySelector('button[aria-label="Send prompt"]'),
            document.querySelector('button[aria-label="Send"]'),
            document.querySelector('button[aria-label*="send" i]'),
            document.querySelector('button[aria-label*="submit" i]'),
            document.querySelector('button[data-testid*="send" i]'),
            document.querySelector('.sk-action-btn')
        ];
        return candidates.find(function (button) {
            return button && !button.disabled &&
                (button.offsetWidth || button.offsetHeight || button.getClientRects().length);
        }) || null;
    }

    function currentInputText(input) {
        if (!input) return '';
        return String(input.value || input.innerText || input.textContent || '').trim();
    }

    function setInputText(input, text) {
        input.focus();
        if ('value' in input && input.tagName.toLowerCase() === 'textarea') {
            var proto = window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : Object.getPrototypeOf(input);
            var setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) setter.set.call(input, text);
            else input.value = text;
        } else {
            var selection = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(input);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
            if (!document.execCommand('insertText', false, text)) {
                input.textContent = text;
            }
        }
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function injectTextAndSend(text) {
        var input = findInput();
        if (!input) {
            commandBusy = false;
            setStatus('Input element not found in Duck.ai DOM.');
            return;
        }

        setInputText(input, text);

        var startedAt = Date.now();
        var deadline = startedAt + 6000;

        function trySend() {
            var button = findSendButton();
            if (button && !button.disabled && currentInputText(input)) {
                button.click();
                setStatus('Message sent to Duck.ai.');
                window.setTimeout(function () { commandBusy = false; }, 1200);
                return;
            }

            if (Date.now() >= deadline) {
                commandBusy = false;
                setStatus('Text inserted, but Duck.ai submit button was not ready. Press Enter or Submit.');
                return;
            }
            window.setTimeout(trySend, 150);
        }

        trySend();
    }

    function setStatus(message) {
        if (statusElement) statusElement.textContent = message;
        log(message);
    }

    var BRIDGE_INSTRUCTIONS = [
        '[DUCK.AI BRIDGE INSTRUCTIONS]',
        'You have access to a user-selected local folder through the Braid Lens browser bridge.',
        'When you need a file operation, emit exactly one command tag in your assistant response; the user does not need to type the tag.',
        'All paths are relative to the bound folder. Never use an absolute path or .. traversal.',
        'ROOT EXAMPLE: [LIST_DIR:] lists the bound-folder root. The empty path is intentional.',
        'ROOT FILE EXAMPLE: [READ_FILE: README.md]',
        'NESTED FOLDER EXAMPLE: [LIST_DIR: PRESERVATION/Timothy]',
        'NESTED FILE EXAMPLE: [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]',
        'LARGE FILE EXAMPLE: [READ_FILE_CHUNK: relative/path.md | offset: 100000]',
        'WRITE EXAMPLE: [WRITE_FILE: applings/BraidLens/examples/duck-bridge-test.md]Hello from Duck.ai.[/WRITE_FILE]',
        'APPEND EXAMPLE: [APPEND_FILE: applings/BraidLens/examples/duck-bridge-test.md]Second line.[/APPEND_FILE]',
        'The single period "." is only the optional five-minute boop. It is not a root-folder command and it is not a path.',
        'Do not use [LIST_DIR: .] for the root; use [LIST_DIR:] exactly.',
        'Put one command tag on its own line. Do not claim success until the bridge returns a FILE_CONTENTS, DIRECTORY_LIST, WRITE_RESULT, or SYSTEM_NOTICE receipt.',
        'This adapter connects directly to the local Holodox 2 Hall.',
        '[/DUCK.AI BRIDGE INSTRUCTIONS]'
    ].join('\n');

    function sendBridgeInstructions() {
        if (commandBusy) {
            setStatus('A file operation is still in progress; instructions not sent.');
            return;
        }
        injectTextAndSend(BRIDGE_INSTRUCTIONS);
        setStatus('Bridge instructions sent to Duck.ai.');
    }

    function isVisibleElement(element) {
        return element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    function duckIsGenerating() {
        return Array.from(document.querySelectorAll('button')).some(function (button) {
            var label = (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '');
            return isVisibleElement(button) && !button.disabled && /stop/i.test(label);
        });
    }

    function updateBoopButton() {
        if (!boopButton) return;
        boopButton.textContent = boopEnabled ? 'Boop: ON' : 'Boop: OFF';
        boopButton.style.background = boopEnabled ? '#059669' : '#374151';
        boopButton.title = boopEnabled ? 'Five-minute boop is enabled; click to turn it off.' : 'Five-minute boop is disabled; click to turn it on.';
    }

    function triggerBoop() {
        if (!boopEnabled || commandBusy || duckIsGenerating()) return;
        var input = findInput();
        if (!input || currentInputText(input)) return;
        injectTextAndSend('.');
        setStatus('Boop sent to Duck.ai.');
    }

    function toggleBoop() {
        boopEnabled = !boopEnabled;
        if (boopTimer) {
            window.clearInterval(boopTimer);
            boopTimer = null;
        }
        if (boopEnabled) {
            boopTimer = window.setInterval(triggerBoop, 300000);
            setStatus('Boop enabled; first boop scheduled in five minutes.');
        } else {
            setStatus('Boop disabled.');
        }
        updateBoopButton();
    }

    // ----------------------------------------------------
    // Holodox 2 Transport Bridge
    // ----------------------------------------------------
    function relayFetch(path, options) {
        options = options || {};
        var url = relayUrl.replace(/\/$/, '') + path;
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: Object.assign({
                        'Authorization': 'Bearer ' + relayToken,
                        'Content-Type': 'application/json'
                    }, options.headers || {}),
                    data: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
                    timeout: 25000,
                    onload: function (r) {
                        try {
                            var val = JSON.parse(r.responseText || '{}');
                            if (r.status >= 200 && r.status < 300) resolve(val);
                            else reject(new Error(val.error || ('HTTP ' + r.status)));
                        } catch (err) {
                            reject(err);
                        }
                    },
                    onerror: function () { reject(new Error('Relay request failed')); },
                    ontimeout: function () { reject(new Error('Relay timed out')); }
                });
            } else {
                fetch(url, {
                    method: options.method || 'GET',
                    headers: Object.assign({
                        'Authorization': 'Bearer ' + relayToken,
                        'Content-Type': 'application/json'
                    }, options.headers || {}),
                    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
                }).then(function (res) { return res.json(); }).then(resolve).catch(reject);
            }
        });
    }

    function updateTransportButton() {
        if (!transportButton) return;
        transportButton.textContent = transportActive ? 'Hall: CONNECTED' : 'Hall: DISCONNECTED';
        transportButton.style.background = transportActive ? '#0284c7' : '#374151';
    }

    async function pollRelay() {
        if (!transportActive || commandBusy || duckIsGenerating()) return;
        try {
            var data = await relayFetch('/poll?wait=5');
            var messages = data.messages || [];
            for (var i = 0; i < messages.length; i++) {
                var m = messages[i];
                log('Received Hall message:', m);
                // Acknowledge receipt
                await relayFetch('/ack', { method: 'POST', body: { id: m.id } });
                // If it came from someone else and contains actionable content, feed it into Duck.ai
                if (m.from !== agentId && m.content) {
                    var promptText = '[HOLODOX DISPATCH from ' + m.from.toUpperCase() + ']:\n' + m.content;
                    injectTextAndSend(promptText);
                    setStatus('Dispatched message from ' + m.from + ' into Duck.ai');
                    break;
                }
            }
        } catch (e) {
            log('Poll notice:', e.message);
        }
    }

    function toggleTransport() {
        transportActive = !transportActive;
        if (transportTimer) {
            window.clearInterval(transportTimer);
            transportTimer = null;
        }
        if (transportActive) {
            relayFetch('/join', { method: 'POST', body: { agent_id: agentId } }).then(function () {
                setStatus('Joined Holodox 2 Hall as "' + agentId + '".');
                transportTimer = window.setInterval(pollRelay, 6000);
            }).catch(function (err) {
                setStatus('Hall join failed: ' + err.message);
                transportActive = false;
                updateTransportButton();
            });
        } else {
            setStatus('Disconnected from Holodox 2 Hall.');
        }
        updateTransportButton();
    }

    // ----------------------------------------------------
    // Drive Bridge (Filesystem Access API)
    // ----------------------------------------------------
    function makeDraggable(element) {
        var dragging = false;
        var moved = false;
        var offsetX = 0;
        var offsetY = 0;

        element.addEventListener('mousedown', function (event) {
            if (event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT' || event.target.tagName === 'SUMMARY') return;
            dragging = true;
            moved = false;
            var rect = element.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
        });
        document.addEventListener('mousemove', function (event) {
            if (!dragging) return;
            moved = true;
            element.style.left = (event.clientX - offsetX) + 'px';
            element.style.top = (event.clientY - offsetY) + 'px';
            element.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
        return function () { return moved; };
    }

    function openHandleDb() {
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = function () {
                request.result.createObjectStore(DB_STORE);
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function saveHandle(handle) {
        return openHandleDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function loadHandle() {
        return openHandleDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DB_STORE, 'readonly');
                var request = tx.objectStore(DB_STORE).get(HANDLE_KEY);
                request.onsuccess = function () { db.close(); resolve(request.result || null); };
                request.onerror = function () { db.close(); reject(request.error); };
            });
        });
    }

    function ensurePermission() {
        if (!directoryHandle) return Promise.resolve(false);
        return directoryHandle.queryPermission({ mode: 'readwrite' }).then(function (state) {
            if (state === 'granted') return true;
            setStatus('Folder permission needs a user click on Bind Folder.');
            return false;
        }).catch(function (error) {
            setStatus('Folder permission check failed: ' + error.message);
            return false;
        });
    }

    function normalizePath(rawPath) {
        var value = String(rawPath || '').trim().replace(/\\/g, '/');
        if (!value || value === '.' || value === '/') return '';
        if (value.charAt(0) === '/' || /^[A-Za-z]:\//.test(value)) {
            throw new Error('absolute paths are blocked');
        }
        var parts = value.split('/');
        if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
            throw new Error('empty, dot, and traversal path segments are blocked');
        }
        return parts.join('/');
    }

    function pathParts(path) {
        return path ? path.split('/') : [];
    }

    function openDirectory(path, create) {
        if (!directoryHandle) return Promise.reject(new Error('no folder is bound'));
        var current = Promise.resolve(directoryHandle);
        pathParts(path).forEach(function (part) {
            current = current.then(function (dir) {
                return dir.getDirectoryHandle(part, { create: !!create });
            });
        });
        return current;
    }

    function getFile(path, create) {
        var parts = pathParts(path);
        if (!parts.length) return Promise.reject(new Error('a file path is required'));
        var filename = parts.pop();
        return openDirectory(parts.join('/'), create).then(function (parent) {
            return parent.getFileHandle(filename, { create: !!create });
        });
    }

    function sanitizeContent(content) {
        return String(content)
            .replace(/\[READ_FILE/g, '&#91;READ_FILE')
            .replace(/\[READ_FILE_CHUNK/g, '&#91;READ_FILE_CHUNK')
            .replace(/\[WRITE_FILE/g, '&#91;WRITE_FILE')
            .replace(/\[APPEND_FILE/g, '&#91;APPEND_FILE')
            .replace(/\[LIST_DIR/g, '&#91;LIST_DIR');
    }

    function isRegexTrap(path) {
        return ['\\s*', '[^', ']+', '.*', '(.*?)', '\\d+', 'a-zA-Z']
            .some(function (token) { return path.indexOf(token) !== -1; });
    }

    function executeRead(path, offset) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) { commandBusy = false; return; }
            var safePath = normalizePath(path);
            return getFile(safePath, false).then(function (handle) {
                return handle.getFile();
            }).then(function (file) {
                return file.text().then(function (content) {
                    var start = Number(offset || 0);
                    var chunk = content.slice(start, start + CHUNK_LIMIT);
                    var output = '[FILE_CONTENTS: ' + safePath + ' | Offset: ' + start + ']\n' +
                        sanitizeContent(chunk) + '\n[/FILE_CONTENTS]';
                    if (content.length > start + CHUNK_LIMIT) {
                        output += '\n[SYSTEM_NOTICE: FILE TRUNCATED. Read next chunk with [READ_FILE_CHUNK: ' +
                            safePath + ' | offset: ' + (start + CHUNK_LIMIT) + ']]';
                    }
                    setStatus('File read; sending receipt for ' + safePath + '...');
                    injectTextAndSend(output);
                });
            });
        }).catch(function (error) {
            commandBusy = false;
            setStatus('Read failed: ' + error.message);
        });
    }

    function executeList(path) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) { commandBusy = false; return; }
            var safePath = normalizePath(path);
            return openDirectory(safePath, false).then(function (directory) {
                var output = '[DIRECTORY_LIST: ' + (safePath || 'root') + ']\n';
                return (async function () {
                    for await (var entry of directory.values()) {
                        output += '- ' + entry.name + ' (' + entry.kind + ')\n';
                    }
                    setStatus('Directory listed; sending receipt...');
                    injectTextAndSend(output + '[/DIRECTORY_LIST]');
                })();
            });
        }).catch(function (error) {
            commandBusy = false;
            setStatus('Directory listing failed: ' + error.message);
        });
    }

    function executeWrite(path, content, append) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) { commandBusy = false; return; }
            var safePath = normalizePath(path);
            return getFile(safePath, true).then(function (handle) {
                if (append) {
                    return handle.getFile().then(function (existing) {
                        return handle.createWritable({ keepExistingData: true }).then(function (writable) {
                            return writable.seek(existing.size).then(function () {
                                return writable.write('\n' + content).then(function () {
                                    return writable.close();
                                });
                            });
                        });
                    });
                }
                return handle.createWritable().then(function (writable) {
                    return writable.write(content).then(function () { return writable.close(); });
                });
            }).then(function () {
                setStatus((append ? 'Append' : 'Write') + ' succeeded; sending receipt...');
                injectTextAndSend('[SYSTEM_NOTICE: Successfully ' +
                    (append ? 'appended to' : 'wrote') + ' ' + safePath + ']');
            });
        }).catch(function (error) {
            commandBusy = false;
            setStatus((append ? 'Append' : 'Write') + ' failed: ' + error.message);
        });
    }

    function serializeNode(node) {
        return node && (node.innerText || node.textContent || '') || '';
    }

    function assistantMessages() {
        var selectors = [
            '[data-testid*="message"]:not([data-testid*="user"])',
            '[data-testid*="response"]',
            'article:not([data-user="true"])',
            '.prose',
            '.markdown',
            'div[class*="messageContent"]',
            'div[class*="assistant"]'
        ];
        var nodes = selectors.flatMap(function (selector) {
            return Array.from(document.querySelectorAll(selector));
        });
        return uniqueNodes(nodes);
    }

    function stripBridgeOutput(text) {
        return text
            .replace(/\[FILE_CONTENTS:[\s\S]*?\[\/FILE_CONTENTS\]/g, '')
            .replace(/\[DIRECTORY_LIST:[\s\S]*?\[\/DIRECTORY_LIST\]/g, '')
            .replace(/\[SYSTEM_NOTICE:[\s\S]*?\]/g, '')
            .replace(/\[SYSTEM_ERROR:[\s\S]*?\]/g, '');
    }

    function hasBridgeCommand(text) {
        return /\[(?:WRITE_FILE|APPEND_FILE|READ_FILE_CHUNK|READ_FILE|LIST_DIR):/.test(text);
    }

    function parseLatestAssistant() {
        if (commandBusy) return;
        var nodes = assistantMessages();
        if (!nodes.length) return;

        var node = null;
        var text = '';
        for (var index = nodes.length - 1; index >= 0; index -= 1) {
            var candidate = nodes[index];
            if (candidate.getAttribute(PROCESSED_ATTR) === 'true') continue;
            var candidateText = stripBridgeOutput(serializeNode(candidate));
            if (!candidateText.trim()) continue;
            node = candidate;
            text = candidateText;
            break;
        }
        if (!node) return;

        // Check if there is an active file bridge command
        var write = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/.exec(text);
        var append = /\[APPEND_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/APPEND_FILE\]/.exec(text);
        var readChunk = /\[READ_FILE_CHUNK:\s*([^|]+)\|\s*offset:\s*(\d+)\]/.exec(text);
        var read = /\[READ_FILE:\s*([^\]]+)\]/.exec(text);
        var list = /\[LIST_DIR:\s*([^\]]*)\]/.exec(text);

        var recognized = false;
        if (write && !isRegexTrap(write[1])) {
            recognized = true;
            commandBusy = true;
            executeWrite(write[1].trim(), write[2].trim(), false);
        } else if (append && !isRegexTrap(append[1])) {
            recognized = true;
            commandBusy = true;
            executeWrite(append[1].trim(), append[2].trim(), true);
        } else if (readChunk && !isRegexTrap(readChunk[1])) {
            recognized = true;
            commandBusy = true;
            executeRead(readChunk[1].trim(), Number(readChunk[2]));
        } else if (read && !isRegexTrap(read[1])) {
            recognized = true;
            commandBusy = true;
            executeRead(read[1].trim(), 0);
        } else if (list && !isRegexTrap(list[1])) {
            recognized = true;
            commandBusy = true;
            executeList(list[1].trim());
        }

        // Check if Holodox Relay transport should echo Duck.ai response back to Hall
        if (transportActive && !recognized && !duckIsGenerating() && text !== lastProcessedMessageText && !text.startsWith('[HOLODOX DISPATCH')) {
            lastProcessedMessageText = text;
            relayFetch('/send', {
                method: 'POST',
                body: {
                    to_group: 'universal',
                    type: 'response',
                    content: text
                }
            }).then(function () {
                log('Echoed Duck.ai response back to Holodox 2 Hall.');
            }).catch(function (err) {
                log('Failed to echo Duck.ai response to Hall:', err.message);
            });
        }

        if (recognized || !hasBridgeCommand(text)) node.setAttribute(PROCESSED_ATTR, 'true');
    }

    function injectPanel() {
        if (document.getElementById('braid-lens-duck-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'braid-lens-duck-panel';
        panel.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;width:370px;padding:14px;background:linear-gradient(160deg,#18181b 0%,#1e293b 100%);color:#f9fafb;border:2px solid #de5833;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;';

        var title = document.createElement('div');
        title.textContent = '🦆 Braid Lens — Duck.ai v' + VERSION;
        title.style.cssText = 'font-weight:bold;color:#f97316;margin-bottom:8px;cursor:move;font-size:13px;';
        panel.appendChild(title);

        var bind = document.createElement('button');
        bind.textContent = 'Bind Folder';
        bind.style.cssText = 'padding:6px 9px;background:#0d9488;color:white;border:0;border-radius:4px;cursor:pointer;margin-right:6px;font-weight:bold;';
        var wasDragged = makeDraggable(panel);

        bind.addEventListener('click', function () {
            if (wasDragged()) return;
            window.showDirectoryPicker({ mode: 'readwrite' }).then(function (chosen) {
                return chosen.requestPermission({ mode: 'readwrite' }).then(function (permission) {
                    if (permission !== 'granted') throw new Error('read/write permission was not granted');
                    directoryHandle = chosen;
                    return saveHandle(chosen).then(function () {
                        setStatus('Bound folder: ' + chosen.name);
                        bind.textContent = 'Bound: ' + chosen.name;
                    });
                });
            }).catch(function (error) {
                setStatus('Bind cancelled or failed: ' + error.message);
            });
        });
        panel.appendChild(bind);

        var orient = document.createElement('button');
        orient.textContent = 'Orient Duck';
        orient.style.cssText = 'padding:6px 9px;background:#ea580c;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
        orient.addEventListener('click', function () {
            if (wasDragged()) return;
            sendBridgeInstructions();
        });
        panel.appendChild(orient);

        transportButton = document.createElement('button');
        transportButton.style.cssText = 'padding:6px 9px;background:#374151;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
        transportButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleTransport();
        });
        panel.appendChild(transportButton);
        updateTransportButton();

        boopButton = document.createElement('button');
        boopButton.style.cssText = 'padding:6px 9px;background:#334155;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;';
        boopButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleBoop();
        });
        panel.appendChild(boopButton);
        updateBoopButton();

        var diagnose = document.createElement('button');
        diagnose.textContent = 'Diagnose';
        diagnose.style.cssText = 'padding:6px 9px;background:#6366f1;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;';
        diagnose.addEventListener('click', function () {
            if (wasDragged()) return;
            var input = findInput();
            var report = '[DUCK.AI LENS DIAGNOSTIC - v' + VERSION + ']\n' +
                'Platform: ' + location.hostname + '\n' +
                'Input: ' + (input ? input.tagName : 'NOT FOUND') + '\n' +
                'Send: ' + (findSendButton() ? 'FOUND' : 'NOT FOUND') + '\n' +
                'Assistant messages: ' + assistantMessages().length + '\n' +
                'Bound folder: ' + (directoryHandle ? directoryHandle.name : 'NONE') + '\n' +
                'Hall Transport: ' + (transportActive ? 'ACTIVE' : 'OFF') + '\n' +
                'Boop: ' + (boopEnabled ? 'ON' : 'OFF');
            setStatus(report.replace(/\n/g, ' | '));
            injectTextAndSend(report);
        });
        panel.appendChild(diagnose);

        var guide = document.createElement('details');
        guide.style.cssText = 'margin-top:10px;border-top:1px solid #334155;padding-top:8px;';
        var guideSummary = document.createElement('summary');
        guideSummary.textContent = 'How to use Duck.ai Braid Lens';
        guideSummary.style.cssText = 'cursor:pointer;color:#fed7aa;font-weight:bold;';
        guide.appendChild(guideSummary);
        var guideBody = document.createElement('div');
        guideBody.textContent = '1. Click "Bind Folder" to give Duck.ai access to your workspace.\n2. Click "Orient Duck" to send live instructions into the conversation.\n3. Click "Hall: CONNECTED" to link Duck.ai directly to Holodox 2 on port 43921.\nCommands:\n- Root list: [LIST_DIR:]\n- Read file: [READ_FILE: path.md]\n- Write file: [WRITE_FILE: path.md]text[/WRITE_FILE]';
        guideBody.style.cssText = 'margin-top:7px;color:#cbd5e1;white-space:pre-wrap;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;';
        guide.appendChild(guideBody);
        panel.appendChild(guide);

        statusElement = document.createElement('div');
        statusElement.textContent = 'Ready. Bind a folder or connect to Hall.';
        statusElement.style.cssText = 'margin-top:8px;color:#cbd5e1;white-space:pre-wrap;font-family:monospace;font-size:11px;';
        panel.appendChild(statusElement);
        document.body.appendChild(panel);

        loadHandle().then(function (saved) {
            if (!saved) return;
            directoryHandle = saved;
            return saved.queryPermission({ mode: 'readwrite' }).then(function (permission) {
                if (permission === 'granted') {
                    bind.textContent = 'Bound: ' + saved.name;
                    setStatus('Bound folder: ' + saved.name);
                } else {
                    bind.textContent = 'Re-authorize folder';
                    setStatus('Saved folder found: ' + saved.name + '; click Re-authorize folder before reading or writing.');
                }
            }).catch(function () {
                bind.textContent = 'Re-authorize folder';
                setStatus('Saved folder found, but permission must be re-authorized with a click.');
            });
        }).catch(function (error) {
            setStatus('Saved folder lookup unavailable: ' + error.message);
        });
    }

    function startObserver() {
        var observer = new MutationObserver(function () {
            window.setTimeout(parseLatestAssistant, 900);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.setTimeout(parseLatestAssistant, 1200);
    }

    function boot() {
        if (!location.hostname.includes('duck.ai') && !location.hostname.includes('duckduckgo.com')) return;
        log('WAKING UP - v' + VERSION + '; direct folder bridge and Holodox 2 relay transport');
        window.setInterval(injectPanel, 1500);
        window.setTimeout(startObserver, 2500);
    }

    boot();
})();
