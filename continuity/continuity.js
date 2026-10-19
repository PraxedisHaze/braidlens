/* Penni continuity v1: local, opt-in, ChatGPT conversation capture. */
var PenniContinuity = (function () {
    'use strict';
    var ROOT = 'runtime/penni-continuity';
    var MAX_BYTES = 10000000;
    function mergeMessages(existing, incoming) {
        var result = existing.slice();
        incoming.forEach(function (message) {
            var index = result.findIndex(function (old) { return old.id === message.id; });
            if (index < 0) result.push(message);
            else if (result[index].text !== message.text) {
                result[index] = Object.assign({}, result[index], message, {
                    firstObservedAt: result[index].firstObservedAt,
                    revised: true
                });
            }
        });
        return result;
    }
    function create(env) {
        var button, status, timer, running = false, stopped = false;
        var previousSignature = '', stableSince = 0, savedSignatures = {};
        function identity() {
            if (env.platform !== 'chatgpt') return null;
            var match = location.pathname.match(/\/c\/([A-Za-z0-9_-]+)(?:\/|$)/);
            if (!match) return null;
            return { id: match[1], key: 'penni_capture_chatgpt_' + match[1],
                sourceUrl: location.origin + location.pathname,
                file: ROOT + '/conversations/chatgpt/' + match[1] + '.json' };
        }
        function say(text) { if (status) status.textContent = text; }
        function opted(id) { return env.get(id.key + '_enabled', false) === true; }
        async function folder() {
            var handle = await env.loadHandle();
            if (!handle) throw new Error('Bind your apps folder first.');
            if (handle.name.toLowerCase() !== 'apps') throw new Error('Continuity requires the apps folder, not a different folder.');
            if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('Folder permission needed: click Bind Folder.');
            }
            return handle;
        }
        async function fileHandle(root, path, create) {
            var parts = path.split('/');
            for (var i = 0; i < parts.length - 1; i++) root = await root.getDirectoryHandle(parts[i], { create: create });
            return root.getFileHandle(parts[parts.length - 1], { create: create });
        }
        async function read(root, path) {
            try {
                var handle = await fileHandle(root, path, false);
                var file = await handle.getFile();
                if (file.size > MAX_BYTES) throw new Error('Record exceeds the first-slice size limit. Existing data preserved.');
                return JSON.parse(await file.text());
            } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
        }
        async function writeVerified(root, path, data) {
            var text = JSON.stringify(data, null, 2);
            if (new Blob([text]).size > MAX_BYTES) throw new Error('Record size limit reached. Existing data preserved.');
            var handle = await fileHandle(root, path, true);
            var writable = await handle.createWritable();
            try { await writable.write(text); await writable.close(); }
            catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
            var actual = await (await handle.getFile()).text();
            if (actual !== text) throw new Error('Save readback differs. Pending capture retained.');
        }
        async function digest(text) {
            var hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
            return Array.from(new Uint8Array(hash)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
        }
        async function collect(id) {
            var roots = Array.from(document.querySelectorAll('[data-message-author-role]'));
            var counts = {}, result = [];
            for (var node of roots) {
                var role = node.getAttribute('data-message-author-role');
                if (role !== 'user' && role !== 'assistant') continue;
                var text = (node.innerText || node.textContent || '').trim();
                if (!text) continue;
                var nativeId = node.getAttribute('data-message-id');
                var fallback = await digest(role + '\n' + text);
                counts[fallback] = (counts[fallback] || 0) + 1;
                result.push({ id: nativeId ? 'message-' + nativeId : 'text-' + fallback + '-' + counts[fallback],
                    identity: nativeId ? 'provider-message-id' : 'text-and-loaded-occurrence',
                    role: role, text: text, sourceUrl: id.sourceUrl, firstObservedAt: new Date().toISOString() });
            }
            return result;
        }
        async function flush(id, captured) {
            if (!navigator.locks) throw new Error('This browser lacks the cross-tab save lock; capture paused.');
            return navigator.locks.request(id.key, { ifAvailable: true }, async function (lock) {
                if (!lock) { say('Another tab is saving this conversation.'); return false; }
                var pending = env.get(id.key + '_pending', []);
                if (!Array.isArray(pending)) throw new Error('Pending queue format invalid; existing queue preserved.');
                pending = mergeMessages(pending, captured);
                if (new Blob([JSON.stringify(pending)]).size > 1000000 || pending.length > 200) {
                    throw new Error('Capture queue full. Existing pending messages retained; bind the folder and retry.');
                }
                env.set(id.key + '_pending', pending);
                say('Waiting to save ' + pending.length + ' loaded messages.');
                var root = await folder();
                var old = await read(root, id.file);
                if (old && (old.schema !== 'penni-conversation-v1' || old.conversationId !== id.id || !Array.isArray(old.messages))) {
                    throw new Error('Saved conversation format differs; existing record preserved.');
                }
                var merged = mergeMessages(old ? old.messages : [], pending);
                if (old && JSON.stringify(merged) === JSON.stringify(old.messages)) {
                    env.set(id.key + '_pending', []);
                    say('Saved locally · ' + merged.length + ' messages · loaded history only'); return true;
                }
                var data = { schema: 'penni-conversation-v1', provider: 'chatgpt', conversationId: id.id,
                    sourceUrl: id.sourceUrl, title: document.title, coverage: 'observed-loaded-messages-only',
                    savedAt: new Date().toISOString(), messages: merged };
                await writeVerified(root, id.file, data);
                if (!identity() || identity().key !== id.key) return;
                env.set(id.key + '_pending', []);
                say('Saved locally · ' + merged.length + ' messages · ' + new Date().toLocaleTimeString());
                return true;
            });
        }
        async function tick(force) {
            var id = identity();
            if (button) button.textContent = id && opted(id) ? 'Capture: ON' : 'Capture: OFF';
            if (!id || !opted(id) || running || stopped) return;
            if (env.generating()) { stableSince = 0; say('Waiting for reply to finish.'); return; }
            running = true;
            try {
                var captured = await collect(id);
                if (!captured.length) { say('No explicitly identified messages found.'); return; }
                var signature = await digest(JSON.stringify(captured.map(function (m) { return [m.id, m.text]; })));
                if (signature !== previousSignature) { previousSignature = signature; stableSince = Date.now(); if (!force) return; }
                if (!force && Date.now() - stableSince < 3000) return;
                if (!identity() || identity().key !== id.key || !opted(id)) return;
                if (!force && savedSignatures[id.key] === signature && !env.get(id.key + '_pending', []).length) return;
                var committed = await flush(id, captured);
                if (committed && !env.get(id.key + '_pending', []).length) savedSignatures[id.key] = signature;
            } catch (error) { say('Not saved · ' + error.message); }
            finally { running = false; }
        }
        async function showBrief() {
            try {
                var root = await folder();
                var brief = await read(root, ROOT + '/return-brief.json');
                if (!brief || brief.schema !== 'penni-return-brief-v1' || typeof brief.text !== 'string') {
                    throw new Error('No valid return brief is saved yet.');
                }
                var old = document.getElementById('penni-return-brief'); if (old) old.remove();
                var dialog = document.createElement('dialog'); dialog.id = 'penni-return-brief';
                dialog.style.cssText = 'max-width:680px;width:85vw;background:#111827;color:#f8fafc;border:2px solid #94a3b8;padding:24px;border-radius:12px;';
                var heading = document.createElement('h2'); heading.textContent = 'Where were we?';
                var date = document.createElement('p'); date.textContent = 'Recorded ' + brief.updatedAt + ' · dated briefing, not live status';
                var text = document.createElement('textarea'); text.readOnly = true; text.setAttribute('aria-label', 'Penni return brief');
                text.value = brief.text; text.style.cssText = 'width:100%;height:48vh;box-sizing:border-box;background:#0b1220;color:#f8fafc;font:16px/1.5 system-ui;padding:12px;';
                var close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', function () { dialog.close(); dialog.remove(); });
                dialog.append(heading, date, text, close); document.body.appendChild(dialog); dialog.showModal();
            } catch (error) { say('Brief unavailable · ' + error.message); }
        }
        function mount(body) {
            if (env.platform !== 'chatgpt' || body.querySelector('#penni-capture-button')) return;
            button = document.createElement('button'); button.id = 'penni-capture-button'; button.textContent = 'Capture: OFF';
            button.title = 'Enable saving loaded messages in this conversation to your bound apps folder. No messages are sent.';
            button.addEventListener('click', async function () {
                var id = identity();
                if (!id) { say('Open an existing ChatGPT conversation first.'); return; }
                var enabled = !opted(id); env.set(id.key + '_enabled', enabled);
                button.textContent = enabled ? 'Capture: ON' : 'Capture: OFF';
                if (enabled) { say('Capture enabled for this conversation, including loaded history.'); await tick(true); }
                else say('Capture paused. Saved records and any pending messages retained.');
            });
            var brief = document.createElement('button'); brief.textContent = 'Where were we?'; brief.id = 'penni-return-button';
            brief.addEventListener('click', showBrief);
            status = document.createElement('div'); status.id = 'penni-continuity-status'; status.setAttribute('role', 'status');
            status.style.cssText = 'grid-column:1/-1;font:12px/1.4 system-ui;color:#e2e8f0;white-space:normal;';
            [button, brief].forEach(function (b) { b.style.cssText = 'padding:7px;background:#1e293b;color:#f8fafc;border:1px solid #94a3b8;border-radius:4px;cursor:pointer;'; });
            body.append(button, brief, status); say('Continuity capture off · local folder storage');
            if (!timer) timer = window.setInterval(function () { tick(false); }, 5000);
        }
        return { mount: mount, tick: tick, stop: function () { stopped = true; clearInterval(timer); } };
    }
    return { create: create, mergeMessages: mergeMessages };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PenniContinuity;


