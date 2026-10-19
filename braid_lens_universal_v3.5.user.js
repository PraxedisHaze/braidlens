// ==UserScript==
// @name         The Universal Braid Lens (Unified Bridge, Holodox Seat & Vernier Scrubber - v3.5.2)
// @namespace    braid.lens
// @version      3.5.2
// @description  Universal Braid Lens: Drive bridge, native Holodox 2 Meeting Hall seat, Vernier Fisheye Scrubber, and Casey memory bridge for ChatGPT, Claude, Gemini, Penni (NotebookLM), Grok, Duck.ai, Perplexity, DeepSeek, and Muse.
// @author       Timothy, Leora, Claude, Grok, ChatGPT & Codex
// @match        *://*.chatgpt.com/*
// @match        *://*.openai.com/*
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @match        *://gemini.google.com/*
// @match        *://notebook.google.com/*
// @match        *://notebooklm.google.com/*
// @match        *://grok.com/*
// @match        *://*.grok.com/*
// @match        *://x.ai/*
// @match        *://*.x.ai/*
// @match        *://x.com/i/grok*
// @match        *://*.x.com/i/grok*
// @match        *://twitter.com/i/grok*
// @match        *://*.twitter.com/i/grok*
// @match        *://duck.ai/*
// @match        *://duckduckgo.com/?q=DuckDuckGo+AI+Chat*
// @match        *://duckduckgo.com/chat*
// @match        *://*.perplexity.ai/*
// @match        *://chat.deepseek.com/*
// @match        *://meta.ai/*
// @match        *://*.meta.ai/*
// @match        *://agent.meta.ai/*
// @match        *://muse.ai/*
// @match        *://*.muse.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    var VERSION = '3.5.1';
    var CHUNK_LIMIT = 100000;
    var DB_NAME = 'braid-lens-universal';
    var DB_STORE = 'handles';
    var HANDLE_KEY = 'bound-directory';
    var PROCESSED_ATTR = 'data-braid-lens-processed';
    var inFlightSignatures = new Set();
    var completedSignatures = new Set();

    var RELAY_BASE = 'http://127.0.0.1:43921';
    var LENNY_BASE = 'http://127.0.0.1:3333';

    // ==========================================
    // PLATFORM ADAPTER REGISTRY & DETECTION
    // ==========================================

    function hasMatchingButton(regex) {
        return Array.from(document.querySelectorAll('button, [role="button"], [data-testid]')).some(function (btn) {
            var label = (btn.getAttribute('aria-label') || '') + ' ' +
                (btn.getAttribute('data-testid') || '') + ' ' +
                (btn.textContent || '');
            return isVisible(btn) && !btn.disabled && regex.test(label);
        });
    }

    var PLATFORMS = {
        chatgpt: {
            id: 'chatgpt',
            name: 'ChatGPT',
            agentId: 'chatgpt',
            token: 'ChatGPT7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#10a37f',
            bgGradient: 'linear-gradient(160deg,#18181b 0%,#1f2937 100%)',
            match: function (h) { return h.includes('chatgpt.com') || h.includes('openai.com'); },
            inputs: [
                'div.ProseMirror',
                '.ProseMirror',
                '#prompt-textarea',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[placeholder*="message" i]',
                'textarea'
            ],
            sends: [
                'button.size-token-button-composer.bg-composer-primary',
                'button.bg-composer-primary',
                'button[data-testid="send-button"]',
                'button[data-testid="composer-send-button"]',
                'button[aria-label="Send prompt"]',
                'button[aria-label="Send message"]',
                'button[aria-label*="Send" i]',
                'button[type="submit"]'
            ],
            assistants: [
                '[data-message-author-role="assistant"]',
                '[class*="MarkdownRoot-"]'
            ],
            isGenerating: function () { return hasMatchingButton(/stop/i); }
        },
        claude: {
            id: 'claude',
            name: 'Claude',
            agentId: 'veris',
            token: 'Veris7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#d97706',
            bgGradient: 'linear-gradient(160deg,#1c1917 0%,#292524 100%)',
            match: function (h) { return h.includes('claude.ai'); },
            inputs: [
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea[placeholder*="reply" i]',
                'textarea[placeholder*="message" i]',
                'textarea'
            ],
            sends: [
                'button[data-testid="chat-input-send"]',
                'button[aria-label="Send message"]',
                'button[aria-label*="send" i]',
                'button[data-testid*="send" i]',
                'button[type="submit"]'
            ],
            assistants: [
                '[data-testid="assistant-message"]',
                '[data-testid="assistant-response"]',
                '[data-role="assistant"]',
                '.font-claude-response',
                '[class*="assistant-message"]'
            ],
            isGenerating: function () { return hasMatchingButton(/stop/i); }
        },
        penni: {
            id: 'penni',
            strictDom: true,
            name: 'Penni (NotebookLM)',
            agentId: 'penni',
            token: 'Penni7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#c084fc',
            bgGradient: 'linear-gradient(160deg,#18181b 0%,#3b0764 100%)',
            match: function (h, p) {
                return h === 'notebook.google.com' || h === 'notebooklm.google.com' ||
                       h.endsWith('.notebook.google.com') || h.endsWith('.notebooklm.google.com');
            },
            inputs: [
                'textarea.query-box-input',
                'textarea[aria-label="Query box"]',
                'textarea[placeholder="Ask a question or create something"]',
                'textarea[placeholder="Start typing..."]',
                '.query-input textarea'
            ],
            sends: [
                'button[aria-label*="Submit" i]',
                'button[aria-label*="Send" i]',
                'button[aria-label*="Query" i]',
                'button[aria-label*="Ask" i]',
                'button.submit-button',
                'button.send-button',
                'button[type="submit"]',
                'query-input button',
                'rich-textarea button',
                '.query-input button',
                'div[class*="query"] button',
                'div[class*="input"] button'
            ],
            assistants: [
                '[role="log"] .to-user-container',
                '.chat-panel-content .to-user-container',
                '.to-user-container',
                '.source-grounded-response',
                '.response-container-content'
            ],
            isGenerating: function () {
                var chat = document.querySelector('chat-panel') || document.querySelector('[role="log"]') || document.querySelector('.chat-panel-content');
                if (!chat) return false;
                return Array.from(chat.querySelectorAll('button')).some(function (btn) {
                    var label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.textContent || '');
                    return isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && /stop|cancel/i.test(label);
                });
            }
        },
        gemini: {
            id: 'gemini',
            name: 'Gemini',
            agentId: 'leora',
            token: 'Leora7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#3b82f6',
            bgGradient: 'linear-gradient(160deg,#0f172a 0%,#1e1b4b 100%)',
            match: function (h) { return h.includes('gemini.google.com'); },
            inputs: [
                'rich-textarea > div',
                'rich-textarea',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                '.ql-editor',
                'textarea[placeholder*="Ask" i]',
                'textarea'
            ],
            sends: [
                'button[aria-label*="Send" i]',
                '.send-button',
                'button.send-button',
                'button[type="submit"]'
            ],
            assistants: [
                'message-content',
                '.model-response-text',
                '[data-message-author-role="model"]',
                '.response-container-content',
                '.markdown'
            ],
            isGenerating: function () { return hasMatchingButton(/stop|cancel/i); }
        },
        grok: {
            id: 'grok',
            name: 'Grok',
            agentId: 'grok',
            token: 'Grok7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#38bdf8',
            bgGradient: 'linear-gradient(160deg,#090d16 0%,#131c2e 100%)',
            match: function (h, p) {
                return h.includes('grok.com') || h.includes('x.ai') ||
                    ((h.includes('x.com') || h.includes('twitter.com')) && p.startsWith('/i/grok'));
            },
            inputs: [
                'textarea[placeholder*="Ask Grok" i]',
                'textarea[placeholder*="Ask anything" i]',
                'textarea[placeholder*="Ask" i]',
                'div[data-testid*="grok-input-textarea"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea'
            ],
            sends: [
                'button[data-testid*="grok-send"]',
                'button[data-testid*="send"]',
                'button[aria-label*="Submit" i]',
                'button[aria-label*="Send" i]',
                'button[type="submit"]'
            ],
            assistants: [
                '[data-message-author-role="assistant"]',
                'div[data-testid*="message-assistant"]',
                'div[data-testid*="assistant-message"]',
                'div[data-testid*="response"]',
                'div[class*="response-"]',
                'div[class*="prose"]',
                'div[class*="markdown"]'
            ],
            isGenerating: function () {
                return hasMatchingButton(/stop|cancel/i) || !!document.querySelector('button svg rect');
            }
        },
        duck: {
            id: 'duck',
            name: 'Duck.ai',
            agentId: 'duck',
            token: '7X5mDxTsFG3DKgbL1D-Bjsh7LkaNSQsEAjyd19M-14Y',
            accent: '#f97316',
            bgGradient: 'linear-gradient(160deg,#1c1917 0%,#292524 100%)',
            match: function (h, p) {
                return h.includes('duck.ai') ||
                    (h.includes('duckduckgo.com') && (p.includes('/chat') || location.search.includes('DuckDuckGo+AI+Chat')));
            },
            inputs: [
                'textarea[name="user-prompt"]',
                'textarea[placeholder*="Ask" i]',
                'textarea[placeholder*="message" i]',
                'textarea'
            ],
            sends: [
                'button[type="submit"]',
                'button[aria-label="Send message"]',
                'button[aria-label="Send prompt"]',
                '.sk-action-btn'
            ],
            assistants: [
                '[data-testid*="message"]:not([data-testid*="user"])',
                '[data-testid*="response"]',
                'article:not([data-user="true"])',
                '.prose',
                '.markdown',
                'div[class*="messageContent"]'
            ],
            isGenerating: function () { return hasMatchingButton(/stop|cancel/i); }
        },
        perplexity: {
            id: 'perplexity',
            name: 'Perplexity',
            agentId: 'perplexity',
            token: '',
            accent: '#22d3ee',
            bgGradient: 'linear-gradient(160deg,#0f172a 0%,#164e63 100%)',
            match: function (h) { return h.includes('perplexity.ai'); },
            inputs: [
                'textarea[placeholder*="ask" i]',
                'textarea[placeholder]',
                'div[contenteditable="true"]',
                'textarea'
            ],
            sends: [
                'button[aria-label="Submit"]',
                'button[aria-label="Ask"]',
                'button[aria-label*="submit" i]',
                'button[type="submit"]'
            ],
            assistants: [
                '[data-testid="answer-content"]',
                'div[class*="default font-display"]',
                '.prose',
                '.markdown'
            ],
            isGenerating: function () { return hasMatchingButton(/stop/i); }
        },
        deepseek: {
            id: 'deepseek',
            name: 'DeepSeek',
            agentId: 'deepseek',
            token: '',
            accent: '#6366f1',
            bgGradient: 'linear-gradient(160deg,#0f172a 0%,#312e81 100%)',
            match: function (h) { return h.includes('deepseek.com'); },
            inputs: [
                'textarea[placeholder*="Message" i]',
                'textarea[id*="chat-input"]',
                'textarea'
            ],
            sends: [
                'div[class*="send-button"]',
                'button[aria-label*="send" i]',
                'button[type="submit"]'
            ],
            assistants: [
                'div[class*="ds-markdown"]',
                'div[class*="assistant"]',
                '.prose'
            ],
            isGenerating: function () { return hasMatchingButton(/stop/i); }
        },
        muse: {
            id: 'muse',
            name: 'Muse',
            agentId: 'muse',
            token: 'Muse7634xlUI40ZTYfN1AreHfHNvymbCf-TnzOQ',
            accent: '#ec4899',
            bgGradient: 'linear-gradient(160deg,#18181b 0%,#4a044e 100%)',
            match: function (h) { return h.includes('muse.ai') || h.includes('agent.meta.ai'); },
            inputs: [
                'textarea[data-hatch-composer-prehydration-input="true"]',
                'textarea[placeholder*="Message" i]',
                'textarea[aria-label*="Message" i]',
                'textarea',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                '[role="textbox"]'
            ],
            sends: [
                'button[aria-label="Send"]',
                'button[aria-label*="Send" i]',
                'button[type="submit"]',
                'button[data-testid*="send" i]'
            ],
            assistants: [
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
            ],
            isGenerating: function () {
                return hasMatchingButton(/stop|cancel/i) || !!document.querySelector('button[aria-label*="Stop" i]');
            }
        },
        generic: {
            id: 'generic',
            name: 'Universal AI',
            agentId: 'universal_agent',
            token: '',
            accent: '#a855f7',
            bgGradient: 'linear-gradient(160deg,#18181b 0%,#2e1065 100%)',
            match: function () { return true; },
            inputs: [
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea',
                '[role="textbox"]'
            ],
            sends: [
                'button[type="submit"]',
                'button[aria-label*="send" i]',
                'button[aria-label*="submit" i]',
                'button[data-testid*="send" i]'
            ],
            assistants: [
                '[data-message-author-role="assistant"]',
                '[data-message-author-role="model"]',
                '[data-testid*="assistant"]',
                '.prose',
                '.markdown'
            ],
            isGenerating: function () { return hasMatchingButton(/stop|cancel/i); }
        }
    };

    function detectPlatform() {
        var h = location.hostname.toLowerCase();
        var p = location.pathname.toLowerCase();
        for (var key in PLATFORMS) {
            if (key === 'generic') continue;
            if (PLATFORMS[key].match(h, p)) {
                return PLATFORMS[key];
            }
        }
        return PLATFORMS.generic;
    }

    var platform = detectPlatform();

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[' + platform.name + ' Universal Lens]');
        console.log.apply(console, args);
    }

    function isVisible(el) {
        return el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }


    function isUsableButton(btn) {
        return !!btn && btn.isConnected && isVisible(btn) && !btn.disabled &&
               btn.getAttribute('aria-disabled') !== 'true' && !btn.classList.contains('disabled');
    }

    function dismissPlatformOverlay() {
        if (platform.id !== 'penni') return;
        var tooltip = document.querySelector('.cdk-overlay-container .citation-tooltip-text');
        if (tooltip) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }
    }

    function uniqueNodes(nodes) {
        return Array.from(new Set(nodes));
    }

    // ==========================================
    // DOM INPUT, SEND & MESSAGE EXTRACTION
    // ==========================================

    function findInput() {
        var selectors = platform.strictDom ? platform.inputs : platform.inputs.concat(PLATFORMS.generic.inputs);
        for (var i = 0; i < selectors.length; i++) {
            var els = Array.from(document.querySelectorAll(selectors[i]));
            var visibleEl = els.find(isVisible);
            if (visibleEl) return visibleEl;
        }
        if (platform.strictDom) return null;
        var fallbacks = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
        return fallbacks.find(isVisible) || null;
    }

    function findSendButton() {
        var input = findInput();

        // 1. Direct exact platform selectors first (Highest Precision across split-screen viewports)
        var selectors = platform.strictDom ? platform.sends : platform.sends.concat(PLATFORMS.generic.sends);
        for (var i = 0; i < selectors.length; i++) {
            var btn = document.querySelector(selectors[i]);
            if (btn && isVisible(btn)) {
                // Confirm it is not a popup menu, model switcher, or tools dropdown
                var label = (btn.getAttribute('aria-label') || btn.title || btn.textContent || '').toLowerCase();
                var hasMenu = btn.getAttribute('aria-haspopup') === 'menu' || 
                              btn.getAttribute('data-testid') === 'model-switcher-dropdown' ||
                              btn.id === 'model-switcher';
                if (!hasMenu && !/model|gpt-|chatgpt|dropdown|menu/i.test(label)) {
                    if (currentInputText(input)) {
                        btn.disabled = false;
                        btn.removeAttribute('disabled');
                        btn.setAttribute('aria-disabled', 'false');
                        btn.classList.remove('disabled');
                    }
                    return btn;
                }
            }
        }

        // 2. Direct form association (standard HTML form property)
        if (input) {
            var directForm = input.form || (input.parentElement ? input.parentElement.closest('form') : null);
            if (directForm) {
                var formButtons = Array.from(directForm.querySelectorAll('button, [role="button"]'));
                var formFound = formButtons.find(function (b) {
                    if (!b || !b.isConnected || !isVisible(b)) return false;
                    if (b.getAttribute('aria-haspopup') === 'menu' || 
                        b.getAttribute('data-testid') === 'model-switcher-dropdown' ||
                        b.id === 'model-switcher') return false;
                    var label = (b.getAttribute('aria-label') || b.title || b.textContent || '').toLowerCase();
                    if (/model|gpt-|chatgpt|dropdown|mic|dictat|audio|attach|upload|source|file|clear|close|delete|option|menu|share|create|search|canvas|reason/i.test(label)) return false;
                    var testId = b.getAttribute('data-testid') || '';
                    var isSubmit = testId === 'send-button' ||
                                   testId === 'composer-send-button' ||
                                   b.classList.contains('submit-button') ||
                                   b.classList.contains('send-button') ||
                                   /send|submit|query|ask/i.test(label);
                    return isSubmit;
                });
                if (formFound) {
                    var realFormBtn = (formFound.tagName.toLowerCase() === 'button') ? formFound : (formFound.closest('button') || formFound);
                    if (currentInputText(input)) {
                        realFormBtn.disabled = false;
                        realFormBtn.removeAttribute('disabled');
                        realFormBtn.setAttribute('aria-disabled', 'false');
                        realFormBtn.classList.remove('disabled');
                    }
                    return realFormBtn;
                }
            }

            // 3. Scoped container traversal around input
            var parent = input.parentElement;
            var container = parent ? (parent.closest('form, query-input, [class*="query"], [class*="input"], [class*="composer"]') ||
                            (parent.parentElement && parent.parentElement.parentElement) ||
                            (parent.parentElement) ||
                            parent) : null;
            if (container) {
                var buttons = Array.from(container.querySelectorAll('button, [role="button"]'));
                var found = buttons.find(function (b) {
                    if (!b || !b.isConnected || !isVisible(b)) return false;
                    if (b.getAttribute('aria-haspopup') === 'menu' || 
                        b.getAttribute('data-testid') === 'model-switcher-dropdown' ||
                        b.id === 'model-switcher') return false;
                    var label = (b.getAttribute('aria-label') || b.title || b.textContent || '').toLowerCase();
                    if (/model|gpt-|chatgpt|dropdown|mic|dictat|audio|attach|upload|source|file|clear|close|delete|option|menu|share|create|search|canvas|reason/i.test(label)) return false;
                    var testId = b.getAttribute('data-testid') || '';
                    var isSubmit = testId === 'send-button' ||
                                   testId === 'composer-send-button' ||
                                   b.classList.contains('submit-button') ||
                                   b.classList.contains('send-button') ||
                                   /send|submit|query|ask/i.test(label);
                    return isSubmit;
                });
                if (found) {
                    var realBtn = (found.tagName.toLowerCase() === 'button') ? found : (found.closest('button') || found);
                    if (currentInputText(input)) {
                        realBtn.disabled = false;
                        realBtn.removeAttribute('disabled');
                        realBtn.setAttribute('aria-disabled', 'false');
                        realBtn.classList.remove('disabled');
                    }
                    return realBtn;
                }
            }
        }

        return null;
    }

    function currentInputText(input) {
        if (!input) return '';
        if (input.editor && typeof input.editor.getText === 'function') {
            return String(input.editor.getText() || '').trim();
        }
        return String(input.value || input.innerText || input.textContent || '').trim();
    }

    function setInputText(input, text) {
        dismissPlatformOverlay();
        input.focus();
        if (input.editor && input.editor.commands && typeof input.editor.commands.setContent === 'function') {
            try {
                input.editor.commands.setContent(text);
                input.editor.commands.focus();
                return;
            } catch (e) {}
        }
        var execSuccess = false;
        try {
            if (typeof input.select === 'function') {
                input.select();
            } else if (input.setSelectionRange) {
                input.setSelectionRange(0, (input.value || '').length);
            }
            execSuccess = document.execCommand('insertText', false, text);
        } catch (e) {
            execSuccess = false;
        }

        if (!execSuccess || currentInputText(input) !== text.trim()) {
            if ('value' in input && (input.tagName.toLowerCase() === 'textarea' || input.tagName.toLowerCase() === 'input' || input.tagName.toLowerCase() === 'rich-textarea')) {
                var proto = (input instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype :
                            (input instanceof HTMLInputElement) ? HTMLInputElement.prototype : Object.getPrototypeOf(input);
                var setter = Object.getOwnPropertyDescriptor(proto, 'value');
                if (setter && setter.set) {
                    setter.set.call(input, text);
                } else {
                    input.value = text;
                }
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
        }

        // Dispatch composed bubbling events across Web Component host boundaries
        var targets = [
            input,
            input.parentElement,
            (input.parentElement ? input.parentElement.parentElement : null),
            (input.getRootNode && input.getRootNode() !== document ? input.getRootNode().host : null),
            input.closest('query-input'),
            input.closest('rich-textarea'),
            input.closest('form'),
            input.closest('div[class*="query"]')
        ].filter(Boolean);

        var evOpts = { bubbles: true, cancelable: true, composed: true };
        targets.forEach(function (t) {
            try {
                t.dispatchEvent(new InputEvent('beforeinput', Object.assign({}, evOpts, { data: text, inputType: 'insertText' })));
                t.dispatchEvent(new InputEvent('input', Object.assign({}, evOpts, { data: text, inputType: 'insertText' })));
                t.dispatchEvent(new Event('input', evOpts));
                t.dispatchEvent(new Event('change', evOpts));
            } catch (e) {}
        });

        // Propagate value property to custom host element if present
        var host = input.closest('query-input') || input.closest('rich-textarea');
        if (host) {
            try { host.value = text; } catch (e) {}
            try { host.text = text; } catch (e) {}
        }

        // Keypress simulation: dispatch real character key and backspace to force Angular/Lit/Wiz reactive state recalculation
        try {
            var kOpts = Object.assign({}, evOpts, { key: 'a', code: 'KeyA', keyCode: 65, which: 65, charCode: 65 });
            input.dispatchEvent(new KeyboardEvent('keydown', kOpts));
            input.dispatchEvent(new KeyboardEvent('keypress', kOpts));
            input.dispatchEvent(new KeyboardEvent('keyup', kOpts));

            var spaceOpts = Object.assign({}, evOpts, { key: ' ', code: 'Space', keyCode: 32, which: 32, charCode: 32 });
            input.dispatchEvent(new KeyboardEvent('keydown', spaceOpts));
            input.dispatchEvent(new KeyboardEvent('keypress', spaceOpts));
            input.dispatchEvent(new KeyboardEvent('keyup', spaceOpts));

            var bsOpts = Object.assign({}, evOpts, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, charCode: 0 });
            input.dispatchEvent(new KeyboardEvent('keydown', bsOpts));
            input.dispatchEvent(new KeyboardEvent('keyup', bsOpts));
        } catch (e) {}
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
            if (button && currentInputText(input)) {
                button.disabled = false;
                button.removeAttribute('disabled');
                button.setAttribute('aria-disabled', 'false');
                button.classList.remove('disabled');

                // Trigger trusted MouseEvents and Click
                var mOpts = { bubbles: true, cancelable: true, composed: true };
                button.dispatchEvent(new MouseEvent('mousedown', mOpts));
                button.dispatchEvent(new MouseEvent('mouseup', mOpts));
                button.dispatchEvent(new MouseEvent('click', mOpts));
                if (typeof button.click === 'function') button.click();

                // Dispatch composed Enter key on input as secondary trigger
                var kOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
                input.dispatchEvent(new KeyboardEvent('keydown', kOpts));
                input.dispatchEvent(new KeyboardEvent('keypress', kOpts));
                input.dispatchEvent(new KeyboardEvent('keyup', kOpts));

                var form = input.closest('form') || input.closest('query-input') || input.closest('div[class*="query"]');
                if (form) {
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true, composed: true }));
                }

                setStatus('Message sent to ' + platform.name + '.');
                window.setTimeout(function () { commandBusy = false; }, 1200);
                if (onSuccess) onSuccess();
                return;
            }

            if (Date.now() >= deadline) {
                // Enter and Ctrl+Enter fallback with composed: true
                var kOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true };
                input.dispatchEvent(new KeyboardEvent('keydown', kOpts));
                input.dispatchEvent(new KeyboardEvent('keyup', kOpts));
                input.dispatchEvent(new KeyboardEvent('keydown', Object.assign({}, kOpts, { ctrlKey: true })));
                input.dispatchEvent(new KeyboardEvent('keyup', Object.assign({}, kOpts, { ctrlKey: true })));
                window.setTimeout(function () {
                    if (!currentInputText(input)) {
                        setStatus('Message sent via Enter key.');
                        window.setTimeout(function () { commandBusy = false; }, 1200);
                        if (onSuccess) onSuccess();
                    } else {
                        commandBusy = false;
                        setStatus('Text inserted. Press Enter or Send.');
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

    function modelIsGenerating() {
        return platform.isGenerating();
    }

    function serializeNode(node) {
        return node && (node.innerText || node.textContent || '') || '';
    }

    function assistantMessages() {
        var selectors = platform.strictDom ? platform.assistants : platform.assistants.concat(PLATFORMS.generic.assistants);
        var nodes = selectors.flatMap(function (selector) {
            return Array.from(document.querySelectorAll(selector));
        });

        return uniqueNodes(nodes).filter(function (node) {
            if (node.closest('#braid-lens-universal-panel') ||
                node.closest('#braid-lens-scrubber') ||
                node.closest('#braid-lens-popover')) {
                return false;
            }
            var input = findInput();
            if (input && node.contains(input)) return false;
            return isVisible(node);
        });
    }

    // ==========================================
    // HOLODOX 2 RELAY CONNECTOR (TAMPERMONKEY)
    // ==========================================

    var holodoxActive = false;
    var holodoxButton = null;
    var holodoxHeartbeatTimer = null;
    var holodoxInFlight = new Set();
    var SEEN_STORAGE_KEY = 'braid_lens_seen_' + platform.id + '_v3';

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

    function gmRelayCall(route, method, data) {
        return new Promise(function (resolve, reject) {
            var headers = {
                'X-Agent-ID': platform.agentId,
                'Content-Type': 'application/json'
            };
            if (platform.token) {
                headers['Authorization'] = 'Bearer ' + platform.token;
            }

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
        });
    }

    function sendHolodoxHeartbeat() {
        if (!holodoxActive) return;
        gmRelayCall('/heartbeat', 'POST', { agent_id: platform.agentId }).catch(function () {});
    }

    function updateHolodoxButton() {
        if (!holodoxButton) return;
        holodoxButton.textContent = holodoxActive ? 'Holodox: LIVE' : 'Holodox: OFF';
        holodoxButton.style.background = holodoxActive ? platform.accent : '#374151';
        holodoxButton.style.color = holodoxActive ? '#0f172a' : '#ffffff';
        holodoxButton.title = holodoxActive ?
            'Holodox 2 Seat [' + platform.agentId + '] is ACTIVE. Click to disconnect.' :
            'Holodox 2 Seat is OFF. Click to connect to Meeting Hall.';
    }

    function toggleHolodox() {
        holodoxActive = !holodoxActive;
        if (holodoxActive) {
            setStatus('Connecting to Holodox Meeting Hall on port 43921...');
            gmRelayCall('/join', 'POST', { agent_id: platform.agentId, token: platform.token }).then(function () {
                setStatus('Connected to Holodox Hall as [' + platform.agentId + ']!');
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
            gmRelayCall('/leave', 'POST', { agent_id: platform.agentId }).catch(function () {});
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

        if (holodoxSeen.has(msgId) || holodoxInFlight.has(msgId) || sender === platform.agentId) {
            processNextHolodoxMessage(messages, index + 1);
            return;
        }

        holodoxInFlight.add(msgId);

        function waitAndInject() {
            if (!holodoxActive) {
                holodoxInFlight.delete(msgId);
                return;
            }
            if (commandBusy || modelIsGenerating()) {
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

                        setStatus('Posting ' + platform.name + ' reply back to Holodox Hall...');
                        gmRelayCall('/send', 'POST', {
                            to_group: 'universal',
                            type: 'response',
                            reply_to: msgId,
                            content: replyText
                        }).then(function () {
                            setStatus(platform.name + ' reply posted to Holodox Meeting Hall!');
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
            var generating = modelIsGenerating();
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
                        var text = sanitizePlatformAssistantText(stripBridgeOutput(serializeNode(targetNode))).trim();
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

    var directoryHandle = null;
    var commandBusy = false;
    var statusElement = null;
    var boopEnabled = false;
    var boopTimer = null;
    var boopButton = null;

    var BRIDGE_INSTRUCTIONS = [
        '[' + platform.name.toUpperCase() + ' BRIDGE INSTRUCTIONS]',
        'You have access to a user-selected local folder through the Braid Lens browser bridge.',
        'When you need a file or memory operation, emit exactly one command alone on its own line; the user does not need to type anything.',
        'All paths are relative to the bound folder. Never use an absolute path or .. traversal.',
        '',
        'SPELL-CASTING SYNTAX (natural phrases alone on their own line):',
        'List bound-folder root: MIRROR MIRROR:',
        'List a subfolder:       MIRROR MIRROR: PRESERVATION/Timothy',
        '(also usable for listing: REVEAL THYSELF: / LANTERN LIGHT: / OPEN SESAME:)',
        'Read a root file:       ABRACADABRA: README.md',
        'Read a nested file:     ABRACADABRA: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md',
        'Read a large file:      ABRACADABRA: relative/path.md | offset: 100000',
        '(also usable for reading: SPEAK, FRIEND: / PAGE TURN: / WHISPER SECRETS:)',
        'Write a file:',
        'PRESTO CHANGO: relative/path.md',
        'file contents here...',
        'SO MOTE IT BE',
        '(also usable for writing: INK AND QUILL: / CONJURE: / TRANSMUTE:)',
        'Append to a file:',
        'HOCUS POCUS: relative/path.md',
        'appended lines...',
        'SO MOTE IT BE',
        '(also usable for appending: FURTHER WORDS: / AND SO IT CONTINUES: / QUILL AGAIN:)',
        'SO MOTE IT BE is the universal closing line for write and append.',
        '',
        'BRACKET SYNTAX (fully supported):',
        'ROOT LISTING:     [LIST_DIR:]',
        'ROOT FILE:        [READ_FILE: README.md]',
        'NESTED FOLDER:    [LIST_DIR: PRESERVATION/Timothy]',
        'LARGE FILE:       [READ_FILE_CHUNK: relative/path.md | offset: 100000]',
        'WRITE FILE:       [WRITE_FILE: relative/path.md]...content...[/WRITE_FILE]',
        'APPEND FILE:      [APPEND_FILE: relative/path.md]...content...[/APPEND_FILE]',
        'CASEY MEMORY:     [FETCH_CASEY: search_query]',
        '',
        'The single period "." is only the optional five-minute boop.',
        'Do not claim success until the bridge returns a FILE_CONTENTS, DIRECTORY_LIST, WRITE_RESULT, CASEY_CONTEXT, or SYSTEM_NOTICE receipt.',
        'This adapter connects you directly into the Braid Meeting Hall on port 43921 as [' + platform.agentId + '].',
        '[/' + platform.name.toUpperCase() + ' BRIDGE INSTRUCTIONS]'
    ].join('\n');

    function sendBridgeInstructions() {
        if (commandBusy) {
            setStatus('A file operation is still in progress; instructions not sent.');
            return;
        }
        injectTextAndSend(BRIDGE_INSTRUCTIONS);
        setStatus('Bridge instructions sent to ' + platform.name + '.');
    }

    function updateBoopButton() {
        if (!boopButton) return;
        boopButton.textContent = boopEnabled ? 'Boop: ON' : 'Boop: OFF';
        boopButton.style.background = boopEnabled ? '#059669' : '#374151';
        boopButton.title = boopEnabled ? 'Five-minute boop is enabled; click to turn it off.' : 'Five-minute boop is disabled; click to turn it on.';
    }

    function triggerBoop() {
        if (!boopEnabled || commandBusy || modelIsGenerating()) return;
        var input = findInput();
        if (!input || currentInputText(input)) return;
        injectTextAndSend('.');
        setStatus('Boop sent to ' + platform.name + '.');
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
            .replace(/\[LIST_DIR/g, '&#91;LIST_DIR')
            .replace(/\[FETCH_CASEY/g, '&#91;FETCH_CASEY');
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

    function executeList(arg) {
        return ensurePermission().then(function (allowed) {
            if (!allowed) {
                commandBusy = false;
                return;
            }
            var rawPath = arg || '';
            var offset = 0;
            if (rawPath.indexOf('|') !== -1) {
                var pParts = rawPath.split('|');
                rawPath = pParts[0].trim();
                var m = /offset:\s*(\d+)/i.exec(pParts[1]);
                if (m) offset = Number(m[1]);
            }
            var safePath = (rawPath === 'root') ? '' : normalizePath(rawPath);

            return openDirectory(safePath, false).then(function (directory) {
                var dirs = [];
                var files = [];
                var ignore = ['node_modules', '.git', '.history', '.tmp', '.pytest_cache', '.playwright-cli', '.superpowers'];

                return (async function () {
                    for await (var entry of directory.values()) {
                        var name = entry.name;
                        if (ignore.indexOf(name) !== -1 || name.startsWith('.holodox') || name.startsWith('CUsers')) continue;
                        if (name.endsWith('.tmp') || name.endsWith('.log') || name.endsWith('.bak') || name.endsWith('.pid') || name.endsWith('.efu')) continue;

                        if (entry.kind === 'directory') {
                            dirs.push('- ' + name + '/ (directory)');
                        } else {
                            files.push('- ' + name);
                        }
                    }

                    dirs.sort();
                    files.sort();

                    var allItems = dirs.concat(files);
                    var totalFound = allItems.length;
                    var maxChars = (platform.id === 'penni') ? 3200 : 30000;

                    var output = '[DIRECTORY_LIST: ' + (safePath || 'root') + ']\n';
                    var count = 0;

                    for (var i = offset; i < allItems.length; i++) {
                        var line = allItems[i] + '\n';
                        if (output.length + line.length + 180 > maxChars) {
                            output += '\n[SYSTEM_NOTICE: DIRECTORY LISTING TRUNCATED (' + count + ' of ' + totalFound + ' items shown). Read next batch with [LIST_DIR: ' + (safePath || 'root') + ' | offset: ' + (offset + count) + ']]\n';
                            break;
                        }
                        output += line;
                        count++;
                    }

                    output += '[/DIRECTORY_LIST]';
                    setStatus('Directory listed; sending receipt (' + count + '/' + totalFound + ' items)...');
                    injectTextAndSend(output);
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

    function executeFetchCasey(query) {
        var cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            commandBusy = false;
            return;
        }
        setStatus('Querying Casey memory fragments for: ' + cleanQuery);
        GM_xmlhttpRequest({
            method: 'GET',
            url: LENNY_BASE + '/casey/fragments?q=' + encodeURIComponent(cleanQuery),
            timeout: 10000,
            onload: function (res) {
                try {
                    var data = JSON.parse(res.responseText || '{}');
                    var results = (data.results || []).slice(0, 15);
                    if (!results.length) {
                        injectTextAndSend('[CASEY_CONTEXT: "' + cleanQuery + '"]\nNo memory fragments found.\n[/CASEY_CONTEXT]');
                        return;
                    }
                    var output = '[CASEY_CONTEXT: "' + cleanQuery + '" — ' + results.length + ' fragments]\n\n' +
                        results.map(function (f, i) {
                            return '[' + (i + 1) + '] (' + (f.type || 'memory') + ') ' + (f.content || '').slice(0, 450);
                        }).join('\n\n') + '\n\n[/CASEY_CONTEXT]';
                    injectTextAndSend(output);
                } catch (e) {
                    injectTextAndSend('[SYSTEM_NOTICE: Casey query failed to parse response.]');
                }
            },
            onerror: function () {
                injectTextAndSend('[SYSTEM_NOTICE: Casey server on port 3333 unreachable.]');
            }
        });
    }

    function sanitizePlatformAssistantText(text) {
        if (!text) return '';
        if (platform.id === 'penni') {
            // Strip NotebookLM thoughts accordion, reasoning blocks, and material icon artifacts
            text = text.replace(/^Thoughts\s*(?:expand_more|expand_less)[\s\S]*?(?:Hide thoughts|expand_less|\n\n|\r\n\r\n)/i, '');
            text = text.replace(/\b(?:expand_more|expand_less)\b/g, '');
            text = text.replace(/^Thoughts\s*[\r\n]+/i, '');
        }
        return text.trim();
    }

    function stripBridgeOutput(text) {
        return text
            .replace(/\[FILE_CONTENTS:[\s\S]*?\[\/FILE_CONTENTS\]/g, '')
            .replace(/\[DIRECTORY_LIST:[\s\S]*?\[\/DIRECTORY_LIST\]/g, '')
            .replace(/\[CASEY_CONTEXT:[\s\S]*?\[\/CASEY_CONTEXT\]/g, '')
            .replace(/\[SYSTEM_NOTICE:[\s\S]*?\]/g, '')
            .replace(/\[SYSTEM_ERROR:[\s\S]*?\]/g, '');
    }

    function hasBridgeCommand(text) {
        return /\[(?:WRITE_FILE|APPEND_FILE|READ_FILE_CHUNK|READ_FILE|LIST_DIR|FETCH_CASEY):/.test(text) ||
            /^(?:MIRROR MIRROR|REVEAL THYSELF|LANTERN LIGHT|OPEN SESAME):/m.test(text) ||
            /^(?:ABRACADABRA|SPEAK, FRIEND|PAGE TURN|WHISPER SECRETS):/m.test(text) ||
            /^(?:PRESTO CHANGO|INK AND QUILL|CONJURE|TRANSMUTE):/m.test(text) ||
            /^(?:HOCUS POCUS|FURTHER WORDS|AND SO IT CONTINUES|QUILL AGAIN):/m.test(text);
    }

    function hasIncompleteCommandTag(text) {
        var writeOpen = /\[WRITE_FILE:[^\]]*\]/.test(text);
        var writeClose = /\[\/WRITE_FILE\]/.test(text);
        if (writeOpen && !writeClose) return true;

        var appendOpen = /\[APPEND_FILE:[^\]]*\]/.test(text);
        var appendClose = /\[\/APPEND_FILE\]/.test(text);
        if (appendOpen && !appendClose) return true;

        return false;
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
            var candidateText = sanitizePlatformAssistantText(stripBridgeOutput(serializeNode(candidate)));
            if (!candidateText.trim()) continue;
            if (!hasBridgeCommand(candidateText)) {
                candidate.setAttribute(PROCESSED_ATTR, 'true');
                continue;
            }

            // Stream guard: wait if block is still streaming closing tag
            if (hasIncompleteCommandTag(candidateText)) return;

            node = candidate;
            text = candidateText;
            break;
        }
        if (!node) return;

        var write = /\[WRITE_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/.exec(text) ||
                    /^(?:PRESTO CHANGO|INK AND QUILL|CONJURE|TRANSMUTE):\s*([^\r\n]+)\r?\n([\s\S]*?)\r?\nSO MOTE IT BE$/m.exec(text);
        var append = /\[APPEND_FILE:\s*([^\]]+)\]([\s\S]*?)\[\/APPEND_FILE\]/.exec(text) ||
                     /^(?:HOCUS POCUS|FURTHER WORDS|AND SO IT CONTINUES|QUILL AGAIN):\s*([^\r\n]+)\r?\n([\s\S]*?)\r?\nSO MOTE IT BE$/m.exec(text);
        var readChunk = /\[READ_FILE_CHUNK:\s*([^|]+)\|\s*offset:\s*(\d+)\]/.exec(text) ||
                        /^(?:ABRACADABRA|SPEAK, FRIEND|PAGE TURN|WHISPER SECRETS):\s*([^|\r\n]+)\|\s*offset:\s*(\d+)$/m.exec(text);
        var read = /\[READ_FILE:\s*([^\]]+)\]/.exec(text) ||
                   /^(?:ABRACADABRA|SPEAK, FRIEND|PAGE TURN|WHISPER SECRETS):\s*([^\r\n]+)$/m.exec(text);
        var list = /\[LIST_DIR:\s*([^\]]*)\]/.exec(text) ||
                   /^(?:MIRROR MIRROR|REVEAL THYSELF|LANTERN LIGHT|OPEN SESAME):\s*([^\r\n]*)$/m.exec(text);
        var casey = /\[FETCH_CASEY:\s*([^\]]+)\]/.exec(text);

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
        } else if (casey && !isRegexTrap(casey[1])) {
            recognized = true;
            commandBusy = true;
            executeFetchCasey(casey[1].trim());
        }

        if (recognized || !hasBridgeCommand(text)) node.setAttribute(PROCESSED_ATTR, 'true');
    }

    // ==========================================
    // VERNIER FISHEYE SCRUBBER ENGINE
    // ==========================================

    var scrubberEnabled = true;
    var scrubberTrack = null;
    var scrubberViewport = null;
    var scrubberPopover = null;
    var scrubberPopSpeaker = null;
    var scrubberPopMeta = null;
    var scrubberPopSnippet = null;
    var scrubberButton = null;

    var scrubberMag = 3.0;
    var scrubberRadius = 75;
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
                border-left: 1px solid rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(8px);
                transition: width 0.15s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease;
                user-select: none;
                box-sizing: border-box;
            }
            #braid-lens-scrubber:hover,
            #braid-lens-scrubber.active-lens {
                width: 28px;
                background: rgba(10, 15, 26, 0.92);
                border-left-color: ${platform.accent};
                box-shadow: -4px 0 20px rgba(0, 0, 0, 0.6);
            }
            #braid-lens-scrubber-vp {
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                height: 40px;
                background: rgba(255, 255, 255, 0.15);
                border-top: 1px solid ${platform.accent};
                border-bottom: 1px solid ${platform.accent};
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
                background: ${platform.accent};
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
                background: #090d16;
                border: 1px solid #1e293b;
                border-left: 3px solid ${platform.accent};
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
                outline: 3px solid ${platform.accent} !important;
                outline-offset: 4px !important;
                border-radius: 8px !important;
                box-shadow: 0 0 25px ${platform.accent}88 !important;
                transition: outline 0.2s ease, box-shadow 0.2s ease !important;
            }
        `;
        document.head.appendChild(style);
    }

    function findChatScrollElement() {
        var candidates = [
            document.querySelector('main div[class*="react-scroll-to-bottom"]'),
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
            '[data-message-author-role]',
            'article[data-testid*="conversation-turn-"]',
            'article',
            'div[data-testid*="message-row"]',
            'div[data-testid*="message"]',
            'div[class*="hatch-chat-groupable-bubble"]',
            'div[class*="message-bubble"]',
            'div[class*="message-container"]',
            'div[class*="response-"]'
        ];
        var nodes = [];
        for (var i = 0; i < selectors.length; i++) {
            nodes = Array.from(document.querySelectorAll(selectors[i]));
            if (nodes.length > 1) break;
        }

        if (!nodes.length) {
            nodes = assistantMessages();
        }

        return uniqueNodes(nodes).filter(function (n) {
            if (n.closest('#braid-lens-universal-panel') ||
                n.closest('#braid-lens-scrubber') ||
                n.closest('#braid-lens-popover')) {
                return false;
            }
            return isVisible(n);
        });
    }

    function getTurnData(node, index, total) {
        var role = node.getAttribute('data-message-author-role') || '';
        if (!role) {
            var cls = (node.className || '');
            var testid = (node.getAttribute('data-testid') || '').toLowerCase();
            var text = (node.innerText || '').slice(0, 100);
            if (cls.indexOf('bg-chat-user-bubble') !== -1 || testid.includes('user') || /user/i.test(testid)) {
                role = 'user';
            } else if (cls.indexOf('hatch-agent-bubble') !== -1 || cls.indexOf('hatch-chat-groupable-bubble') !== -1 ||
                testid.includes('assistant') || testid.includes('model') || testid.includes('grok') ||
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
            speaker: isUser ? 'User' : platform.name,
            color: isUser ? '#f97316' : platform.accent,
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

        scrubberTrack.addEventListener('click', function (e) {
            var rect = scrubberTrack.getBoundingClientRect();
            var clickY = e.clientY - rect.top;
            jumpToTurnAtY(clickY);
        });

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

    // ==========================================
    // UNIFIED DRAGGABLE POLYMORPH HUD (4 MODES)
    // ==========================================

    var HUD_STORAGE_KEY = 'braid_lens_hud_mode_' + platform.id;
    var currentHudMode = 'grid';
    try {
        currentHudMode = localStorage.getItem(HUD_STORAGE_KEY) || 'grid';
    } catch (e) {
        currentHudMode = 'grid';
    }
    var lastExpandedMode = (currentHudMode === 'min') ? 'grid' : currentHudMode;
    var guidePopover = null;

    function injectPanel() {
        if (document.getElementById('braid-lens-universal-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'braid-lens-universal-panel';
        panel.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;' +
            'background:' + platform.bgGradient + ';color:#f8fafc;border:2px solid ' + platform.accent + ';' +
            'box-shadow:0 8px 32px rgba(0,0,0,.75),0 0 14px ' + platform.accent + '33;' +
            'font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;' +
            'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
            'transition:width 0.22s ease, padding 0.22s ease, border-radius 0.22s ease, box-shadow 0.22s ease;';

        var wasDragged = makeDraggable(panel);

        // Header
        var header = document.createElement('div');
        header.id = 'braid-lens-hud-header';
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;cursor:move;margin-bottom:8px;';

        var title = document.createElement('div');
        title.id = 'braid-lens-hud-title';
        title.textContent = '⚡ ' + platform.name;
        title.style.cssText = 'font-weight:bold;color:' + platform.accent + ';letter-spacing:0.02em;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        header.appendChild(title);

        var modeBar = document.createElement('div');
        modeBar.id = 'braid-lens-hud-modebar';
        modeBar.style.cssText = 'display:flex;gap:3px;align-items:center;margin-left:6px;';

        function createModeBtn(label, mode, tip) {
            var b = document.createElement('button');
            b.textContent = label;
            b.title = tip;
            b.style.cssText = 'padding:1px 5px;background:rgba(255,255,255,0.08);color:#cbd5e1;border:1px solid rgba(255,255,255,0.15);border-radius:3px;cursor:pointer;font-size:10px;line-height:14px;';
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                if (wasDragged()) return;
                applyHudMode(mode);
            });
            return b;
        }

        var btnMin = createModeBtn('—', 'min', 'Minimize to Pill (Click to fold out)');
        var btnRow = createModeBtn('↔', 'row', 'Row Layout (Horizontal toolbar)');
        var btnCol = createModeBtn('↕', 'col', 'Column Layout (Vertical sidebar)');
        var btnGrid = createModeBtn('⊞', 'grid', 'Table Layout (3, 3, 1 grid)');

        modeBar.appendChild(btnMin);
        modeBar.appendChild(btnRow);
        modeBar.appendChild(btnCol);
        modeBar.appendChild(btnGrid);
        header.appendChild(modeBar);
        panel.appendChild(header);

        // Body container for the 7 buttons
        var body = document.createElement('div');
        body.id = 'braid-lens-hud-body';
        panel.appendChild(body);

        // 1. Folder Button
        var bind = document.createElement('button');
        bind.id = 'braid-lens-btn-bind';
        bind.textContent = 'Bind Folder';
        bind.style.cssText = 'padding:6px 8px;background:' + platform.accent + ';color:#0f172a;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;min-width:0;';
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
        body.appendChild(bind);

        // 2. Orient Button
        var orient = document.createElement('button');
        orient.id = 'braid-lens-btn-orient';
        orient.textContent = 'Orient ' + platform.name;
        orient.style.cssText = 'padding:6px 8px;background:#0284c7;color:white;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;min-width:0;';
        orient.addEventListener('click', function () {
            if (wasDragged()) return;
            sendBridgeInstructions();
        });
        body.appendChild(orient);

        // 3. Holodox Button
        holodoxButton = document.createElement('button');
        holodoxButton.id = 'braid-lens-btn-holodox';
        holodoxButton.style.cssText = 'padding:6px 8px;background:#374151;color:white;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;min-width:0;';
        holodoxButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleHolodox();
        });
        body.appendChild(holodoxButton);
        updateHolodoxButton();

        // 4. Scrubber Button
        scrubberButton = document.createElement('button');
        scrubberButton.id = 'braid-lens-btn-scrubber';
        scrubberButton.textContent = 'Scrubber: ON';
        scrubberButton.style.cssText = 'padding:6px 8px;background:#059669;color:white;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;min-width:0;';
        scrubberButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleScrubber();
        });
        body.appendChild(scrubberButton);

        // 5. Guide / Help Popover Button (replaces bloated details dropdown)
        var guideBtn = document.createElement('button');
        guideBtn.id = 'braid-lens-btn-guide';
        guideBtn.textContent = '? Guide';
        guideBtn.title = 'Click to show/hide Universal Braid Lens command guide';
        guideBtn.style.cssText = 'padding:6px 8px;background:#475569;color:#f8fafc;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;box-sizing:border-box;min-width:0;';
        guideBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (wasDragged()) return;
            toggleGuidePopover(panel);
        });
        body.appendChild(guideBtn);

        // 6. Boop Button
        boopButton = document.createElement('button');
        boopButton.id = 'braid-lens-btn-boop';
        boopButton.style.cssText = 'padding:6px 8px;background:#374151;color:white;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;min-width:0;';
        boopButton.addEventListener('click', function () {
            if (wasDragged()) return;
            toggleBoop();
        });
        body.appendChild(boopButton);
        updateBoopButton();

        // 7. Diagnose Button
        var diagnose = document.createElement('button');
        diagnose.id = 'braid-lens-btn-diagnose';
        diagnose.textContent = 'Diagnose';
        diagnose.style.cssText = 'padding:6px 8px;background:#6366f1;color:white;border:0;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;text-align:center;white-space:nowrap;box-sizing:border-box;min-width:0;';
        diagnose.addEventListener('click', function () {
            if (wasDragged()) return;
            var input = findInput();
            var report = '[BRAID LENS DIAGNOSTIC - v' + VERSION + ']\n' +
                'Platform: ' + platform.name + ' (' + location.hostname + ')\n' +
                'Agent ID: ' + platform.agentId + '\n' +
                'Input: ' + (input ? input.tagName : 'NOT FOUND') + '\n' +
                'Send Button: ' + (findSendButton() ? 'FOUND' : 'NOT FOUND') + '\n' +
                'Assistant turns: ' + assistantMessages().length + '\n' +
                'Bound folder: ' + (directoryHandle ? directoryHandle.name : 'NONE') + '\n' +
                'Holodox Seat: ' + (holodoxActive ? 'CONNECTED' : 'OFF') + '\n' +
                'Boop: ' + (boopEnabled ? 'ON' : 'OFF');
            setStatus(report.replace(/\n/g, ' | '));
            injectTextAndSend(report);
        });
        body.appendChild(diagnose);

        // Status Line
        statusElement = document.createElement('div');
        statusElement.id = 'braid-lens-hud-status';
        statusElement.textContent = 'No folder bound.';
        statusElement.style.cssText = 'margin-top:6px;color:#94a3b8;white-space:pre-wrap;font-family:monospace;font-size:10px;line-height:1.3;max-height:36px;overflow:hidden;';
        panel.appendChild(statusElement);

        // Minimized Pill Click-to-Expand
        panel.addEventListener('click', function () {
            if (currentHudMode === 'min') {
                if (wasDragged()) return;
                applyHudMode(lastExpandedMode || 'grid');
            }
        });

        // Function to apply the 4 layout modes
        function applyHudMode(mode) {
            currentHudMode = mode;
            if (mode !== 'min') lastExpandedMode = mode;
            try { localStorage.setItem(HUD_STORAGE_KEY, mode); } catch (e) {}

            [btnMin, btnRow, btnCol, btnGrid].forEach(function (btn) {
                btn.style.borderColor = 'rgba(255,255,255,0.15)';
                btn.style.color = '#cbd5e1';
            });

            if (mode === 'min') {
                panel.style.display = 'inline-flex';
                panel.style.flexDirection = 'row';
                panel.style.alignItems = 'center';
                panel.style.width = 'auto';
                panel.style.padding = '6px 14px';
                panel.style.borderRadius = '20px';
                panel.style.cursor = 'pointer';
                header.style.display = 'flex';
                header.style.margin = '0';
                title.textContent = '⚡ ' + platform.name;
                title.style.fontSize = '12px';
                modeBar.style.display = 'none';
                body.style.display = 'none';
                statusElement.style.display = 'none';
                btnMin.style.borderColor = platform.accent;
                btnMin.style.color = '#ffffff';
                if (guidePopover) guidePopover.style.display = 'none';
            } else if (mode === 'row') {
                panel.style.display = 'flex';
                panel.style.flexDirection = 'row';
                panel.style.alignItems = 'center';
                panel.style.width = 'auto';
                panel.style.padding = '5px 10px';
                panel.style.borderRadius = '8px';
                panel.style.cursor = 'default';
                panel.style.boxSizing = 'border-box';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.margin = '0 8px 0 0';
                title.textContent = '⚡ ' + platform.name;
                title.style.fontSize = '11px';
                modeBar.style.display = 'flex';
                body.style.display = 'flex';
                body.style.flexDirection = 'row';
                body.style.alignItems = 'center';
                body.style.gap = '5px';
                body.style.boxSizing = 'border-box';
                body.style.gridTemplateColumns = 'none';
                diagnose.style.gridColumn = 'auto';
                statusElement.style.display = 'none';
                btnRow.style.borderColor = platform.accent;
                btnRow.style.color = '#ffffff';
            } else if (mode === 'col') {
                panel.style.display = 'flex';
                panel.style.flexDirection = 'column';
                panel.style.width = '130px';
                panel.style.padding = '8px';
                panel.style.borderRadius = '10px';
                panel.style.cursor = 'default';
                panel.style.boxSizing = 'border-box';
                header.style.display = 'flex';
                header.style.flexDirection = 'column';
                header.style.alignItems = 'stretch';
                header.style.margin = '0 0 6px 0';
                title.textContent = '⚡ ' + platform.name;
                title.style.fontSize = '12px';
                title.style.textAlign = 'center';
                title.style.marginBottom = '4px';
                modeBar.style.display = 'flex';
                modeBar.style.justifyContent = 'center';
                modeBar.style.margin = '0';
                body.style.display = 'flex';
                body.style.flexDirection = 'column';
                body.style.gap = '5px';
                body.style.boxSizing = 'border-box';
                body.style.gridTemplateColumns = 'none';
                diagnose.style.gridColumn = 'auto';
                statusElement.style.display = 'block';
                btnCol.style.borderColor = platform.accent;
                btnCol.style.color = '#ffffff';
            } else {
                panel.style.display = 'flex';
                panel.style.flexDirection = 'column';
                panel.style.width = '330px';
                panel.style.padding = '10px 12px';
                panel.style.borderRadius = '12px';
                panel.style.cursor = 'default';
                panel.style.boxSizing = 'border-box';
                header.style.display = 'flex';
                header.style.flexDirection = 'row';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.margin = '0 0 8px 0';
                title.textContent = 'Braid Lens — ' + platform.name + ' v' + VERSION;
                title.style.fontSize = '12px';
                title.style.textAlign = 'left';
                title.style.marginBottom = '0';
                modeBar.style.display = 'flex';
                modeBar.style.justifyContent = 'flex-end';
                body.style.display = 'grid';
                body.style.gridTemplateColumns = 'repeat(3, 1fr)';
                body.style.gap = '6px';
                body.style.width = '100%';
                body.style.boxSizing = 'border-box';
                diagnose.style.gridColumn = 'span 3';
                statusElement.style.display = 'block';
                btnGrid.style.borderColor = platform.accent;
                btnGrid.style.color = '#ffffff';
            }
        }

        applyHudMode(currentHudMode);

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
                    setStatus('Saved folder found: ' + saved.name + '; click to re-authorize.');
                }
            }).catch(function () {
                bind.textContent = 'Re-authorize folder';
                setStatus('Saved folder found, but permission must be re-authorized.');
            });
        }).catch(function (error) {
            setStatus('Saved folder lookup unavailable: ' + error.message);
        });
    }

    function toggleGuidePopover(anchorPanel) {
        if (!guidePopover) {
            guidePopover = document.createElement('div');
            guidePopover.id = 'braid-lens-guide-popover';
            guidePopover.style.cssText = 'position:fixed;z-index:2147483647;width:340px;padding:12px;background:#0f172a;color:#f8fafc;' +
                'border:2px solid ' + platform.accent + ';border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,0.85);font:11px/1.45 ui-monospace,Consolas,monospace;' +
                'backdrop-filter:blur(12px);display:none;';

            var closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:13px;';
            closeBtn.addEventListener('click', function () { guidePopover.style.display = 'none'; });
            guidePopover.appendChild(closeBtn);

            var guideTitle = document.createElement('div');
            guideTitle.textContent = '📖 Universal Braid Lens Guide';
            guideTitle.style.cssText = 'font-weight:bold;color:' + platform.accent + ';margin-bottom:6px;font-size:12px;';
            guidePopover.appendChild(guideTitle);

            var guideContent = document.createElement('div');
            guideContent.style.cssText = 'color:#cbd5e1;white-space:pre-wrap;';
            guideContent.textContent = [
                'NATURAL SPELL-CASTING:',
                'MIRROR MIRROR:               (List bound folder)',
                'MIRROR MIRROR: folder/name   (List subfolder)',
                'ABRACADABRA: file.md         (Read file)',
                'PRESTO CHANGO: file.md       (Write file)',
                'content...',
                'SO MOTE IT BE',
                'HOCUS POCUS: file.md         (Append file)',
                'appended content...',
                'SO MOTE IT BE',
                '',
                'BRACKET SYNTAX:',
                '[LIST_DIR:]                  (List root)',
                '[READ_FILE: path/to/file]',
                '[WRITE_FILE: path]...[/WRITE_FILE]',
                '[APPEND_FILE: path]...[/APPEND_FILE]',
                '[FETCH_CASEY: query]',
                '',
                'Holodox: connects to port 43921 as [' + platform.agentId + ']'
            ].join('\n');
            guidePopover.appendChild(guideContent);
            document.body.appendChild(guidePopover);
        }

        if (guidePopover.style.display === 'block') {
            guidePopover.style.display = 'none';
        } else {
            var rect = anchorPanel.getBoundingClientRect();
            if (rect.left > 360) {
                guidePopover.style.top = rect.top + 'px';
                guidePopover.style.right = (window.innerWidth - rect.left + 10) + 'px';
                guidePopover.style.left = 'auto';
            } else {
                guidePopover.style.top = (rect.bottom + 10) + 'px';
                guidePopover.style.left = Math.max(10, rect.left) + 'px';
                guidePopover.style.right = 'auto';
            }
            guidePopover.style.display = 'block';
        }
    }

    function startObserver() {
        var observer = new MutationObserver(function () {
            window.setTimeout(parseLatestAssistant, 900);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        window.setTimeout(parseLatestAssistant, 1200);
    }

    function boot() {
        log('Universal Braid Lens v' + VERSION + ' active for ' + platform.name);
        initVernierScrubber();
        injectPanel();
        window.setInterval(injectPanel, 1500);
        window.setTimeout(startObserver, 2500);
    }

    boot();
})();
