/**
 * Vernier Scrubber Appling — v1.0.0
 * 
 * Standalone, zero-dependency fisheye minimap scrubber for long chat logs,
 * multi-agent council halls, and multi-turn conversations.
 * 
 * Capabilities:
 * - Cosine-squared fisheye turn spreading on hover.
 * - Dynamic mousewheel magnification zoom (1.5x - 6.0x).
 * - Live viewport indicator reflecting container scroll state.
 * - Floating preview popover with speaker badge, turn index (#X/Total), and text snippet.
 * - Click-to-jump with smooth scrolling and temporary card highlight pulse.
 * - MutationObserver-backed auto-reindexing as new messages arrive.
 * 
 * Usage:
 *   <script src="vernier_scrubber_appling.js"></script>
 *   VernierScrubber.attach({
 *       container: '#chat',
 *       turnSelector: '.message'
 *   });
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.VernierScrubber = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var instances = [];

    function injectStyles() {
        if (document.getElementById('vernier-scrubber-appling-css')) return;
        var style = document.createElement('style');
        style.id = 'vernier-scrubber-appling-css';
        style.textContent = `
            .vernier-track {
                position: absolute;
                top: 0;
                bottom: 0;
                right: 0;
                width: 14px;
                z-index: 999;
                background: rgba(10, 18, 28, 0.7);
                border-left: 1px solid rgba(255, 255, 255, 0.12);
                backdrop-filter: blur(6px);
                transition: width 0.18s cubic-bezier(0.16, 1, 0.3, 1), background 0.18s ease;
                user-select: none;
                box-sizing: border-box;
                cursor: pointer;
            }
            .vernier-track:hover,
            .vernier-track.active-lens {
                width: 64px;
                background: rgba(8, 14, 25, 0.95);
                border-left-color: var(--vernier-accent, #fbbf24);
                box-shadow: -4px 0 18px rgba(0, 0, 0, 0.7);
            }
            .vernier-vp {
                position: absolute;
                left: 1px;
                right: 1px;
                top: 0;
                height: 36px;
                background: rgba(255, 255, 255, 0.12);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 4px;
                pointer-events: none;
                transition: top 0.05s linear, height 0.08s ease;
            }
            .vernier-tick {
                position: absolute;
                left: 2px;
                right: 2px;
                height: 3px;
                border-radius: 2px;
                pointer-events: none;
                transition: height 0.08s, left 0.08s, right 0.08s, opacity 0.08s;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                padding: 0 4px;
                overflow: hidden;
            }
            .vernier-tick-label {
                display: none;
                font-size: 0.62rem;
                font-weight: 800;
                font-family: ui-monospace, monospace;
                color: #fff;
                white-space: nowrap;
                letter-spacing: -0.02em;
            }
            .vernier-track.active-lens .vernier-tick.in-lens {
                height: 18px;
                border-radius: 4px;
                opacity: 1;
                left: 4px;
                right: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.8);
            }
            .vernier-track.active-lens .vernier-tick.in-lens .vernier-tick-label {
                display: block;
            }
            .vernier-popover {
                position: fixed;
                width: 290px;
                background: rgba(9, 14, 24, 0.98);
                border: 1.5px solid var(--vernier-accent, #fbbf24);
                border-radius: 8px;
                padding: 10px 14px;
                color: #f1f5f9;
                font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85), 0 0 16px rgba(251, 191, 36, 0.25);
                pointer-events: none;
                opacity: 0;
                transform: translateX(-8px);
                transition: opacity 0.12s ease, transform 0.12s ease;
                z-index: 99999;
                backdrop-filter: blur(12px);
            }
            .vernier-popover.open {
                opacity: 1;
                transform: translateX(0);
            }
            .vernier-pop-hdr {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 5px;
                padding-bottom: 4px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .vernier-pop-speaker {
                font-weight: 700;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .vernier-pop-meta {
                font-family: monospace;
                font-size: 10px;
                color: #94a3b8;
            }
            .vernier-pop-snippet {
                color: #cbd5e1;
                font-size: 11px;
                line-height: 1.35;
                word-break: break-word;
                max-height: 58px;
                overflow: hidden;
            }
            .vernier-highlight {
                outline: 3px solid var(--vernier-accent, #7bd7c6) !important;
                outline-offset: 4px !important;
                border-radius: 8px !important;
                box-shadow: 0 0 22px rgba(123, 215, 198, 0.6) !important;
                transition: outline 0.2s ease, box-shadow 0.2s ease !important;
            }
        `;
        document.head.appendChild(style);
    }

    function VernierInstance(options) {
        options = options || {};
        this.options = options;
        this.scrollEl = typeof options.container === 'string' ?
            document.querySelector(options.container) :
            (options.container || document.documentElement);

        if (!this.scrollEl) {
            console.warn('[VernierScrubber] Container not found:', options.container);
            return;
        }

        this.turnSelector = options.turnSelector || '.message, article, [data-message-author-role], div[class*="message"]';
        this.accent = options.accentColor || '#7bd7c6';
        this.mag = options.initialZoom || 3.0;
        this.radius = options.radius || 75;
        this.activeY = null;
        this.cachedTurns = [];

        this.init();
    }

    VernierInstance.prototype.init = function () {
        injectStyles();
        var self = this;

        // Container must be relatively positioned so absolute track snaps inside it
        var style = window.getComputedStyle(this.scrollEl);
        if (style.position === 'static' && this.scrollEl !== document.documentElement && this.scrollEl !== document.body) {
            this.scrollEl.style.position = 'relative';
        }

        // Create Track
        this.track = document.createElement('div');
        this.track.className = 'vernier-track';
        this.track.style.setProperty('--vernier-accent', this.accent);
        this.track.title = 'Vernier Fisheye Scrubber: Wheel to zoom turns, click to jump';

        // Viewport indicator
        this.vp = document.createElement('div');
        this.vp.className = 'vernier-vp';
        this.track.appendChild(this.vp);

        // Popover
        this.popover = document.createElement('div');
        this.popover.className = 'vernier-popover';
        this.popover.style.setProperty('--vernier-accent', this.accent);

        var hdr = document.createElement('div');
        hdr.className = 'vernier-pop-hdr';
        this.popSpeaker = document.createElement('span');
        this.popSpeaker.className = 'vernier-pop-speaker';
        this.popMeta = document.createElement('span');
        this.popMeta.className = 'vernier-pop-meta';
        hdr.appendChild(this.popSpeaker);
        hdr.appendChild(this.popMeta);

        this.popSnippet = document.createElement('div');
        this.popSnippet.className = 'vernier-pop-snippet';

        this.popover.appendChild(hdr);
        this.popover.appendChild(this.popSnippet);

        // Attach elements
        if (this.options && this.options.trackParent) {
            var tp = typeof this.options.trackParent === 'string' ? document.querySelector(this.options.trackParent) : this.options.trackParent;
            if (tp) {
                var tpStyle = window.getComputedStyle(tp);
                if (tpStyle.position === 'static' && tp !== document.documentElement && tp !== document.body) {
                    tp.style.position = 'relative';
                }
                tp.appendChild(this.track);
                if (this.options.topOffset) this.track.style.top = this.options.topOffset;
                if (this.options.bottomOffset) this.track.style.bottom = this.options.bottomOffset;
            } else {
                this.scrollEl.appendChild(this.track);
            }
        } else if (this.scrollEl === document.documentElement || this.scrollEl === document.body) {
            this.track.style.position = 'fixed';
            this.track.style.top = '56px';
            this.track.style.bottom = '40px';
            document.body.appendChild(this.track);
        } else {
            this.scrollEl.appendChild(this.track);
        }
        document.body.appendChild(this.popover);

        // Continuous Drag & Interactive Scrubbing
        var isDragging = false;
        function handleDrag(e) {
            if (!isDragging) return;
            var rect = self.track.getBoundingClientRect();
            var y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
            self.activeY = y;
            var sh = self.scrollEl.scrollHeight || 1;
            var ch = self.scrollEl.clientHeight || 1;
            var trackH = rect.height || 1;
            var scrollRatio = y / trackH;
            self.scrollEl.scrollTop = scrollRatio * Math.max(0, sh - ch);
            self.renderTicks();
        }

        this.track.addEventListener('mousedown', function (e) {
            isDragging = true;
            self.track.classList.add('active-lens');
            handleDrag(e);
            function onMove(ev) { handleDrag(ev); }
            function onUp() {
                isDragging = false;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (!self.track.matches(':hover')) {
                    self.track.classList.remove('active-lens');
                    self.activeY = null;
                    self.popover.classList.remove('open');
                    self.renderTicks();
                }
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        // Events
        this.track.addEventListener('mouseenter', function () {
            self.track.classList.add('active-lens');
            self.refresh();
        });

        this.track.addEventListener('mouseleave', function () {
            if (isDragging) return;
            self.track.classList.remove('active-lens');
            self.activeY = null;
            self.popover.classList.remove('open');
            self.renderTicks();
        });

        this.track.addEventListener('mousemove', function (e) {
            if (isDragging) return;
            var rect = self.track.getBoundingClientRect();
            self.activeY = e.clientY - rect.top;
            self.renderTicks();
        });

        this.track.addEventListener('wheel', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.deltaY < 0) {
                self.mag = Math.min(self.mag + 0.35, 6.0);
            } else {
                self.mag = Math.max(self.mag - 0.35, 1.5);
            }
            self.renderTicks();
        }, { passive: false });

        this.track.addEventListener('click', function (e) {
            var rect = self.track.getBoundingClientRect();
            var clickY = e.clientY - rect.top;
            self.jumpToY(clickY);
        });

        // Scroll listener
        this.scrollEl.addEventListener('scroll', function () {
            self.updateViewport();
        }, { passive: true });

        // MutationObserver to auto-update when new turns arrive
        this.observer = new MutationObserver(function () {
            self.refresh();
        });
        this.observer.observe(this.scrollEl, { childList: true, subtree: true });

        this.refresh();
    };

    VernierInstance.prototype.extractTurnData = function (node, index, total) {
        var speaker = 'Agent';
        var color = this.accent;

        var agentAttr = node.getAttribute('data-agent');
        var roleAttr = node.getAttribute('data-message-author-role');

        if (agentAttr) {
            speaker = agentAttr.toUpperCase();
            var computedAccent = window.getComputedStyle(node).getPropertyValue('--accent');
            if (computedAccent && computedAccent.trim()) color = computedAccent.trim();
        } else if (roleAttr) {
            speaker = roleAttr === 'user' ? 'User' : 'Assistant';
            color = roleAttr === 'user' ? '#f97316' : this.accent;
        } else {
            var badge = node.querySelector('.speaker-badge, [class*="speaker"], [class*="author"]');
            if (badge) {
                speaker = (badge.innerText || badge.textContent || '').trim();
            } else {
                speaker = (index % 2 === 0) ? 'User' : 'Assistant';
            }
        }

        var text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        return {
            node: node,
            index: index + 1,
            total: total,
            speaker: speaker,
            color: color,
            snippet: text.slice(0, 140) + (text.length > 140 ? '...' : '')
        };
    };

    VernierInstance.prototype.updateViewport = function () {
        if (!this.vp || !this.track) return;
        var sh = this.scrollEl.scrollHeight || 1;
        var ch = this.scrollEl.clientHeight || 1;
        var st = this.scrollEl.scrollTop || 0;

        var topPct = (st / sh) * 100;
        var hPct = Math.max((ch / sh) * 100, 3.5);
        this.vp.style.top = topPct + '%';
        this.vp.style.height = hPct + '%';
    };

    VernierInstance.prototype.renderTicks = function () {
        if (!this.track) return;
        var trackH = this.track.clientHeight;
        var sh = this.scrollEl.scrollHeight || 1;
        if (trackH <= 0 || sh <= 0) return;

        this.track.replaceChildren();
        if (this.vp) this.track.appendChild(this.vp);

        var frag = document.createDocumentFragment();
        var closest = null;
        var closestDist = Infinity;
        var st = this.scrollEl.scrollTop || 0;
        var scrollRect = this.scrollEl.getBoundingClientRect();

        for (var i = 0; i < this.cachedTurns.length; i++) {
            var item = this.cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (nodeRect.top - scrollRect.top) + st;
            var baseY = (nodeTop / sh) * trackH;

            var renderY = baseY;
            var inLens = false;

            if (this.activeY !== null) {
                var dist = baseY - this.activeY;
                var absDist = Math.abs(dist);
                if (absDist < this.radius) {
                    inLens = true;
                    var norm = absDist / this.radius;
                    var envelope = Math.pow(Math.cos((Math.PI * norm) / 2), 2);
                    var displacement = dist * (1 + (this.mag - 1) * 0.45 * envelope);
                    renderY = this.activeY + displacement;

                    if (absDist < closestDist) {
                        closestDist = absDist;
                        closest = { item: item, renderY: renderY };
                    }
                }
            }

            var tick = document.createElement('div');
            tick.className = 'vernier-tick' + (inLens ? ' in-lens' : '');
            tick.style.setProperty('--tick-color', item.color);
            tick.style.background = item.color;
            tick.style.top = Math.max(2, Math.min(renderY, trackH - (inLens ? 20 : 5))) + 'px';

            var label = document.createElement('span');
            label.className = 'vernier-tick-label';
            label.textContent = item.speaker.slice(0, 5).toUpperCase() + ' #' + item.index;
            tick.appendChild(label);

            frag.appendChild(tick);
        }

        this.track.appendChild(frag);

        if (closest && this.activeY !== null) {
            this.popover.classList.add('open');
            var trackRect = this.track.getBoundingClientRect();
            var boundedY = Math.max(20, Math.min(trackRect.top + closest.renderY - 20, window.innerHeight - 130));
            this.popover.style.top = boundedY + 'px';

            var placement = (this.options && this.options.popoverPlacement) || 'right';
            if (placement === 'right') {
                this.popover.style.left = (trackRect.right + 14) + 'px';
                this.popover.style.right = 'auto';
            } else {
                this.popover.style.right = (window.innerWidth - trackRect.left + 14) + 'px';
                this.popover.style.left = 'auto';
            }
            this.popover.style.borderLeftColor = closest.item.color;

            this.popSpeaker.textContent = '● ' + closest.item.speaker;
            this.popSpeaker.style.color = closest.item.color;
            this.popMeta.textContent = '#' + closest.item.index + '/' + closest.item.total + ' (' + this.mag.toFixed(1) + 'x)';
            this.popSnippet.textContent = closest.item.snippet;
        } else {
            this.popover.classList.remove('open');
        }
    };

    VernierInstance.prototype.refresh = function () {
        var rawNodes = Array.from(this.scrollEl.querySelectorAll(this.turnSelector));
        var self = this;
        var visibleNodes = rawNodes.filter(function (n) {
            return (n.offsetWidth > 0 || n.offsetHeight > 0) && !n.classList.contains('vernier-track');
        });

        this.cachedTurns = visibleNodes.map(function (node, idx) {
            return self.extractTurnData(node, idx, visibleNodes.length);
        });

        this.updateViewport();
        this.renderTicks();
    };

    VernierInstance.prototype.jumpToY = function (clickY) {
        var trackH = this.track.clientHeight;
        var sh = this.scrollEl.scrollHeight || 1;
        if (trackH <= 0 || sh <= 0 || !this.cachedTurns.length) return;

        var closest = null;
        var closestDist = Infinity;
        var st = this.scrollEl.scrollTop || 0;
        var scrollRect = this.scrollEl.getBoundingClientRect();

        for (var i = 0; i < this.cachedTurns.length; i++) {
            var item = this.cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (nodeRect.top - scrollRect.top) + st;
            var baseY = (nodeTop / sh) * trackH;
            var d = Math.abs(baseY - clickY);
            if (d < closestDist) {
                closestDist = d;
                closest = item;
            }
        }

        if (closest && closest.node) {
            closest.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            closest.node.classList.remove('vernier-highlight');
            void closest.node.offsetWidth;
            closest.node.classList.add('vernier-highlight');
            var self = this;
            window.setTimeout(function () {
                closest.node.classList.remove('vernier-highlight');
            }, 1800);
        }
    };

    // Public API
    return {
        attach: function (options) {
            var inst = new VernierInstance(options);
            instances.push(inst);
            return inst;
        },
        instances: instances
    };
}));
