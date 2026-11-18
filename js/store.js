/* =====================================================================
   GTC Assistant — Data store
   Loads trade-concern CSV files (sample or user-supplied), normalises
   them, enriches each concern with AI analysis and keeps user review
   decisions in the browser (IndexedDB, with a memory fallback).
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- Tiny IndexedDB key-value wrapper (fails soft) ---------- */
  const KV = (() => {
    let dbp = null; const mem = new Map();
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res) => {
        try {
          const r = indexedDB.open('gtc-assistant', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result); r.onerror = () => res(null);
        } catch (e) { res(null); }
      });
      return dbp;
    }
    async function get(k) {
      const db = await open(); if (!db) return mem.get(k);
      return new Promise(res => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(mem.get(k)); } catch (e) { res(mem.get(k)); } });
    }
    async function set(k, v) {
      mem.set(k, v); const db = await open(); if (!db) return;
      return new Promise(res => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; } catch (e) { res(); } });
    }
    async function del(k) { mem.delete(k); const db = await open(); if (!db) return; try { db.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch (e) { } }
    return { get, set, del };
  })();

  /* ---------- Column auto-detection (works with Trade Concerns Database exports) ---------- */
  const COLS = {
    id: ['imsid', 'ims id', 'id', 'concern id', 'concernid', 'stc id', 'stc number', 'tc id', 'number', 'ref'],
    committee: ['area', 'committee', 'body', 'council', 'type'],
    date: ['meetingdate', 'meeting date', 'date', 'date raised', 'first raised', 'datefirstraised'],
    raising: ['raisingmember', 'raising member', 'raising members', 'member', 'raised by', 'raisedby', 'country'],
    responding: ['respondingmember', 'responding member', 'maintaining member', 'maintainingmember', 'member maintaining', 'target', 'against'],
    title: ['title', 'concern title', 'subject', 'measure', 'name'],
    statement: ['statementsubmitted', 'statement submitted', 'statement'],
    summary: ['summary', 'description', 'text', 'narrative', 'details', 'content'],
    hs: ['hs', 'hs code', 'hscode', 'hs codes', 'products hs'],
    status: ['status', 'state', 'resolved']
  };
  function detectColumns(headers) {
    const map = {}; const low = headers.map(h => String(h).trim().toLowerCase());
    for (const [key, names] of Object.entries(COLS)) {
      let idx = low.findIndex(h => names.includes(h));
      if (idx < 0) idx = low.findIndex(h => names.some(n => h.includes(n)));
      if (idx >= 0 && !Object.values(map).includes(headers[idx])) map[key] = headers[idx];
    }
    return map;
  }

  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); // dd/mm/yyyy (WTO style)
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{4})$/); if (m) return new Date(Date.UTC(+m[1], 0, 1));
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  const iso = d => d ? d.toISOString().slice(0, 10) : '';

  /** Merge title + statement + summary without repeating text. */
  function mergeText(title, statement, summary) {
    const parts = [];
    const add = t => { t = String(t || '').trim(); if (!t) return; if (parts.some(p => p.includes(t.slice(0, 160)))) return; parts.push(t); };
    add(summary); add(statement);
    const body = parts.join(' ');
    title = String(title || '').trim();
    return title && !body.startsWith(title) ? title + '. ' + body : body;
  }

  /* ---------- Build concerns from rows ---------- */
  function buildConcerns(rows, colmap) {
    const g = new Map();
    rows.forEach((r, i) => {
      const id = String(r[colmap.id] || '').trim() || ('row-' + (i + 1));
      const date = parseDate(r[colmap.date]);
      const st = {
        member: NLP.canonMember(r[colmap.raising]),
        date: iso(date), dateObj: date,
        text: mergeText(r[colmap.title], r[colmap.statement], r[colmap.summary])
      };
      if (!g.has(id)) g.set(id, { id, committee: String(r[colmap.committee] || '').trim().toUpperCase() || '—', title: String(r[colmap.title] || '').trim(), titleGiven: String(r[colmap.title] || '').trim(), respondingGiven: NLP.canonMember(r[colmap.responding]), hsGiven: String(r[colmap.hs] || '').trim(), status: String(r[colmap.status] || '').trim(), statements: [] });
      const c = g.get(id);
      // skip exact duplicate statements
      if (!c.statements.some(s => s.member === st.member && s.text === st.text && s.date === st.date)) c.statements.push(st);
    });
    const out = [];
    for (const c of g.values()) {
      c.statements.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const first = c.statements[0] || {};
      c.lead = first.member || 'Unknown';
      c.raisers = [...new Set(c.statements.map(s => s.member).filter(Boolean))];
      c.date = first.date; c.year = first.dateObj ? first.dateObj.getUTCFullYear() : null;
      c.lastDate = c.statements[c.statements.length - 1].date;
      c.meetings = [...new Set(c.statements.map(s => s.date).filter(Boolean))].length;
      c.text = c.statements.map(s => s.text).join(' ');
      enrich(c);
      out.push(c);
    }
    // Flag exact duplicate records (same text recorded under different IDs)
    const seen = new Map();
    out.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).forEach(c => {
      const k = c.text.replace(/\W+/g, ' ').toLowerCase().trim();
      if (seen.has(k)) c.duplicateOf = seen.get(k); else seen.set(k, c.id);
    });
    out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    return out;
  }

  function enrich(c) {
    // Analyse the lead statement for "who/what", the full record for products & themes
    const a = NLP.analyse(c.text, { raising: c.lead });
    c.responding = c.respondingGiven || a.responding || 'Not identified';
    c.alsoMentioned = a.alsoMentioned;
    c.themes = a.themes; c.hs = a.hs; c.summary = a.summary; c.references = a.references; c.attention = a.attention;
    c.products = c.hs.filter(h => h.confidence >= 0.6).slice(0, 3);
    c.title = c.title || autoTitle(c);
  }
  function autoTitle(c) {
    const phrases = [];
    c.products.forEach(p => { const m = /mentions “([^”]+)”/.exec(p.evidence || ''); if (!m && p.confidence < 0.75) return; const ph = m ? m[1] : shortDesc(p.info.desc).toLowerCase(); if (!phrases.some(x => x.includes(ph) || ph.includes(x))) phrases.push(ph); });
    let prod = phrases.slice(0, 3).join(', ');
    prod = prod ? prod.charAt(0).toUpperCase() + prod.slice(1) : null;
    const theme = c.themes[0] ? c.themes[0].label : 'Trade concern';
    const tgt = c.responding && c.responding !== 'Not identified' ? c.responding : '';
    return [tgt, prod ? prod : null].filter(Boolean).join(' — ') + (prod ? ' · ' : (tgt ? ' — ' : '')) + theme;
  }
  function shortDesc(d) { return String(d || '').split(/[;,(]/)[0].trim(); }

  /* ---------- Public store ---------- */
  const Store = {
    concerns: [], source: 'sample', fileName: 'sample-concerns.csv', reviews: {}, hsRaw: null, colmap: {},
    async loadHS() {
      if (this.hsRaw) return;
      const r = await fetch('data/hs.json'); this.hsRaw = await r.json(); NLP.buildHS(this.hsRaw);
    },
    async init() {
      await this.loadHS();
      this.reviews = (await KV.get('reviews')) || {};
      const saved = await KV.get('dataset');
      if (saved && saved.csv) { this.loadCSVText(saved.csv, saved.name, true); this.source = 'imported'; }
      else { const t = await (await fetch('data/sample-concerns.csv')).text(); this.loadCSVText(t, 'sample-concerns.csv', true); this.source = 'sample'; }
      await AI.applyCached(this.concerns);
      this.buildIndex();
    },
    loadCSVText(text, name, silent) {
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
      const rows = parsed.data.filter(r => Object.values(r).some(v => String(v || '').trim()));
      const colmap = detectColumns(parsed.meta.fields || []);
      if (!colmap.summary && !colmap.statement && !colmap.title) throw new Error('Could not find a text column. Please make sure the file has a column such as “Summary”, “Description” or “Title”.');
      this.colmap = colmap; this.fileName = name;
      this.concerns = buildConcerns(rows, colmap);
      this.rowCount = rows.length;
      if (!silent) this.buildIndex();
      return { rows: rows.length, concerns: this.concerns.length, colmap };
    },
    async importFile(file) {
      const text = await file.text();
      const info = this.loadCSVText(text, file.name, true);
      await AI.applyCached(this.concerns); this.buildIndex();
      this.source = 'imported';
      await KV.set('dataset', { csv: text, name: file.name, at: Date.now() });
      return info;
    },
    async resetCurrent() {
      const saved = await KV.get('dataset');
      const t = saved && saved.csv ? saved.csv : await (await fetch('data/sample-concerns.csv')).text();
      this.loadCSVText(t, saved && saved.csv ? saved.name : 'sample-concerns.csv', true);
      await AI.applyCached(this.concerns); this.buildIndex();
    },
    async resetToSample() {
      await KV.del('dataset');
      const t = await (await fetch('data/sample-concerns.csv')).text();
      this.loadCSVText(t, 'sample-concerns.csv', true); this.source = 'sample';
      await AI.applyCached(this.concerns); this.buildIndex();
    },
    hsIndex() { return NLP.hsIndex(); },
    autoTitle(c) { return autoTitle(c); },
    buildIndex() {
      const bm = new NLP.BM25();
      this.concerns.forEach(c => bm.add(c.id, NLP.tokens(c.title + ' ' + c.text + ' ' + c.responding + ' ' + c.raisers.join(' ') + ' ' + c.products.map(p => p.info.desc).join(' ')), c));
      this.index = bm.finish();
    },
    get(id) { return this.concerns.find(c => String(c.id) === String(id)); },
    search(q, limit = 50) { return this.index.search(NLP.tokens(q), { limit }).map(h => ({ c: h.meta, score: h.score })); },

    /* --- Human review of AI product codes --- */
    review(id) { return this.reviews[id] || null; },
    async setReview(id, data) { if (data) this.reviews[id] = Object.assign({ at: new Date().toISOString() }, data); else delete this.reviews[id]; await KV.set('reviews', this.reviews); },
    finalCodes(c) { const r = this.reviews[c.id]; if (r && r.codes) return r.codes; return c.products.map(p => p.code); },

    /* --- Settings --- */
    async setting(k, v) { if (v === undefined) return KV.get('set:' + k); return KV.set('set:' + k, v); },

    /* --- Exports --- */
    toCSV() {
      const head = ['Concern ID', 'Committee', 'First raised', 'Last discussed', 'Meetings', 'Raised by', 'Supported by', 'Measure maintained by (AI)', 'Title (AI)', 'Plain-language summary (AI)', 'Issue types (AI)', 'HS codes (AI suggestion)', 'HS confidence', 'HS codes (reviewed)', 'Review status', 'Attention level (AI)', 'Document references', 'Analysis engine', 'Evidence check (% of AI claims verified)', 'AI claims rejected by checks', 'Products needing review'];
      const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [head.map(esc).join(',')];
      this.concerns.forEach(c => {
        const r = this.reviews[c.id];
        lines.push([c.id, c.committee, c.date, c.lastDate, c.meetings, c.lead, c.raisers.slice(1).join('; '), c.responding, c.title, c.summary.short,
          c.themes.map(t => t.label).join('; '), c.products.map(p => p.code).join('; '), c.products.map(p => p.confidence).join('; '),
          r && r.codes ? r.codes.join('; ') : '', r ? r.status : 'Not reviewed', c.attention.level, c.references.join('; '),
          c.ai ? 'Language model + evidence checks (' + c.ai.model + ')' : 'Basic engine', c.ai ? c.ai.trust : '', c.ai ? c.ai.log.rejected.map(x => x.field + ': ' + x.value + ' (' + x.reason + ')').join(' | ') : '',
          c.ai ? c.ai.products.filter(p => !p.code || p.confidence < 0.7).map(p => p.phrase + (p.code ? ' → ' + p.code : ' → no match')).join('; ') : ''].map(esc).join(','));
      });
      return lines.join('\r\n');
    }
  };

  global.Store = Store; global.KV = KV;
})(window);
