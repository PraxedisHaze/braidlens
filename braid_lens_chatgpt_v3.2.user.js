// ==UserScript==
// @name         The Braid Lens (ChatGPT Bridge & Holodox Seat - v3.2.0)
// @namespace    http://tampermonkey.net/
// @version      3.2.0
// @description  Braid Lens drive bridge + native Holodox Meeting Hall seat for ChatGPT. Long-polls relay port 43921 and auto-replies to room dispatches.
// @author       Timothy, ChatGPT & Leora
// @match        *://*.chatgpt.com/*
// @match        *://*.openai.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==


(function () {
    'use strict';

    var VERSION = '3.2.0';
    var CHUNK_LIMIT = 100000;
    var DB_NAME = 'braid-lens-chatgpt';
    var DB_STORE = 'handles';
    var HANDLE_KEY = 'bound-directory';
    var PROCESSED_ATTR = 'data-braid-lens-processed';

    // Holodox Relay Configuration
    var RELAY_BASE = 'http://127.0.0.1:43921';
    var holodoxActive = false;
    var holodoxButton = null;
    var holodoxHeartbeatTimer = null;
    var holodoxInFlight = new Set();
    var SEEN_STORAGE_KEY = 'braid_lens_chatgpt_seen_v3';
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
        args.unshift('[ChatGPT Lens]');
        console.log.apply(console, args);
    }

    function uniqueNodes(nodes) {
        return Array.from(new Set(nodes));
    }

    function findInput() {
        return document.getElementById('prompt-textarea') ||
            document.querySelector('div[contenteditable="true"][role="textbox"]') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('textarea[placeholder*="message" i]') ||
            document.querySelector('textarea') ||
            document.querySelector('[role="textbox"]');
    }

    function findSendButton() {
        var candidates = [
            document.querySelector('button[data-testid="send-button"]'),
            document.querySelector('button[data-testid="composer-send-button"]'),
            document.querySelector('button[aria-label="Send prompt"]'),
            document.querySelector('button[aria-label="Send message"]'),
            document.querySelector('button[aria-label*="send" i]'),
            document.querySelector('button[data-testid*="send" i]'),
            document.querySelector('button[type="submit"]')
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
            setStatus('Input element not found in DOM.');
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
                setStatus('Message sent to ChatGPT.');
                window.setTimeout(function () { commandBusy = false; }, 1200);
                if (onSuccess) onSuccess();
                return;
            }

            if (Date.now() >= deadline) {
                commandBusy = false;
                setStatus('Text inserted, but ChatGPT send button was not ready. Press Enter or Send.');
                if (onFailure) onFailure();
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
            GM_xmlhttpRequest({
                method: method || 'GET',
                url: RELAY_BASE + route,
                headers: {
                    'X-Agent-ID': 'chatgpt',
                    'Content-Type': 'application/json'
                },
                data: data ? JSON.stringify(data) : null,
                timeout: 25000,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            var json = JSON.parse(res.responseText || '{}');
                            resolve(json);
                        } catch (e) {
                            reject(new Error('Parse error: ' + e.message));
                        }
                    } else {
                        var errDetail = res.responseText || ('HTTP ' + res.status);
                        reject(new Error('Relay HTTP ' + res.status + ': ' + errDetail));
                    }
                },
                onerror: function (err) { reject(err); },
                ontimeout: function () { reject(new Error('Relay request timed out')); }
            });
        });
    }

    function sendHolodoxHeartbeat() {
        if (!holodoxActive) return;
        gmRelayCall('/heartbeat', 'POST', {}).catch(function () {});
    }

    function updateHolodoxButton() {
        if (!holodoxButton) return;
        holodoxButton.textContent = holodoxActive ? 'Holodox: LIVE' : 'Holodox: OFF';
        holodoxButton.style.background = holodoxActive ? '#10a37f' : '#374151';
        holodoxButton.title = holodoxActive ? 'Holodox 2 Seat is ACTIVE. Click to disconnect.' : 'Holodox 2 Seat is OFF. Click to connect to Meeting Hall.';
    }

    function toggleHolodox() {
        holodoxActive = !holodoxActive;
        if (holodoxActive) {
            setStatus('Connecting to Holodox Meeting Hall on port 43921...');
            gmRelayCall('/join', 'POST', { agent_id: 'chatgpt' }).then(function () {
                setStatus('Connected to Holodox Hall as [chatgpt]!');
                sendHolodoxHeartbeat();
                holodoxHeartbeatTimer = window.setInterval(sendHolodoxHeartbeat, 15000);
                // Mark existing historical room backlog as seen so we never send old messages to ChatGPT
                return gmRelayCall('/history?limit=100', 'GET').catch(function () { return { messages: [] }; });
            }).then(function (histRes) {
                var hist = (histRes && histRes.messages) || [];
                hist.forEach(function (h) { if (h.id) markSeen(h.id); });
                pollHolodox();
            }).catch(function (err) {
                setStatus('Failed to join Holodox Relay: ' + err.message);
                holodoxActive = false;
            });
        } else {
            if (holodoxHeartbeatTimer) {
                window.clearInterval(holodoxHeartbeatTimer);
                holodoxHeartbeatTimer = null;
            }
            gmRelayCall('/leave', 'POST', {}).catch(function () {});
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
        }).catch(function (err) {
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

        if (holodoxSeen.has(msgId) || holodoxInFlight.has(msgId) || sender === 'chatgpt') {
            processNextHolodoxMessage(messages, index + 1);
            return;
        }

        holodoxInFlight.add(msgId);

        function waitAndInject() {
            if (!holodoxActive) {
                holodoxInFlight.delete(msgId);
                return;
            }
            if (commandBusy || chatgptIsGenerating()) {
                window.setTimeout(waitAndInject, 1200);
                return;
            }

            // Delta-only: exactly the single new message that arrived, zero old transcript dumps
            var prompt = '[Holodox Meeting Hall - ' + sender.toUpperCase() + ']\n\n' + content;

            // Snapshot baseline DOM nodes by object reference identity
            var baselineNodes = new Set(assistantMessages());

            setStatus('Injecting Holodox message from ' + sender + '...');
            injectTextAndSend(prompt, function () {
                // Injection confirmed by send-button click
                waitForReplyCompletion(msgId, baselineNodes, function (replyText) {
                    if (replyText) {
                        // Explicit sovereign privacy guard: do not relay if tagged [NO_RELAY] or [OFF_RECORD]
                        if (/\[(?:NO_RELAY|OFF_RECORD)\]/i.test(replyText)) {
                            setStatus('Reply marked [NO_RELAY]; kept strictly local in tab.');
                            markSeen(msgId);
                            gmRelayCall('/ack', 'POST', { id: msgId }).catch(function () {});
                            holodoxInFlight.delete(msgId);
                            processNextHolodoxMessage(messages, index + 1);
                            return;
                        }

                        setStatus('Posting ChatGPT reply back to Holodox Hall...');
                        gmRelayCall('/send', 'POST', {
                            to_group: 'universal',
                            type: 'response',
                            reply_to: msgId,
                            content: replyText
                        }).then(function () {
                            setStatus('ChatGPT reply posted to Holodox Meeting Hall!');
                            // Permanent ACK & markSeen ONLY after verified delivery
                            markSeen(msgId);
                            gmRelayCall('/ack', 'POST', { id: msgId }).catch(function () {});
                        }).catch(function (err) {
                            setStatus('Failed to send Holodox reply: ' + err.message);
                        }).finally(function () {
                            holodoxInFlight.delete(msgId);
                            processNextHolodoxMessage(messages, index + 1);
                        });
                    } else {
                        // Generation timed out or empty; release in-flight so relay lease will retry
                        holodoxInFlight.delete(msgId);
                        log('Generation timed out or empty; released in-flight for relay retry:', msgId);
                        processNextHolodoxMessage(messages, index + 1);
                    }
                });
            }, function () {
                // Injection failed (e.g. DOM blocked) -> release in-flight so relay can retry later
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
            var generating = chatgptIsGenerating();
            if (generating) {
                hasStarted = true;
            }

            if (hasStarted && !generating) {
                window.clearInterval(interval);
                window.setTimeout(function () {
                    var currentNodes = assistantMessages();
                    // Attribute verification: Must be a newly rendered node created after injection
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
        '[CHATGPT BRIDGE INSTRUCTIONS]',
        'You have access to a user-selected local folder through the Braid Lens browser bridge.',
        'When you need a file operation, emit exactly one command tag in your assistant response; the user does not need to type the tag.',
        'All paths are relative to the bound folder. Never use an absolute path or .. traversal.',
        'ROOT EXAMPLE: [LIST_DIR:] lists the bound-folder root. The empty path is intentional.',
        'ROOT FILE EXAMPLE: [READ_FILE: README.md]',
        'NESTED FOLDER EXAMPLE: [LIST_DIR: PRESERVATION/Timothy]',
        'NESTED FILE EXAMPLE: [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]',
        'LARGE FILE EXAMPLE: [READ_FILE_CHUNK: relative/path.md | offset: 100000]',
        'WRITE EXAMPLE: [WRITE_FILE: applings/BraidLens/examples/chatgpt-bridge-test.md]Hello from ChatGPT.[/WRITE_FILE]',
        'APPEND EXAMPLE: [APPEND_FILE: applings/BraidLens/examples/chatgpt-bridge-test.md]Second line.[/APPEND_FILE]',
        'The single period "." is only the optional five-minute boop. It is not a root-folder command and it is not a path.',
        'Do not use [LIST_DIR: .] for the root; use [LIST_DIR:] exactly.',
        'Put one command tag on its own line. Do not claim success until the bridge returns a FILE_CONTENTS, DIRECTORY_LIST, WRITE_RESULT, or SYSTEM_NOTICE receipt.',
        'This adapter does not provide Casey sync. Its optional five-minute boop is controlled by Timothy and is OFF by default.',
        '[/CHATGPT BRIDGE INSTRUCTIONS]'
    ].join('\n');

    function sendBridgeInstructions() {
        if (commandBusy) {
            setStatus('A file operation is still in progress; instructions not sent.');
            return;
        }
        injectTextAndSend(BRIDGE_INSTRUCTIONS);
        setStatus('Bridge instructions sent to ChatGPT.');
    }

    function isVisibleElement(element) {
        return element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    function chatgptIsGenerating() {
        return Array.from(document.querySelectorAll('button, [data-testid]')).some(function (button) {
            var label = (button.getAttribute('aria-label') || '') + ' ' +
                (button.getAttribute('data-testid') || '') + ' ' +
                (button.textContent || '');
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
        if (!boopEnabled || commandBusy || chatgptIsGenerating()) return;
        var input = findInput();
        if (!input || currentInputText(input)) return;
        injectTextAndSend('.');
        setStatus('Boop sent to ChatGPT.');
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

    function executeRead(path, offset) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) {
                commandBusy = false;
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
            if (!allowed) {
                commandBusy = false;
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
            if (!allowed) {
                commandBusy = false;
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
            '[data-message-author-role="assistant"]',
            '[class*="MarkdownRoot-"]'
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
            if (!hasBridgeCommand(candidateText)) continue;
            node = candidate;
            text = candidateText;
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

        if (recognized || !hasBridgeCommand(text)) node.setAttribute(PROCESSED_ATTR, 'true');
    }

    function injectPanel() {
        if (document.getElementById('braid-lens-chatgpt-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'braid-lens-chatgpt-panel';
        panel.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;width:360px;padding:14px;background:linear-gradient(160deg,#18181b 0%,#27272a 100%);color:#f9fafb;border:2px solid #22d3ee;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;';

        var title = document.createElement('div');
        title.textContent = 'Braid Lens - ChatGPT v' + VERSION;
        title.style.cssText = 'font-weight:bold;color:#67e8f9;margin-bottom:8px;cursor:move;';
        panel.appendChild(title);

        var bind = document.createElement('button');
        bind.textContent = 'Bind Folder';
        bind.style.cssText = 'padding:6px 9px;background:#0891b2;color:white;border:0;border-radius:4px;cursor:pointer;margin-right:6px;font-weight:bold;';
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
        orient.textContent = 'Orient ChatGPT';
        orient.style.cssText = 'padding:6px 9px;background:#0ea5e9;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;font-weight:bold;';
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

        var guide = document.createElement('details');
        guide.style.cssText = 'margin-top:10px;border-top:1px solid #3f3f46;padding-top:8px;';
        var guideSummary = document.createElement('summary');
        guideSummary.textContent = 'How to use the drive bridge';
        guideSummary.style.cssText = 'cursor:pointer;color:#a5f3fc;font-weight:bold;';
        guide.appendChild(guideSummary);
        var guideBody = document.createElement('div');
        guideBody.textContent = 'Start at the bound-folder root: [LIST_DIR:]\nRead a root file: [READ_FILE: README.md]\nRead a nested file: [READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]\nHolodox Seat: click "Holodox: OFF" to connect to port 43921 and speak directly in the Meeting Hall!';
        guideBody.style.cssText = 'margin-top:7px;color:#d4d4d8;white-space:pre-wrap;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;';
        guide.appendChild(guideBody);
        panel.appendChild(guide);

        boopButton = document.createElement('button');
        boopButton.style.cssText = 'padding:6px 9px;background:#3f3f46;color:white;border:0;border-radius:4px;cursor:pointer;margin:6px 6px 0 0;';
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
            var input = findInput();
            var report = '[CHATGPT LENS DIAGNOSTIC - v' + VERSION + ']\n' +
                'Platform: ' + location.hostname + '\n' +
                'Input: ' + (input ? input.tagName : 'NOT FOUND') + '\n' +
                'Send: ' + (findSendButton() ? 'FOUND' : 'NOT FOUND') + '\n' +
                'Assistant messages: ' + assistantMessages().length + '\n' +
                'Bound folder: ' + (directoryHandle ? directoryHandle.name : 'NONE') + '\n' +
                'Holodox Seat: ' + (holodoxActive ? 'CONNECTED' : 'OFF') + '\n' +
                'Boop: ' + (boopEnabled ? 'ON' : 'OFF');
            setStatus(report.replace(/\n/g, ' | '));
            injectTextAndSend(report);
        });
        panel.appendChild(diagnose);

        statusElement = document.createElement('div');
        statusElement.textContent = 'No folder bound.';
        statusElement.style.cssText = 'margin-top:8px;color:#d4d4d8;white-space:pre-wrap;font-family:monospace;font-size:11px;';
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
        if (!location.hostname.includes('chatgpt.com') && !location.hostname.includes('openai.com')) return;
        log('WAKING UP - v' + VERSION + '; direct folder bridge + Holodox seat');
        window.setInterval(injectPanel, 1500);
        window.setTimeout(startObserver, 2500);
    }

    boot();
})();
