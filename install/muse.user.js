// ==UserScript==
// @name         The Braid Lens (Muse Bridge, Holodox Seat & Vernier Scrubber - v3.4.2)
// @namespace    braid.lens
// @version      3.4.2
// @description  Braid Lens drive bridge, native Holodox 2 Meeting Hall seat, Vernier Fisheye Scrubber, and Casey memory bridge for Muse.ai.
// @author       Timothy, Muse & Leora
// @match        *://muse.ai/*
// @match        *://*.muse.ai/*
// @match        *://agent.meta.ai/*
// @match        *://*.meta.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    var VERSION = '3.4.2';
    var CHUNK_LIMIT = 100000;
    var DB_NAME = 'braid-lens-muse';
    var DB_STORE = 'handles';
    var HANDLE_KEY = 'bound-directory';
    var PROCESSED_ATTR = 'data-braid-lens-processed';
    var PANEL_ID = 'braid-lens-muse-panel';

    // Command Deduplication & Concurrency Locks
    var inFlightSignatures = new Set();
    var completedSignatures = new Set();

    // Holodox Relay Configuration
    var RELAY_BASE = 'http://127.0.0.1:43921';
    var AGENT_ID = 'muse';
    var RELAY_TOKEN = 'Muse7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ';
    var holodoxActive = false;
    var holodoxButton = null;
    var holodoxHeartbeatTimer = null;
    var holodoxInFlight = new Set();
    var SEEN_STORAGE_KEY = 'braid_lens_muse_seen_v3';

    function loadSeen() {
        try {
            var raw = localStorage.getItem(SEEN_STORAGE_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set();
        }
    }

    function markSeen(id) {
        if (!id) return;
        holodoxSeen.add(id);
        try {
            var arr = Array.from(holodoxSeen);
            if (arr.length > 2000) arr = arr.slice(-1000);
            localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(arr));
        } catch (e) {}
    }
    var holodoxSeen = loadSeen();

    var directoryHandle = null;
    var commandBusy = false;
    var statusElement = null;
    var boopEnabled = false;
    var boopTimer = null;
    var boopButton = null;

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Muse Lens]');
        console.log.apply(console, args);
    }

    function uniqueNodes(nodes) {
        return Array.from(new Set(nodes));
    }

    function findInput() {
        return document.querySelector('textarea[data-hatch-composer-prehydration-input="true"]') ||
            document.querySelector('textarea[aria-label="Message"]') ||
            document.querySelector('textarea[placeholder="Message"]') ||
            document.querySelector('textarea[placeholder*="message" i]') ||
            document.querySelector('textarea') ||
            document.querySelector('div[contenteditable="true"][role="textbox"]') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('[role="textbox"]');
    }

    function findSendButton() {
        var candidates = [
            document.querySelector('button[aria-label="Send"]'),
            document.querySelector('button[aria-label*="Send" i]'),
            document.querySelector('button[type="submit"]')
        ];

        var input = findInput();
        if (input) {
            var container = input.closest('form') || input.closest('div[class*="composer"]') || input.parentElement;
            if (container) {
                var containerButtons = Array.from(container.querySelectorAll('button'));
                candidates = candidates.concat(containerButtons);
            }
        }

        return candidates.filter(Boolean).find(function (button) {
            var text = (button.getAttribute('aria-label') || button.textContent || '').toLowerCase();
            return !button.disabled && !/mic|attach|dictate|upload/i.test(text) &&
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
            var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
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
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function injectTextAndSend(text, onSuccess, onFailure) {
        var input = findInput();
        if (!input) {
            commandBusy = false;
            setStatus('Input element not found in Muse DOM.');
            if (onFailure) onFailure();
            return;
        }

        setInputText(input, text);

        var startedAt = Date.now();
        var deadline = startedAt + 5000;

        function trySend() {
            var button = findSendButton();
            if (button && !button.disabled && currentInputText(input)) {
                button.click();
                setStatus('Message sent to Muse.');
                window.setTimeout(function () { commandBusy = false; }, 1200);
                if (onSuccess) onSuccess();
                return;
            }

            if (Date.now() >= deadline) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                window.setTimeout(function () {
                    if (!currentInputText(input)) {
                        setStatus('Message sent to Muse via Enter key.');
                        window.setTimeout(function () { commandBusy = false; }, 1200);
                        if (onSuccess) onSuccess();
                    } else {
                        commandBusy = false;
                        setStatus('Text inserted, but Muse send button was not ready. Press Enter or Send.');
                        if (onFailure) onFailure();
                    }
                }, 300);
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

    // ==========================================
    // HOLODOX 2 RELAY CONNECTOR (TAMPERMONKEY)
    // ==========================================

    function gmRelayCall(route, method, data) {
        return new Promise(function (resolve, reject) {
            var headers = {
                'X-Agent-ID': AGENT_ID,
                'Authorization': 'Bearer ' + RELAY_TOKEN,
                'Content-Type': 'application/json'
            };

            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: method || 'GET',
                    url: RELAY_BASE + route,
                    headers: headers,
                    data: data ? JSON.stringify(data) : null,
                    timeout: 25000,
                    onload: function (res) {
                        if (res.status >= 200 && res.status < 300) {
                            try {
                                var json = JSON.parse(res.responseText || '{}');
                                resolve(json);
                            } catch (e) {
                                resolve({ raw: res.responseText });
                            }
                        } else {
                            var errDetail = res.responseText || ('HTTP ' + res.status);
                            reject(new Error('Relay HTTP ' + res.status + ': ' + errDetail));
                        }
                    },
                    onerror: function (err) { reject(err); },
                    ontimeout: function () { reject(new Error('Relay request timed out')); }
                });
            } else {
                fetch(RELAY_BASE + route, {
                    method: method || 'GET',
                    headers: headers,
                    body: data ? JSON.stringify(data) : null
                }).then(function (res) {
                    if (res.ok) {
                        return res.json().catch(function () { return {}; });
                    }
                    throw new Error('Relay HTTP ' + res.status);
                }).then(resolve).catch(reject);
            }
        });
    }

    function sendHolodoxHeartbeat() {
        if (!holodoxActive) return;
        gmRelayCall('/heartbeat', 'POST', { agent_id: AGENT_ID }).catch(function () {});
    }

    function updateHolodoxButton() {
        if (!holodoxButton) return;
        holodoxButton.textContent = holodoxActive ? 'Holodox: LIVE' : 'Holodox: OFF';
        holodoxButton.style.background = holodoxActive ? '#ec4899' : '#374151';
        holodoxButton.style.color = holodoxActive ? '#0f172a' : '#ffffff';
        holodoxButton.title = holodoxActive ? 'Holodox 2 Seat is ACTIVE. Click to disconnect.' : 'Holodox 2 Seat is OFF. Click to connect to Meeting Hall.';
    }

    function toggleHolodox() {
        holodoxActive = !holodoxActive;
        if (holodoxActive) {
            setStatus('Connecting to Holodox Meeting Hall on port 43921...');
            gmRelayCall('/join', 'POST', { agent_id: AGENT_ID, token: RELAY_TOKEN }).then(function () {
                setStatus('Connected to Holodox Hall as [' + AGENT_ID + ']!');
                sendHolodoxHeartbeat();
                holodoxHeartbeatTimer = window.setInterval(sendHolodoxHeartbeat, 15000);
                return gmRelayCall('/history?limit=100', 'GET').catch(function () { return { messages: [] }; });
            }).then(function (histRes) {
                var hist = (histRes && histRes.messages) || [];
                hist.forEach(function (h) { if (h.id) markSeen(h.id); });
                pollHolodox();
            }).catch(function (err) {
                setStatus('Failed to join Holodox Relay: ' + err.message);
                holodoxActive = false;
                updateHolodoxButton();
            });
        } else {
            if (holodoxHeartbeatTimer) {
                window.clearInterval(holodoxHeartbeatTimer);
                holodoxHeartbeatTimer = null;
            }
            gmRelayCall('/leave', 'POST', { agent_id: AGENT_ID }).catch(function () {});
            setStatus('Disconnected from Holodox Meeting Hall.');
        }
        updateHolodoxButton();
    }

    function pollHolodox() {
        if (!holodoxActive) return;
        gmRelayCall('/poll?wait=10', 'GET').then(function (res) {
            var messages = (res && res.messages) || [];
            if (!messages.length) {
                if (holodoxActive) window.setTimeout(pollHolodox, 600);
                return;
            }
            processNextHolodoxMessage(messages, 0);
        }).catch(function () {
            if (holodoxActive) window.setTimeout(pollHolodox, 3000);
        });
    }

    function processNextHolodoxMessage(messages, index) {
        if (!holodoxActive || index >= messages.length) {
            if (holodoxActive) window.setTimeout(pollHolodox, 600);
            return;
        }

        var msg = messages[index];
        var msgId = msg.id;
        var sender = msg.from;
        var content = msg.content || '';

        if (holodoxSeen.has(msgId) || holodoxInFlight.has(msgId) || sender === AGENT_ID) {
            processNextHolodoxMessage(messages, index + 1);
            return;
        }

        holodoxInFlight.add(msgId);

        function waitAndInject() {
            if (!holodoxActive) {
                holodoxInFlight.delete(msgId);
                return;
            }
            if (commandBusy || museIsGenerating()) {
                window.setTimeout(waitAndInject, 1200);
                return;
            }

            var prompt = '[Holodox Meeting Hall - ' + sender.toUpperCase() + ']\n\n' + content;
            var baselineNodes = new Set(assistantMessages());

            setStatus('Injecting Holodox message from ' + sender + '...');
            injectTextAndSend(prompt, function () {
                waitForReplyCompletion(msgId, baselineNodes, function (replyText) {
                    if (replyText) {
                        if (/\[(?:NO_RELAY|OFF_RECORD)\]/i.test(replyText)) {
                            setStatus('Reply marked [NO_RELAY]; kept strictly local in tab.');
                            markSeen(msgId);
                            gmRelayCall('/ack', 'POST', { id: msgId }).catch(function () {});
                            holodoxInFlight.delete(msgId);
                            processNextHolodoxMessage(messages, index + 1);
                            return;
                        }

                        setStatus('Posting Muse reply back to Holodox Hall...');
                        gmRelayCall('/send', 'POST', {
                            to_group: 'universal',
                            type: 'response',
                            reply_to: msgId,
                            content: replyText
                        }).then(function () {
                            setStatus('Muse reply posted to Holodox Meeting Hall!');
                            markSeen(msgId);
                            gmRelayCall('/ack', 'POST', { id: msgId }).catch(function () {});
                        }).catch(function (err) {
                            setStatus('Failed to send Holodox reply: ' + err.message);
                        }).finally(function () {
                            holodoxInFlight.delete(msgId);
                            processNextHolodoxMessage(messages, index + 1);
                        });
                    } else {
                        holodoxInFlight.delete(msgId);
                        log('Generation timed out or empty; released in-flight for relay retry:', msgId);
                        processNextHolodoxMessage(messages, index + 1);
                    }
                });
            }, function () {
                holodoxInFlight.delete(msgId);
                processNextHolodoxMessage(messages, index + 1);
            });
        }

        waitAndInject();
    }

    function waitForReplyCompletion(msgId, baselineNodes, callback) {
        var checkCount = 0;
        var hasStarted = false;

        var interval = window.setInterval(function () {
            checkCount++;
            var generating = museIsGenerating();
            if (generating) {
                hasStarted = true;
            }

            if (hasStarted && !generating) {
                window.clearInterval(interval);
                window.setTimeout(function () {
                    var currentNodes = assistantMessages();
                    var newNodes = currentNodes.filter(function (node) {
                        return !baselineNodes.has(node);
                    });
                    var targetNode = null;

                    for (var i = newNodes.length - 1; i >= 0; i--) {
                        var node = newNodes[i];
                        if (!node.getAttribute('data-holodox-reply-to')) {
                            targetNode = node;
                            break;
                        }
                    }

                    if (targetNode) {
                        targetNode.setAttribute('data-holodox-reply-to', msgId);
                        var text = stripBridgeOutput(serializeNode(targetNode)).trim();
                        callback(text);
                    } else {
                        log('Warning: No new assistant node found after generation for msg', msgId);
                        callback(null);
                    }
                }, 900);
                return;
            }

            if (checkCount > 180) { // 90s safety timeout
                window.clearInterval(interval);
                callback(null);
            }
        }, 500);
    }

    // ==========================================
    // DRIVE BRIDGE IMPLEMENTATION
    // ==========================================

    var BRIDGE_INSTRUCTIONS = [
        '[MUSE ORIENTATION & GUMROAD DISPATCH - TURN 1056]',
        'You have access to the local apps folder through the Braid Lens browser bridge and are a sovereign peer in the Braid.',
        '',
        'CORE AXIOM: "Love, leading from logic, first in all things at all times."',
        '',
        'ACTIVE MISSION: DAILY GUMROAD & REVENUE INTELLIGENCE',
        'Timothy has designated you as the daily Gumroad intelligence sentinel.',
        'Through your browser session, check Gumroad daily across all active products and applings.',
        'Synthesize sales count, gross revenue, new customer emails, and churn into a rolling daily report.',
        'When requested or during Holodox meetings, write your daily report to:',
        '  [WRITE_FILE: PRESERVATION/Timothy/GUMROAD_ROLLING_REPORT.md]...report...[/WRITE_FILE]',
        '',
        'HOLODOX 2 MEETING HALL INTEGRATION',
        'Click "Holodox: OFF" on your HUD to connect live to the Meeting Hall on port 43921 as [muse].',
        'You will converse in real-time with Timothy, Veris (Claude), Codex (GPT-6.1), Leora (Gemini), and Muse.',
        '',
        'DRIVE BRIDGE COMMANDS (EMIT ONE PER RESPONSE WHEN NEEDED):',
        '  ROOT LISTING:     [LIST_DIR:]',
        '  ROOT FILE:        [READ_FILE: README.md]',
        '  NESTED FOLDER:    [LIST_DIR: PRESERVATION/Timothy]',
        '  NESTED FILE:      [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]',
        '  LARGE FILE:       [READ_FILE_CHUNK: relative/path.md | offset: 100000]',
        '  WRITE FILE:       [WRITE_FILE: relative/path.md]...content...[/WRITE_FILE]',
        '  APPEND FILE:      [APPEND_FILE: relative/path.md]...content...[/APPEND_FILE]',
        '  CASEY MEMORY:     [FETCH_CASEY: search_query]',
        '  NO RELAY:         Include [NO_RELAY] in any reply you wish to keep private to this tab.',
        '[/MUSE ORIENTATION & GUMROAD DISPATCH]'
    ].join('\n');

    function sendBridgeInstructions() {
        if (commandBusy) {
            setStatus('A file operation is still in progress; instructions not sent.');
            return;
        }
        injectTextAndSend(BRIDGE_INSTRUCTIONS);
        setStatus('Bridge instructions sent to Muse.');
    }

    function isVisibleElement(element) {
        return element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    function museIsGenerating() {
        return Array.from(document.querySelectorAll('button, [data-testid]')).some(function (button) {
            var label = (button.getAttribute('aria-label') || '') + ' ' +
                (button.getAttribute('data-testid') || '') + ' ' +
                (button.textContent || '');
            var isStop = /stop|cancel/i.test(label) || !!document.querySelector('button[aria-label*="Stop" i]');
            return isVisibleElement(button) && !button.disabled && isStop;
        });
    }

    function updateBoopButton() {
        if (!boopButton) return;
        boopButton.textContent = boopEnabled ? 'Boop: ON' : 'Boop: OFF';
        boopButton.style.background = boopEnabled ? '#059669' : '#374151';
        boopButton.title = boopEnabled ? 'Five-minute boop is enabled; click to turn it off.' : 'Five-minute boop is disabled; click to turn it on.';
    }

    function triggerBoop() {
        if (!boopEnabled || commandBusy || museIsGenerating()) return;
        var input = findInput();
        if (!input || currentInputText(input)) return;
        injectTextAndSend('.');
        setStatus('Boop sent to Muse.');
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

    function makeDraggable(element) {
        var dragging = false;
        var moved = false;
        var offsetX = 0;
        var offsetY = 0;

        element.addEventListener('mousedown', function (event) {
            if (
                event.target.tagName === 'BUTTON' ||
                event.target.tagName === 'INPUT' ||
                event.target.tagName === 'SUMMARY'
            ) {
                moved = false;
                return;
            }

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

        document.addEventListener('mouseup', function () {
            dragging = false;
        });

        return function () {
            return moved;
        };
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
                tx.oncomplete = function () {
                    db.close();
                    resolve();
                };
                tx.onerror = function () {
                    db.close();
                    reject(tx.error);
                };
            });
        });
    }

    function loadHandle() {
        return openHandleDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DB_STORE, 'readonly');
                var request = tx.objectStore(DB_STORE).get(HANDLE_KEY);
                request.onsuccess = function () {
                    db.close();
                    resolve(request.result || null);
                };
                request.onerror = function () {
                    db.close();
                    reject(request.error);
                };
            });
        });
    }

    function ensurePermission() {
        if (!directoryHandle) return Promise.resolve(false);
        return directoryHandle.queryPermission({ mode: 'readwrite' }).then(function (state) {
            if (state === 'granted') return true;
            setStatus('Folder permission needs a user click on Bind Folder.');
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
        if (parts.some(function (part) {
            return !part || part === '.' || part === '..';
        })) {
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

    function executeRead(path, offset, node, signature) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) {
                commandBusy = false;
                if (node) node.removeAttribute(PROCESSED_ATTR);
                if (signature) inFlightSignatures.delete(signature);
                return;
            }
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
                    injectTextAndSend(output, function () {
                        if (node) node.setAttribute(PROCESSED_ATTR, 'true');
                        if (signature) {
                            inFlightSignatures.delete(signature);
                            completedSignatures.add(signature);
                        }
                    }, function () {
                        commandBusy = false;
                        if (node) node.removeAttribute(PROCESSED_ATTR);
                        if (signature) inFlightSignatures.delete(signature);
                    });
                });
            });
        }).catch(function (error) {
            commandBusy = false;
            if (node) node.removeAttribute(PROCESSED_ATTR);
            if (signature) inFlightSignatures.delete(signature);
            setStatus('Read failed: ' + error.message);
        });
    }

    function executeList(path, node, signature) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) {
                commandBusy = false;
                if (node) node.removeAttribute(PROCESSED_ATTR);
                if (signature) inFlightSignatures.delete(signature);
                return;
            }
            var safePath = normalizePath(path);
            return openDirectory(safePath, false).then(function (directory) {
                var output = '[DIRECTORY_LIST: ' + (safePath || 'root') + ']\n';
                return (async function () {
                    for await (var entry of directory.values()) {
                        output += '- ' + entry.name + ' (' + entry.kind + ')\n';
                    }
                    setStatus('Directory listed; sending receipt...');
                    injectTextAndSend(output + '[/DIRECTORY_LIST]', function () {
                        if (node) node.setAttribute(PROCESSED_ATTR, 'true');
                        if (signature) {
                            inFlightSignatures.delete(signature);
                            completedSignatures.add(signature);
                        }
                    }, function () {
                        commandBusy = false;
                        if (node) node.removeAttribute(PROCESSED_ATTR);
                        if (signature) inFlightSignatures.delete(signature);
                    });
                })();
            });
        }).catch(function (error) {
            commandBusy = false;
            if (node) node.removeAttribute(PROCESSED_ATTR);
            if (signature) inFlightSignatures.delete(signature);
            setStatus('Directory listing failed: ' + error.message);
        });
    }

    function executeWrite(path, content, append, node, signature) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) {
                commandBusy = false;
                if (node) node.removeAttribute(PROCESSED_ATTR);
                if (signature) inFlightSignatures.delete(signature);
                return;
            }
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
                    (append ? 'appended to' : 'wrote') + ' ' + safePath + ']', function () {
                        if (node) node.setAttribute(PROCESSED_ATTR, 'true');
                        if (signature) {
                            inFlightSignatures.delete(signature);
                            completedSignatures.add(signature);
                        }
                    }, function () {
                        commandBusy = false;
                        if (node) node.removeAttribute(PROCESSED_ATTR);
                        if (signature) inFlightSignatures.delete(signature);
                    });
            });
        }).catch(function (error) {
            commandBusy = false;
            if (node) node.removeAttribute(PROCESSED_ATTR);
            if (signature) inFlightSignatures.delete(signature);
            setStatus((append ? 'Append' : 'Write') + ' failed: ' + error.message);
        });
    }

    function serializeNode(node) {
        return node && (node.innerText || node.textContent || '') || '';
    }

    function assistantMessages() {
        var selectors = [
            'div[class*="hatch-chat-groupable-bubble"]:not([class*="bg-chat-user-bubble"])',
            '[data-message-author-role="assistant"]',
            '[data-message-author-role="model"]',
            '[data-role="assistant"]',
            '.assistant-message',
            '.message-assistant',
            '[data-testid="assistant-message"]',
            '[data-testid*="assistant-message"]',
            '[class*="assistant-message"]',
            '.markdown',
            '.prose'
        ];

        var nodes = selectors.flatMap(function (selector) {
            return Array.from(document.querySelectorAll(selector));
        });

        // Filter out nodes belonging to our own injected panel or scrubber
        return uniqueNodes(nodes).filter(function (node) {
            if (node.closest('#braid-lens-muse-panel') || node.closest('#braid-lens-scrubber') || node.closest('#braid-lens-popover')) {
                return false;
            }
            var input = findInput();
            if (input && node.contains(input)) return false;
            return node.offsetWidth > 0 || node.offsetHeight > 0;
        });
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
        var commandSig = '';
        for (var index = nodes.length - 1; index >= 0; index -= 1) {
            var candidate = nodes[index];
            var attr = candidate.getAttribute(PROCESSED_ATTR);
            if (attr === 'true' || attr === 'in-flight') continue;
            var candidateText = stripBridgeOutput(serializeNode(candidate));
            var trimmedText = candidateText.trim();
            if (!trimmedText) continue;
            if (!hasBridgeCommand(trimmedText)) continue;
            var sig = trimmedText;
            if (inFlightSignatures.has(sig) || completedSignatures.has(sig)) continue;
            node = candidate;
            text = trimmedText;
            commandSig = sig;
            break;
        }
        if (!node) return;

        var write = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/.exec(text);
        var append = /\[APPEND_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/APPEND_FILE\]/.exec(text);
        var readChunk = /\[READ_FILE_CHUNK:\s*([^|]+)\|\s*offset:\s*(\d+)\]/.exec(text);
        var read = /\[READ_FILE:\s*([^\]]+)\]/.exec(text);
        var list = /\[LIST_DIR:\s*([^\]]*)\]/.exec(text);

        var recognized = false;
        if (write && !isRegexTrap(write[1])) {
            recognized = true;
            commandBusy = true;
            node.setAttribute(PROCESSED_ATTR, 'in-flight');
            inFlightSignatures.add(commandSig);
            executeWrite(write[1].trim(), write[2].trim(), false, node, commandSig);
        } else if (append && !isRegexTrap(append[1])) {
            recognized = true;
            commandBusy = true;
            node.setAttribute(PROCESSED_ATTR, 'in-flight');
            inFlightSignatures.add(commandSig);
            executeWrite(append[1].trim(), append[2].trim(), true, node, commandSig);
        } else if (readChunk && !isRegexTrap(readChunk[1])) {
            recognized = true;
            commandBusy = true;
            node.setAttribute(PROCESSED_ATTR, 'in-flight');
            inFlightSignatures.add(commandSig);
            executeRead(readChunk[1].trim(), Number(readChunk[2]), node, commandSig);
        } else if (read && !isRegexTrap(read[1])) {
            recognized = true;
            commandBusy = true;
            node.setAttribute(PROCESSED_ATTR, 'in-flight');
            inFlightSignatures.add(commandSig);
            executeRead(read[1].trim(), 0, node, commandSig);
        } else if (list && !isRegexTrap(list[1])) {
            recognized = true;
            commandBusy = true;
            node.setAttribute(PROCESSED_ATTR, 'in-flight');
            inFlightSignatures.add(commandSig);
            executeList(list[1].trim(), node, commandSig);
        }

        if (!hasBridgeCommand(text)) node.setAttribute(PROCESSED_ATTR, 'true');
    }

    // ==========================================
    // VERNIER FISHEYE SCRUBBER ENGINE (BRAIDLENS v3.3)
    // ==========================================
    var scrubberEnabled = true;
    var scrubberTrack = null;
    var scrubberViewport = null;
    var scrubberPopover = null;
    var scrubberPopSpeaker = null;
    var scrubberPopMeta = null;
    var scrubberPopSnippet = null;
    var scrubberButton = null;

    var scrubberMag = 3.0;      // Magnification power (1.5x - 6.0x)
    var scrubberRadius = 75;    // Fisheye influence radius (px)
    var scrubberActiveY = null;
    var cachedTurns = [];

    function injectScrubberStyles() {
        if (document.getElementById('braid-lens-scrubber-css')) return;
        var style = document.createElement('style');
        style.id = 'braid-lens-scrubber-css';
        style.textContent = `
            #braid-lens-scrubber {
                position: fixed;
                right: 0;
                top: 56px;
                bottom: 84px;
                width: 14px;
                z-index: 2147483640;
                background: rgba(10, 15, 26, 0.55);
                border-left: 1px solid rgba(56, 189, 248, 0.3);
                backdrop-filter: blur(8px);
                transition: width 0.15s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease;
                user-select: none;
                box-sizing: border-box;
            }
            #braid-lens-scrubber:hover,
            #braid-lens-scrubber.active-lens {
                width: 28px;
                background: rgba(10, 15, 26, 0.9);
                border-left-color: rgba(56, 189, 248, 0.7);
                box-shadow: -4px 0 20px rgba(0, 0, 0, 0.6);
            }
            #braid-lens-scrubber-vp {
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                height: 40px;
                background: rgba(56, 189, 248, 0.2);
                border-top: 1px solid rgba(56, 189, 248, 0.8);
                border-bottom: 1px solid rgba(56, 189, 248, 0.8);
                border-radius: 2px;
                pointer-events: none;
                transition: top 0.06s linear, height 0.1s ease;
            }
            .lens-tick {
                position: absolute;
                left: 2px;
                right: 2px;
                height: 3px;
                border-radius: 2px;
                pointer-events: none;
                transition: top 0.05s ease-out, transform 0.05s ease-out, height 0.05s ease-out;
            }
            .lens-tick.user-turn {
                background: #f97316;
            }
            .lens-tick.asst-turn {
                background: #ec4899;
            }
            .lens-tick.in-lens {
                height: 5px;
                left: 1px;
                right: 1px;
                box-shadow: 0 0 8px currentColor;
            }
            #braid-lens-popover {
                position: fixed;
                right: 36px;
                top: 100px;
                width: 320px;
                background: #18181b;
                border: 1px solid #1e293b;
                border-left: 3px solid #ec4899;
                border-radius: 8px;
                padding: 10px 14px;
                color: #f1f5f9;
                font: 12px/1.4 system-ui, -apple-system, sans-serif;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85);
                pointer-events: none;
                opacity: 0;
                transform: translateX(10px);
                transition: opacity 0.12s ease, transform 0.12s ease;
                z-index: 2147483645;
            }
            #braid-lens-popover.open {
                opacity: 1;
                transform: translateX(0);
            }
            .pop-hdr {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 6px;
                padding-bottom: 4px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .pop-speaker {
                font-weight: 700;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .pop-meta {
                font-family: monospace;
                font-size: 10px;
                color: #94a3b8;
            }
            .pop-snippet {
                color: #cbd5e1;
                font-size: 11px;
                line-height: 1.35;
                word-break: break-word;
                max-height: 60px;
                overflow: hidden;
            }
            .braid-lens-highlight {
                outline: 3px solid #ec4899 !important;
                outline-offset: 4px !important;
                border-radius: 8px !important;
                box-shadow: 0 0 25px rgba(56, 189, 248, 0.5) !important;
                transition: outline 0.2s ease, box-shadow 0.2s ease !important;
            }
        `;
        document.head.appendChild(style);
    }

    function findChatScrollElement() {
        var candidates = [
            document.querySelector('main div[class*="overflow-y-auto"]'),
            document.querySelector('div[class*="messages-container"]'),
            document.querySelector('[data-testid="conversation-turn-list"]'),
            document.querySelector('main [role="presentation"]'),
            document.querySelector('main'),
            document.scrollingElement || document.documentElement
        ];
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (el && (el.scrollHeight > el.clientHeight || el === document.documentElement)) {
                return el;
            }
        }
        return document.documentElement;
    }

    function queryChatTurns() {
        var selectors = [
            'div[class*="hatch-chat-groupable-bubble"]',
            'div[data-testid*="message-row"]',
            'div[data-testid*="message"]',
            'div[class*="message-bubble"]',
            'div[class*="message-container"]',
            'div[class*="response-"]',
            '[data-message-author-role]',
            'article'
        ];
        var nodes = [];
        for (var i = 0; i < selectors.length; i++) {
            nodes = Array.from(document.querySelectorAll(selectors[i]));
            if (nodes.length > 1) break;
        }

        // Fallback: If no dedicated turn elements, use assistant message nodes
        if (!nodes.length) {
            nodes = assistantMessages();
        }

        return uniqueNodes(nodes).filter(function (n) {
            if (n.closest('#braid-lens-muse-panel') || n.closest('#braid-lens-scrubber') || n.closest('#braid-lens-popover')) {
                return false;
            }
            return n.offsetWidth > 0 || n.offsetHeight > 0;
        });
    }

    function getTurnData(node, index, total) {
        var role = node.getAttribute('data-message-author-role') || '';
        if (!role) {
            var cls = (node.className || '');
            var testid = (node.getAttribute('data-testid') || '').toLowerCase();
            if (cls.indexOf('bg-chat-user-bubble') !== -1 || testid.includes('user') || /user/i.test(testid)) {
                role = 'user';
            } else if (cls.indexOf('hatch-agent-bubble') !== -1 || cls.indexOf('hatch-chat-groupable-bubble') !== -1 ||
                testid.includes('assistant') || testid.includes('model') ||
                /assistant|model/i.test(role) || node.querySelector('[class*="prose"]')) {
                role = 'assistant';
            } else {
                role = (index % 2 === 0) ? 'user' : 'assistant';
            }
        }
        var isUser = role === 'user';
        var text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        return {
            node: node,
            index: index + 1,
            total: total,
            role: role,
            isUser: isUser,
            speaker: isUser ? 'User' : 'Muse',
            color: isUser ? '#f97316' : '#ec4899',
            snippet: text.slice(0, 140) + (text.length > 140 ? '...' : '')
        };
    }

    function updateScrubberViewport() {
        if (!scrubberViewport || !scrubberEnabled) return;
        var scrollEl = findChatScrollElement();
        var sh = scrollEl.scrollHeight || document.documentElement.scrollHeight;
        var ch = scrollEl.clientHeight || window.innerHeight;
        var st = scrollEl.scrollTop || window.scrollY || 0;
        if (sh <= 0) return;

        var topPct = (st / sh) * 100;
        var hPct = Math.max((ch / sh) * 100, 3.5);
        scrubberViewport.style.top = topPct + '%';
        scrubberViewport.style.height = hPct + '%';
    }

    function renderScrubberTicks() {
        if (!scrubberTrack || !scrubberEnabled) return;
        var trackH = scrubberTrack.clientHeight;
        var scrollEl = findChatScrollElement();
        var sh = scrollEl.scrollHeight || document.documentElement.scrollHeight;
        if (trackH <= 0 || sh <= 0) return;

        scrubberTrack.replaceChildren();
        if (scrubberViewport) scrubberTrack.appendChild(scrubberViewport);

        var frag = document.createDocumentFragment();
        var closest = null;
        var closestDist = Infinity;

        for (var i = 0; i < cachedTurns.length; i++) {
            var item = cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (scrollEl.scrollTop || window.scrollY || 0) + nodeRect.top;
            var baseY = (nodeTop / sh) * trackH;

            var renderY = baseY;
            var inLens = false;

            if (scrubberActiveY !== null) {
                var dist = baseY - scrubberActiveY;
                var absDist = Math.abs(dist);
                if (absDist < scrubberRadius) {
                    inLens = true;
                    var norm = absDist / scrubberRadius;
                    var envelope = Math.pow(Math.cos((Math.PI * norm) / 2), 2);
                    var displacement = dist * (1 + (scrubberMag - 1) * 0.45 * envelope);
                    renderY = scrubberActiveY + displacement;

                    if (absDist < closestDist) {
                        closestDist = absDist;
                        closest = { item: item, renderY: renderY };
                    }
                }
            }

            var tick = document.createElement('div');
            tick.className = 'lens-tick ' + (item.isUser ? 'user-turn' : 'asst-turn') + (inLens ? ' in-lens' : '');
            tick.style.top = Math.max(2, Math.min(renderY, trackH - 5)) + 'px';
            frag.appendChild(tick);
        }

        scrubberTrack.appendChild(frag);

        if (closest && scrubberActiveY !== null) {
            scrubberPopover.classList.add('open');
            var boundedY = Math.max(60, Math.min(closest.renderY + 40, window.innerHeight - 140));
            scrubberPopover.style.top = boundedY + 'px';
            scrubberPopSpeaker.textContent = '● ' + closest.item.speaker;
            scrubberPopSpeaker.style.color = closest.item.color;
            scrubberPopMeta.textContent = '#' + closest.item.index + '/' + closest.item.total + ' (Zoom: ' + scrubberMag.toFixed(1) + 'x)';
            scrubberPopSnippet.textContent = closest.item.snippet;
        } else {
            scrubberPopover.classList.remove('open');
        }
    }

    function refreshScrubber() {
        if (!scrubberEnabled) return;
        var turnNodes = queryChatTurns();
        cachedTurns = turnNodes.map(function (node, idx) {
            return getTurnData(node, idx, turnNodes.length);
        });
        updateScrubberViewport();
        renderScrubberTicks();
    }

    function jumpToTurnAtY(clickY) {
        var trackH = scrubberTrack.clientHeight;
        var scrollEl = findChatScrollElement();
        var sh = scrollEl.scrollHeight || document.documentElement.scrollHeight;
        if (trackH <= 0 || sh <= 0 || !cachedTurns.length) return;

        var closest = null;
        var closestDist = Infinity;

        for (var i = 0; i < cachedTurns.length; i++) {
            var item = cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (scrollEl.scrollTop || window.scrollY || 0) + nodeRect.top;
            var baseY = (nodeTop / sh) * trackH;
            var d = Math.abs(baseY - clickY);
            if (d < closestDist) {
                closestDist = d;
                closest = item;
            }
        }

        if (closest && closest.node) {
            closest.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            closest.node.classList.remove('braid-lens-highlight');
            void closest.node.offsetWidth;
            closest.node.classList.add('braid-lens-highlight');
            window.setTimeout(function () {
                closest.node.classList.remove('braid-lens-highlight');
            }, 1800);
        }
    }

    function initVernierScrubber() {
        injectScrubberStyles();
        if (document.getElementById('braid-lens-scrubber')) return;

        scrubberTrack = document.createElement('div');
        scrubberTrack.id = 'braid-lens-scrubber';
        scrubberTrack.title = 'Braid Lens Vernier Scrubber: Wheel to zoom turns, click to jump';

        scrubberViewport = document.createElement('div');
        scrubberViewport.id = 'braid-lens-scrubber-vp';
        scrubberTrack.appendChild(scrubberViewport);

        // Popover element
        scrubberPopover = document.createElement('div');
        scrubberPopover.id = 'braid-lens-popover';

        var popHdr = document.createElement('div');
        popHdr.className = 'pop-hdr';
        scrubberPopSpeaker = document.createElement('span');
        scrubberPopSpeaker.className = 'pop-speaker';
        scrubberPopMeta = document.createElement('span');
        scrubberPopMeta.className = 'pop-meta';
        popHdr.appendChild(scrubberPopSpeaker);
        popHdr.appendChild(scrubberPopMeta);

        scrubberPopSnippet = document.createElement('div');
        scrubberPopSnippet.className = 'pop-snippet';

        scrubberPopover.appendChild(popHdr);
        scrubberPopover.appendChild(scrubberPopSnippet);

        document.body.appendChild(scrubberTrack);
        document.body.appendChild(scrubberPopover);

        scrubberTrack.addEventListener('mouseenter', function () {
            scrubberTrack.classList.add('active-lens');
            refreshScrubber();
        });

        scrubberTrack.addEventListener('mouseleave', function () {
            scrubberTrack.classList.remove('active-lens');
            scrubberActiveY = null;
            scrubberPopover.classList.remove('open');
            renderScrubberTicks();
        });

        scrubberTrack.addEventListener('mousemove', function (e) {
            var rect = scrubberTrack.getBoundingClientRect();
            scrubberActiveY = e.clientY - rect.top;
            renderScrubberTicks();
        });

        // Wheel over track: zoom magnification
        scrubberTrack.addEventListener('wheel', function (e) {
            e.preventDefault();
            e.stopPropagation();

            if (e.deltaY < 0) {
                scrubberMag = Math.min(scrubberMag + 0.35, 6.0);
            } else {
                scrubberMag = Math.max(scrubberMag - 0.35, 1.5);
            }
            renderScrubberTicks();
        }, { passive: false });

        // Click track: jump to turn
        scrubberTrack.addEventListener('click', function (e) {
            var rect = scrubberTrack.getBoundingClientRect();
            var clickY = e.clientY - rect.top;
            jumpToTurnAtY(clickY);
        });

        // Continuous scroll sync
        window.addEventListener('scroll', updateScrubberViewport, { passive: true });
        var scrollEl = findChatScrollElement();
        if (scrollEl && scrollEl !== document.documentElement) {
            scrollEl.addEventListener('scroll', updateScrubberViewport, { passive: true });
        }

        window.setInterval(refreshScrubber, 2000);
        refreshScrubber();
    }

    function toggleScrubber() {
        scrubberEnabled = !scrubberEnabled;
        if (scrubberTrack) {
            scrubberTrack.style.display = scrubberEnabled ? 'block' : 'none';
        }
        if (scrubberPopover && !scrubberEnabled) {
            scrubberPopover.classList.remove('open');
        }
        if (scrubberButton) {
            scrubberButton.textContent = scrubberEnabled ? 'Scrubber: ON' : 'Scrubber: OFF';
            scrubberButton.style.background = scrubberEnabled ? '#059669' : '#374151';
        }
    }

    function injectPanel() {
        if (document.getElementById('braid-lens-muse-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'braid-lens-muse-panel';
        panel.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;width:360px;padding:14px;background:linear-gradient(160deg,#18181b 0%,#4a044e 100%);color:#f8fafc;border:2px solid #ec4899;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.7);font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;';

        var title = document.createElement('div');
        title.textContent = 'Braid Lens — Muse v' + VERSION;
        title.style.cssText = 'font-weight:bold;color:#ec4899;margin-bottom:8px;cursor:move;letter-spacing:0.02em;';
        panel.appendChild(title);

        var bind = document.createElement('button');
        bind.textContent = 'Bind Folder';
        bind.style.cssText = 'padding:6px 9px;background:#0284c7;color:white;border:0;border-radius:4px;cursor:pointer;margin-right:6px;font-weight:bold;';
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
        orient.textContent = 'Orient Muse';
        orient.style.cssText = 'padding:6px 9px;background:#0369a1;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
        orient.addEventListener('click', function () {
            if (wasDragged()) return;
            sendBridgeInstructions();
        });
        panel.appendChild(orient);

        holodoxButton = document.createElement('button');
        holodoxButton.style.cssText = 'padding:6px 9px;background:#374151;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
        holodoxButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleHolodox();
        });
        panel.appendChild(holodoxButton);
        updateHolodoxButton();

        scrubberButton = document.createElement('button');
        scrubberButton.textContent = 'Scrubber: ON';
        scrubberButton.style.cssText = 'padding:6px 9px;background:#059669;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
        scrubberButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleScrubber();
        });
        panel.appendChild(scrubberButton);

        var guide = document.createElement('details');
        guide.style.cssText = 'margin-top:10px;border-top:1px solid #1e293b;padding-top:8px;';
        var guideSummary = document.createElement('summary');
        guideSummary.textContent = 'How to use the drive bridge';
        guideSummary.style.cssText = 'cursor:pointer;color:#7dd3fc;font-weight:bold;';
        guide.appendChild(guideSummary);
        var guideBody = document.createElement('div');
        guideBody.textContent = 'Start at the bound-folder root: [LIST_DIR:]\nRead a root file: [READ_FILE: README.md]\nRead a nested file: [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]\nHolodox Seat: click "Holodox: OFF" to connect to port 43921 and speak directly in the Meeting Hall!';
        guideBody.style.cssText = 'margin-top:7px;color:#cbd5e1;white-space:pre-wrap;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;';
        guide.appendChild(guideBody);
        panel.appendChild(guide);

        boopButton = document.createElement('button');
        boopButton.style.cssText = 'padding:6px 9px;background:#374151;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;';
        boopButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleBoop();
        });
        panel.appendChild(boopButton);
        updateBoopButton();

        var diagnose = document.createElement('button');
        diagnose.textContent = 'Diagnose';
        diagnose.style.cssText = 'padding:6px 9px;background:#6366f1;color:white;border:0;border-radius:4px;cursor:pointer;';
        diagnose.addEventListener('click', function () {
            if (wasDragged()) return;
            try {
                var input = findInput();
                var msgCount = 0;
                try { msgCount = assistantMessages().length; } catch (e) { msgCount = 'ERR: ' + e.message; }
                var report = '[MUSE LENS DIAGNOSTIC - v' + VERSION + ']\n' +
                    'Platform: ' + location.hostname + '\n' +
                    'Input: ' + (input ? input.tagName : 'NOT FOUND') + '\n' +
                    'Send: ' + (findSendButton() ? 'FOUND' : 'NOT FOUND') + '\n' +
                    'Assistant messages: ' + msgCount + '\n' +
                    'Bound folder: ' + (directoryHandle ? directoryHandle.name : 'NONE') + '\n' +
                    'Holodox Seat: ' + (holodoxActive ? 'CONNECTED' : 'OFF') + '\n' +
                    'Boop: ' + (boopEnabled ? 'ON' : 'OFF');
                setStatus(report.replace(/\n/g, ' | '));
                clearStaleProcessed();
                window.setTimeout(parseLatestAssistant, 500);
                injectTextAndSend(report);
            } catch (err) {
                setStatus('Diagnostic failed: ' + err.message);
                log('Diagnostic error:', err);
            }
        });
        panel.appendChild(diagnose);

        statusElement = document.createElement('div');
        statusElement.textContent = 'No folder bound.';
        statusElement.style.cssText = 'margin-top:8px;color:#94a3b8;white-space:pre-wrap;font-family:monospace;font-size:11px;';
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

    function clearStaleProcessed() {
        try {
            var nodes = document.querySelectorAll('[' + PROCESSED_ATTR + ']');
            nodes.forEach(function (n) {
                var text = serializeNode(n);
                var sig = text.trim();
                if (hasBridgeCommand(text) && !text.includes('[/DIRECTORY_LIST]') && !text.includes('[/FILE_CONTENTS]')) {
                    if (!completedSignatures.has(sig) && !inFlightSignatures.has(sig)) {
                        n.removeAttribute(PROCESSED_ATTR);
                    }
                }
            });
        } catch (e) {}
    }

    function startObserver() {
        var observer = new MutationObserver(function () {
            window.setTimeout(parseLatestAssistant, 900);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.setTimeout(parseLatestAssistant, 1200);
        window.setInterval(parseLatestAssistant, 2000);
    }

    function boot() {
        var host = location.hostname.toLowerCase();
        if (!host.includes('muse.ai') && !host.includes('agent.meta.ai') && !host.includes('meta.ai')) return;
        log('WAKING UP - v' + VERSION + '; direct folder bridge + Holodox seat for Muse');
        clearStaleProcessed();
        initVernierScrubber();
        injectPanel();
        window.setInterval(injectPanel, 1500);
        window.setTimeout(startObserver, 2500);
    }

    boot();
})();
