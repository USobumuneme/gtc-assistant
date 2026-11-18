/* =====================================================================
   GTC Assistant — core helpers, router, AI-service client
   ===================================================================== */
(function (global) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const fmt = n => new Intl.NumberFormat('en-GB').format(Math.round(n));
  const money = n => { const a = Math.abs(n); const s = n < 0 ? '-' : ''; return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'bn' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(1) + 'm' : a >= 1e3 ? s + '$' + (a / 1e3).toFixed(0) + 'k' : s + '$' + fmt(a); };
  const pct = (n, d = 0) => (n > 0 ? '+' : '') + n.toFixed(d) + '%';
  const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00Z'); return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

  function toast(msg, ms = 3200) {
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  }
  function download(name, content, type = 'text/csv;charset=utf-8') {
    const blob = new Blob([type.startsWith('text/csv') ? '﻿' + content : content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function confBar(c) { const l = NLP.confidenceLabel(c); return `<span class="conf" title="AI confidence ${Math.round(c * 100)}%"><span class="bar ${l}"><i style="width:${Math.round(c * 100)}%"></i></span>${l}</span>`; }
  function aiNote(text) { return `<div class="ai-note">${icon('spark')}<span>${text || 'AI-generated suggestion. Please check it against the original statement before relying on it.'}</span></div>`; }
  function highlight(text, words) {
    let out = esc(text);
    (words || []).filter(w => w && w.length > 2).slice(0, 12).forEach(w => {
      const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }

  /* ---------- Charts ---------- */
  const charts = [];
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function palette() { return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(css); }
  function chart(canvas, cfg) {
    if (!global.Chart) { canvas.parentElement.innerHTML = '<p class="muted small">Charts could not load (no internet connection?).</p>'; return null; }
    Chart.defaults.font.family = css('--font') || 'sans-serif';
    Chart.defaults.color = css('--ink-2');
    Chart.defaults.borderColor = css('--line');
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: {} }, cfg.options || {});
    cfg.options.plugins.legend = Object.assign({ display: false }, cfg.options.plugins.legend || {});
    cfg.options.plugins.tooltip = Object.assign({ backgroundColor: css('--ink'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 10, cornerRadius: 8 }, cfg.options.plugins.tooltip || {});
    const c = new Chart(canvas, cfg); charts.push(c); return c;
  }
  function clearCharts() { while (charts.length) { try { charts.pop().destroy(); } catch (e) { } } }
  function legend(items) { return `<div class="legend">${items.map(([l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`; }

  /* ---------- Optional AI service (Netlify functions) ---------- */
  const API = {
    status: { checked: false, llm: false, model: '', comtrade: false, comtradeMode: '' },
    async health() {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (!r.ok) throw 0; const j = await r.json();
        this.status = { checked: true, llm: !!j.llm, model: j.model || '', fastModel: j.fastModel || '', requiresCode: !!j.requiresCode, comtrade: true, comtradeMode: j.comtrade || 'preview' };
      } catch (e) { this.status = { checked: true, llm: false, comtrade: false }; }
      return this.status;
    },
    async flows(params) {
      const r = await fetch('/api/trade-flows?' + new URLSearchParams(params), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Trade data service unavailable.');
      return j;
    }
  };

  /* ---------- Router ---------- */
  const routes = {};
  function route(name, fn) { routes[name] = fn; }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
  }
  async function render() {
    const r = parseHash();
    clearCharts();
    $$('.nav a').forEach(a => a.removeAttribute('aria-current'));
    const navName = r.name === 'concern' ? 'concerns' : r.name;
    const link = $(`.nav a[data-nav="${navName}"]`); if (link) link.setAttribute('aria-current', 'page');
    $('#side').classList.remove('open'); $('#scrim').classList.remove('open');
    const view = $('#view');
    const fn = routes[r.name] || routes.home;
    try { await fn(view, r); }
    catch (e) { console.error(e); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to home</a></div>`; }
    if (!r.keepScroll) window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }
  function go(path) { if (location.hash === '#' + path) render(); else location.hash = path; }

  global.UI = { $, $$, esc, icon, fmt, money, pct, fmtDate, toast, download, confBar, aiNote, highlight, chart, clearCharts, palette, css, legend, API, route, render, go };
})(window);
