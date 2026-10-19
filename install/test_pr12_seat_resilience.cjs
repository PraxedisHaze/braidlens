const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, 'universal.user.js');
const rootCopyPath = path.resolve(__dirname, '..', '..', '..', 'braid-lens-universal.user.js');
const code = fs.readFileSync(scriptPath, 'utf8');
const rootCode = fs.readFileSync(rootCopyPath, 'utf8');

function runTest(name, fn) {
    return Promise.resolve().then(fn).then(() => {
        console.log('PASS: ' + name);
    });
}

function createHarness(initialRoute, relayHandler) {
    let pathname = initialRoute || '/app/thread-1';
    const localStore = new Map();
    const gmStore = new Map([['holodox_token_leora', 'test-seat-token-leora']]);
    const timeouts = [];
    const intervals = [];
    let nextTimerId = 1;
    let holodoxBtn = null;
    let statusEl = null;
    let confirmQueue = [];
    let defaultConfirm = true;
    let promptResult = '';
    let lockHeld = false;
    const injectedTexts = [];

    function makeEl(tag) {
        const children = [];
        const listeners = {};
        const attrs = {};
        const el = {
            tagName: String(tag || 'div').toUpperCase(),
            id: '',
            className: '',
            textContent: '',
            innerText: '',
            title: '',
            value: '',
            disabled: false,
            isConnected: true,
            offsetWidth: 100,
            offsetHeight: 30,
            clientHeight: 500,
            scrollHeight: 1000,
            scrollTop: 0,
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                contains: () => false
            },
            getClientRects: () => [{ width: 100, height: 30 }],
            getBoundingClientRect: () => ({ top: 50, left: 50, right: 150, bottom: 80, width: 100, height: 30 }),
            setAttribute: (k, v) => { attrs[k] = String(v); },
            getAttribute: (k) => (k in attrs ? attrs[k] : null),
            hasAttribute: (k) => (k in attrs),
            appendChild: (c) => {
                children.push(c);
                if (c && c.id === 'braid-lens-btn-holodox') holodoxBtn = c;
                if (c && c.id === 'braid-lens-hud-status') statusEl = c;
                return c;
            },
            append: (...cs) => {
                cs.forEach((c) => el.appendChild(c));
            },
            replaceChildren: () => { children.length = 0; },
            addEventListener: (ev, cb) => {
                listeners[ev] = listeners[ev] || [];
                listeners[ev].push(cb);
            },
            click: () => {
                (listeners.click || []).forEach((cb) => cb({ stopPropagation: () => {}, preventDefault: () => {} }));
            },
            querySelector: () => null,
            querySelectorAll: () => [],
            closest: () => null,
            contains: () => false,
            focus: () => {},
            select: () => {},
            remove: () => {},
            showModal: () => {},
            close: () => {}
        };
        return el;
    }

    const inputEl = makeEl('textarea');
    const sendBtn = makeEl('button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.addEventListener('click', () => {
        injectedTexts.push(inputEl.value || inputEl.textContent || '');
        inputEl.value = '';
        inputEl.textContent = '';
        inputEl.innerText = '';
    });

    const body = makeEl('body');
    const docEl = makeEl('html');
    const document = {
        title: 'Muse Gemini Test',
        body,
        documentElement: docEl,
        head: makeEl('head'),
        createElement: (tag) => {
            const e = makeEl(tag);
            return new Proxy(e, {
                set(target, prop, val) {
                    target[prop] = val;
                    if (prop === 'id' && val === 'braid-lens-btn-holodox') holodoxBtn = target;
                    if (prop === 'id' && val === 'braid-lens-hud-status') statusEl = target;
                    return true;
                }
            });
        },
        createDocumentFragment: () => makeEl('fragment'),
        getElementById: (id) => {
            if (id === 'braid-lens-btn-holodox') return holodoxBtn;
            if (id === 'braid-lens-hud-status') return statusEl;
            return null;
        },
        querySelector: (sel) => {
            if (/send|submit/i.test(sel)) return sendBtn;
            return null;
        },
        querySelectorAll: (sel) => {
            if (/textarea|contenteditable|ql-editor/i.test(sel)) return [inputEl];
            if (/send|submit/i.test(sel)) return [sendBtn];
            return [];
        },
        addEventListener: () => {},
        dispatchEvent: () => {},
        execCommand: (_cmd, _ui, text) => {
            inputEl.value = String(text || '');
            inputEl.textContent = String(text || '');
            return true;
        }
    };

    const windowObj = {
        innerWidth: 1280,
        innerHeight: 800,
        scrollY: 0,
        setTimeout: (fn, delay) => {
            const id = nextTimerId++;
            timeouts.push({ id, fn, delay, cleared: false });
            return id;
        },
        clearTimeout: (id) => {
            const t = timeouts.find((x) => x.id === id);
            if (t) t.cleared = true;
        },
        setInterval: (fn, delay) => {
            const id = nextTimerId++;
            intervals.push({ id, fn, delay, cleared: false });
            return id;
        },
        clearInterval: (id) => {
            const t = intervals.find((x) => x.id === id);
            if (t) t.cleared = true;
        },
        confirm: () => (confirmQueue.length > 0 ? confirmQueue.shift() : defaultConfirm),
        prompt: () => promptResult,
        addEventListener: () => {},
        getComputedStyle: () => ({ overflowY: 'auto' })
    };

    const sandbox = {
        window: windowObj,
        document,
        location: {
            hostname: 'gemini.google.com',
            origin: 'https://gemini.google.com',
            get pathname() { return pathname; },
            get href() { return 'https://gemini.google.com' + pathname; }
        },
        localStorage: {
            getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
            setItem: (k, v) => localStore.set(k, String(v)),
            removeItem: (k) => localStore.delete(k)
        },
        navigator: {
            locks: {
                request: (_name, _opts, cb) => {
                    lockHeld = true;
                    return Promise.resolve().then(() => cb({})).then(
                        (v) => { lockHeld = false; return v; },
                        (e) => { lockHeld = false; throw e; }
                    );
                }
            }
        },
        MutationObserver: function () {
            this.observe = () => {};
            this.disconnect = () => {};
        },
        KeyboardEvent: function () {},
        Event: function () {},
        Node: { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
        GM_getValue: (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
        GM_setValue: (k, v) => gmStore.set(k, v),
        GM_xmlhttpRequest: (req) => {
            Promise.resolve().then(() => {
                const agentId = req.headers && req.headers['X-Agent-ID'];
                if (agentId) localStore.set('__detected_agent__', agentId);
                relayHandler(req);
            });
        },
        indexedDB: {
            open: () => {
                const db = {
                    objectStoreNames: { contains: () => true },
                    transaction: () => {
                        const tx = {
                            objectStore: () => ({
                                get: () => {
                                    const gReq = { result: null };
                                    Promise.resolve().then(() => { if (gReq.onsuccess) gReq.onsuccess(); });
                                    return gReq;
                                },
                                put: () => ({})
                            })
                        };
                        Promise.resolve().then(() => { if (tx.oncomplete) tx.oncomplete(); });
                        return tx;
                    },
                    close: () => {}
                };
                const req = { result: db };
                Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess(); });
                return req;
            }
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: windowObj.setTimeout,
        clearTimeout: windowObj.clearTimeout,
        setInterval: windowObj.setInterval,
        clearInterval: windowObj.clearInterval,
        Promise,
        Set,
        Map,
        Date,
        Math,
        JSON,
        RegExp,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Error,
        encodeURIComponent
    };

    vm.runInNewContext(code, sandbox);

    return {
        getHolodoxButton: () => holodoxBtn,
        getStatusText: () => (statusEl ? statusEl.textContent : ''),
        setPathname: (p) => { pathname = p; },
        localStore,
        gmStore,
        timeouts,
        intervals,
        injectedTexts,
        isLockHeld: () => lockHeld,
        setConfirmResult: (v) => { defaultConfirm = v; confirmQueue = []; },
        setConfirmSequence: (seq) => { confirmQueue = seq.slice(); },
        setPromptResult: (v) => { promptResult = v; },
        flushNextTimeout: async (filterDelay) => {
            for (let i = timeouts.length - 1; i >= 0; i--) {
                const t = timeouts[i];
                if (!t.cleared && (filterDelay === undefined || t.delay === filterDelay)) {
                    t.cleared = true;
                    await t.fn();
                    await new Promise((r) => setImmediate(r));
                    return true;
                }
            }
            return false;
        },
        tickPromiseQueue: async () => {
            for (let i = 0; i < 6; i++) {
                await new Promise((r) => setImmediate(r));
            }
        }
    };
}

(async () => {
    await runTest('test_version_3_6_7_and_root_copy_match_and_gm_only_token_storage', async () => {
        assert.equal(code, rootCode, 'install/universal.user.js and root braid-lens-universal.user.js must match byte-for-byte');
        assert.match(code, /\/\/ @version\s+3\.6\.7/);
        assert.match(code, /var VERSION = '3\.6\.7';/);
        assert.equal(code.includes('DEFAULT_SEAT_TOKENS'), false, 'No hardcoded seat tokens in userscript');

        // Verify seat token uses GM_getValue / GM_setValue ONLY and never writes to localStorage
        const h = createHarness('/app/thread-1', (req) => {
            req.onload({ status: 200, responseText: '{"joined":true}' });
        });
        h.gmStore.delete('holodox_token_leora');
        h.setPromptResult('gm-only-test-token-12345');
        const btn = h.getHolodoxButton();
        btn.click();
        await h.tickPromiseQueue();
        assert.equal(h.gmStore.get('holodox_token_leora'), 'gm-only-test-token-12345');
        for (const [k, v] of h.localStore.entries()) {
            assert.equal(String(v).includes('gm-only-test-token-12345'), false, 'Seat token must never be stored in localStorage (' + k + ')');
        }
    });

    await runTest('test_join_failure_pauses_and_auto_recovers_to_live', async () => {
        let joinAttempts = 0;
        let pollAttempts = 0;
        const h = createHarness('/app/thread-1', (req) => {
            if (req.url.endsWith('/join')) {
                joinAttempts++;
                if (joinAttempts === 1) {
                    req.onload({ status: 503, responseText: '{"error":"Relay restarting"}' });
                } else {
                    req.onload({ status: 200, responseText: '{"joined":true}' });
                }
            } else if (req.url.includes('/poll')) {
                pollAttempts++;
                req.onload({ status: 200, responseText: '{"messages":[]}' });
            } else {
                req.onload({ status: 200, responseText: '{}' });
            }
        });

        const btn = h.getHolodoxButton();
        assert.ok(btn, 'Holodox button should be mounted');
        assert.equal(btn.textContent, 'Holodox: OFF');

        btn.click();
        await h.tickPromiseQueue();

        // First /join failed -> should be PAUSED (amber), NOT Holodox: OFF, and lock must still be held!
        assert.equal(joinAttempts, 1);
        assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0');
        assert.equal(btn.style.background, '#f59e0b');
        assert.equal(h.isLockHeld(), true);
        assert.match(h.getStatusText(), /PAUSED: Relay \/join retrying/);

        // Flush the 3000ms retry timer -> second /join succeeds -> transitions to Holodox: LIVE automatically!
        const flushed = await h.flushNextTimeout(3000);
        assert.equal(flushed, true);
        await h.tickPromiseQueue();

        assert.equal(joinAttempts, 2);
        assert.equal(btn.textContent, 'Holodox: LIVE');
        assert.equal(h.isLockHeld(), true);
        assert.equal(pollAttempts, 1);
    });

    await runTest('test_cross_conversation_binding_pauses_and_auto_resumes_when_returned', async () => {
        let sentBodies = [];
        let ackedIds = [];
        const h = createHarness('/app/thread-2', (req) => {
            if (req.url.endsWith('/join')) {
                req.onload({ status: 200, responseText: '{"joined":true}' });
            } else if (req.url.endsWith('/send')) {
                sentBodies.push(JSON.parse(req.data));
                req.onload({ status: 200, responseText: '{"id":"reply-1"}' });
            } else if (req.url.endsWith('/ack')) {
                ackedIds.push(JSON.parse(req.data).id);
                req.onload({ status: 200, responseText: '{"id":"msg-99","state":"acknowledged"}' });
            } else if (req.url.includes('/poll')) {
                req.onload({ status: 200, responseText: '{"messages":[]}' });
            } else {
                req.onload({ status: 200, responseText: '{}' });
            }
        });

        // Connect while in /app/thread-2 with clean state
        const btn = h.getHolodoxButton();
        btn.click();
        await h.tickPromiseQueue();
        assert.equal(btn.textContent, 'Holodox: LIVE');

        // Simulate pending work bound to /app/thread-1 while user navigated to /app/thread-2
        h.localStore.set('braid_lens_pending_' + (h.localStore.get('__detected_agent__') || 'muse'), JSON.stringify({
            id: 'msg-99',
            binding: 'https://gemini.google.com/app/thread-1',
            phase: 'reply-ready',
            reply: 'Here is my verified answer.',
            requestId: 'braid-lens-reply-muse-msg-99'
        }));

        // Trigger scheduled poll (600ms) -> sees binding mismatch -> pauses instead of disconnecting!
        await h.flushNextTimeout(600);
        await h.tickPromiseQueue();

        assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0');
        assert.equal(h.isLockHeld(), true);
        assert.match(h.getStatusText(), /Pending work belongs to another conversation/);
        assert.equal(sentBodies.length, 0);

        // User navigates back to /app/thread-1 -> next 2500ms poll auto-resumes to Holodox: LIVE and posts pending!
        h.setPathname('/app/thread-1');
        await h.flushNextTimeout(2500);
        await h.tickPromiseQueue();

        assert.equal(btn.textContent, 'Holodox: LIVE');
        assert.equal(sentBodies.length, 1);
        assert.equal(sentBodies[0].reply_to, 'msg-99');
        assert.deepEqual(ackedIds, ['msg-99']);
    });

    await runTest('test_unverified_submission_pauses_without_killing_seat_and_explicit_disconnect_turns_off', async () => {
        const h = createHarness('/app/thread-1', (req) => {
            if (req.url.endsWith('/join')) {
                req.onload({ status: 200, responseText: '{"joined":true}' });
            } else if (req.url.includes('/poll')) {
                req.onload({ status: 200, responseText: '{"messages":[]}' });
            } else {
                req.onload({ status: 200, responseText: '{}' });
            }
        });

        const btn = h.getHolodoxButton();
        btn.click();
        await h.tickPromiseQueue();
        assert.equal(btn.textContent, 'Holodox: LIVE');

        // Simulate an unverified submission recorded during poll
        h.localStore.set('braid_lens_pending_' + (h.localStore.get('__detected_agent__') || 'muse'), JSON.stringify({
            id: 'msg-unverified',
            binding: 'https://gemini.google.com/app/thread-1',
            phase: 'submission-unverified',
            requestId: 'braid-lens-reply-muse-msg-unverified'
        }));

        await h.flushNextTimeout(600);
        await h.tickPromiseQueue();

        // Seat stays active in PAUSED state (not OFF) and keeps Web Lock + heartbeat interval alive
        assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0');
        assert.equal(h.isLockHeld(), true);
        const activeHeartbeats = h.intervals.filter((i) => i.delay === 15000 && !i.cleared);
        assert.equal(activeHeartbeats.length, 1, '15s heartbeat interval must remain active while paused');

        // Explicit user click on Holodox button when confirm=false (Cancel -> Disconnect) turns seat OFF cleanly
        h.setConfirmResult(false);
        btn.click();
        await h.tickPromiseQueue();

        assert.equal(btn.textContent, 'Holodox: OFF');
        assert.equal(h.isLockHeld(), false);
    });

    await runTest('test_unverified_submission_stays_paused_across_polls_no_send_no_inject_and_resumes_only_on_explicit_ok', async () => {
        let pollCalls = 0;
        let sendCalls = 0;
        let ackCalls = 0;
        let returnQueuedMessages = false;
        const h = createHarness('/app/thread-1', (req) => {
            if (req.url.endsWith('/join')) {
                req.onload({ status: 200, responseText: '{"joined":true}' });
            } else if (req.url.includes('/poll')) {
                pollCalls++;
                req.onload({
                    status: 200,
                    responseText: JSON.stringify({
                        messages: returnQueuedMessages
                            ? [{ id: 'msg-queued-1', from: 'veris', type: 'chat', content: 'Should not be polled or injected while paused' }]
                            : []
                    })
                });
            } else if (req.url.endsWith('/send')) {
                sendCalls++;
                req.onload({ status: 200, responseText: '{"id":"sent-1"}' });
            } else if (req.url.endsWith('/ack')) {
                ackCalls++;
                req.onload({ status: 200, responseText: '{"id":"msg-unverified","state":"acknowledged"}' });
            } else {
                req.onload({ status: 200, responseText: '{}' });
            }
        });

        const btn = h.getHolodoxButton();
        btn.click();
        await h.tickPromiseQueue();
        assert.equal(btn.textContent, 'Holodox: LIVE');
        returnQueuedMessages = true;
        const initialPolls = pollCalls;
        const initialInjected = h.injectedTexts.length;

        // Now record a submission-unverified pending lock in localStorage
        const pendingKey = 'braid_lens_pending_' + (h.localStore.get('__detected_agent__') || 'muse');
        h.localStore.set(pendingKey, JSON.stringify({
            id: 'msg-unverified',
            binding: 'https://gemini.google.com/app/thread-1',
            phase: 'submission-unverified',
            requestId: 'braid-lens-reply-muse-msg-unverified'
        }));

        // Trigger poll -> transitions to PAUSED
        await h.flushNextTimeout(600);
        await h.tickPromiseQueue();
        assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0');
        assert.match(h.getStatusText(), /PAUSED: A previous submission is unverified/);

        // Run 4 consecutive 3000ms poll cycles: must stay PAUSED (no auto-resume!), poll nothing, send nothing, inject nothing
        for (let cycle = 1; cycle <= 4; cycle++) {
            const ran = await h.flushNextTimeout(3000);
            assert.equal(ran, true, '3000ms pause poll timer should fire on cycle ' + cycle);
            await h.tickPromiseQueue();
            assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0', 'Must remain PAUSED on cycle ' + cycle);
            assert.equal(pollCalls, initialPolls, 'Must not call /poll while paused on cycle ' + cycle);
            assert.equal(sendCalls, 0, 'Must not call /send while paused on cycle ' + cycle);
            assert.equal(h.injectedTexts.length, initialInjected, 'Must not inject any message while paused on cycle ' + cycle);
            assert.equal(h.isLockHeld(), true, 'Must keep Web Lock held on cycle ' + cycle);
        }

        // Now user explicitly clicks Holodox: PAUSED button and chooses OK (confirm #1 = true to review, prompt = '' to discard, confirm #2 = true to discard & ack)
        returnQueuedMessages = false;
        h.setConfirmSequence([true, true]);
        h.setPromptResult('');
        btn.click();
        await h.tickPromiseQueue();

        assert.equal(ackCalls, 1, 'Discarded unverified lock must be acknowledged once on explicit OK');
        assert.equal(h.localStore.has(pendingKey), false, 'Pending lock must be removed after explicit confirm');
        assert.equal(btn.textContent, 'Holodox: LIVE', 'Seat must resume LIVE after explicit OK resolution');
        assert.equal(sendCalls, 0, 'Discarded unverified submission must not send a reply');
    });

    await runTest('test_reply_completion_timeout_over_1200_ticks_pauses_instead_of_stopping', async () => {
        let pollReturned = false;
        let sendCalls = 0;
        const h = createHarness('/app/thread-1', (req) => {
            if (req.url.endsWith('/join')) {
                req.onload({ status: 200, responseText: '{"joined":true}' });
            } else if (req.url.includes('/poll')) {
                if (!pollReturned) {
                    pollReturned = true;
                    req.onload({
                        status: 200,
                        responseText: JSON.stringify({
                            messages: [{ id: 'msg-timeout-test', from: 'veris', type: 'chat', content: 'Please audit this.' }]
                        })
                    });
                } else {
                    req.onload({ status: 200, responseText: '{"messages":[]}' });
                }
            } else if (req.url.endsWith('/send')) {
                sendCalls++;
                req.onload({ status: 200, responseText: '{"id":"sent-1"}' });
            } else {
                req.onload({ status: 200, responseText: '{}' });
            }
        });

        const btn = h.getHolodoxButton();
        btn.click();
        await h.tickPromiseQueue();
        assert.equal(btn.textContent, 'Holodox: LIVE');

        // Advance injectTextAndSend timers (150ms submitWhenEnabled + 150ms verifyCleared)
        await h.flushNextTimeout(150);
        await h.flushNextTimeout(150);
        await h.tickPromiseQueue();

        assert.equal(h.injectedTexts.length, 1, 'Incoming Hall message should be injected once');
        assert.match(h.injectedTexts[0], /Please audit this/);

        // Find the 500ms waitForReplyCompletion interval
        const replyInterval = h.intervals.find((i) => i.delay === 500 && !i.cleared);
        assert.ok(replyInterval, 'waitForReplyCompletion 500ms interval must be active');

        // Tick 1200 times -> still waiting, seat still LIVE
        for (let tick = 1; tick <= 1200; tick++) {
            replyInterval.fn();
        }
        assert.equal(replyInterval.cleared, false, 'Interval should still be active at tick 1200');
        assert.equal(btn.textContent, 'Holodox: LIVE');

        // Tick 1201 -> checkCount > 1200 -> callback(null) -> pauseSeat() instead of stopSeat()!
        replyInterval.fn();
        await h.tickPromiseQueue();

        assert.equal(replyInterval.cleared, true, 'waitForReplyCompletion interval must clear at tick 1201');
        assert.equal(btn.textContent, 'Holodox: PAUSED \u26a0', 'Seat must transition to Holodox: PAUSED \u26a0, NOT Holodox: OFF');
        assert.equal(btn.style.background, '#f59e0b');
        assert.match(h.getStatusText(), /PAUSED: Reply completion timed out\. Click Holodox to discard or review\./);
        assert.equal(h.isLockHeld(), true, 'Web Lock must remain held when reply completion times out');
        assert.equal(sendCalls, 0, 'Timed-out reply must not call /send');
    });

    console.log('ALL 6 PR-12 TESTS PASSED');
})().catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
