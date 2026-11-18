/* =====================================================================
   GTC Assistant — AI orchestration with built-in fact checking
   ---------------------------------------------------------------------
   The language model does the reading and reasoning. This file makes
   sure nothing it says reaches the user unchecked:

   1. EVIDENCE GATE   Every extracted fact must come with a verbatim quote.
                      Quotes are matched against the source text; facts
                      whose quotes are not found are rejected.
   2. CLOSED-SET HS   The model may only pick HS codes from candidates
                      retrieved from the official nomenclature. Any other
                      code is rejected; low certainty → "needs review".
   3. TOOLS FOR FACTS The Q&A agent has no knowledge of its own: it must
                      call search/count tools that run on the loaded data.
   4. ANSWER CHECKS   Citations must point to records the tools returned;
                      every number must appear in the tool results; an
                      independent verifier pass lists unsupported claims.
   ===================================================================== */
(function (global) {
  'use strict';
  const VERSION = 'a3';

  /* ---------------- Gateway client ---------------- */
  function accessCode() { try { return localStorage.getItem('gtc-access') || ''; } catch (e) { return ''; } }
  async function post(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': accessCode() }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status === 401 && j.needCode) {
        const code = global.prompt('This site’s AI features are protected. Please enter the access code you were given:');
        if (!code) throw new Error('AI features need an access code.');
        try { localStorage.setItem('gtc-access', code.trim()); } catch (e) { }
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 2 && !/configured/.test(j.error || '')) { await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); continue; }
      throw new Error(j.error || `AI service error (${r.status})`);
    }
  }
  const task = (name, input) => post({ task: name, input });

  /* ---------------- Grounding: does a quote really occur in the source? ---------------- */
  const normToks = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').match(/[a-z0-9]+/g) || [];
  function verifyQuote(source, quote) {
    const q = normToks(quote); if (q.length < 2) return { ok: false, score: 0 };
    const src = normToks(source);
    const srcStr = ' ' + src.join(' ') + ' ', qStr = ' ' + q.join(' ') + ' ';
    if (srcStr.includes(qStr)) return { ok: 'exact', score: 1 };
    // longest contiguous run of quote tokens found in the source (tolerates tiny copying slips)
    let best = 0;
    for (let i = 0; i < q.length; i++) {
      for (let j = q.length; j > i + best; j--) {
        if (srcStr.includes(' ' + q.slice(i, j).join(' ') + ' ')) { best = j - i; break; }
      }
    }
    const score = best / q.length;
    return { ok: score >= 0.85 ? 'close' : false, score };
  }
  function phraseInText(text, phrase) { return verifyQuote(text, phrase).ok === 'exact' || normToks(text).join(' ').includes(normToks(phrase).join(' ')); }

  /* ---------------- HS candidates from the official nomenclature ---------------- */
  function candidates(phrase, context) {
    const out = new Map();
    const add = (code, src) => { if (!out.has(code) && NLP.hsInfo(code) && code.length >= 4) out.set(code, src); };
    NLP.suggestHS(phrase, { short: true, limit: 8 }).forEach(s => { add(s.code, 'match'); if (s.subheading) add(s.subheading.code, 'sub'); });
    const toks = NLP.tokens(phrase, { keepProcedural: false });
    const ctx = NLP.tokens(context || '', { keepProcedural: false }).slice(0, 40);
    const HSI = Store.hsIndex();
    HSI.search(toks, { limit: 8 }).forEach(h => add(h.id, 'search'));
    [...out.keys()].filter(c => c.length === 4).forEach(head => {
      HSI.search(toks.concat(ctx), { limit: 5, filter: d => d.id.length === 6 && d.id.startsWith(head) }).forEach(h => add(h.id, 'sub'));
    });
    return [...out.keys()].slice(0, 15).map(code => ({ code, desc: describe(code) }));
  }
  function describe(code) {
    const i = NLP.hsInfo(code); if (!i) return '';
    return code.length === 6 && i.heading && i.heading !== i.desc ? `${i.desc} [heading ${code.slice(0, 4)}: ${i.heading}]` : i.desc;
  }

  /* ---------------- Statement analysis pipeline ---------------- */
  const SIG_W = { alleged_inconsistency: 2, discrimination: 2, long_running: 1, no_response: 1, trade_impact_claimed: 1, broad_support: 1 };
  const SIG_LABEL = { alleged_inconsistency: 'legal inconsistency alleged', discrimination: 'possible discrimination or blocked market access', long_running: 'long-running / unresolved', no_response: 'no response to questions', trade_impact_claimed: 'trade impact claimed', broad_support: 'other Members share the concern' };

  async function analyseText(text, raising) {
    text = String(text || '').slice(0, 24000);
    const log = { checked: 0, verified: 0, rejected: [] };
    const gate = (label, value, evidence) => {
      log.checked++;
      const v = verifyQuote(text, evidence);
      if (v.ok) { log.verified++; return v.ok; }
      log.rejected.push({ field: label, value: String(value || '').slice(0, 120), reason: evidence ? 'quote not found in the statement' : 'no quote given' });
      return false;
    };
    const ex = await task('extract', { text, raising });
    const r = ex.result || {};
    const res = { version: VERSION, at: new Date().toISOString(), model: ex.model, log };

    // Maintaining member: evidence must exist and must actually name that Member
    const mm = r.maintaining_member || {};
    const mmName = NLP.canonMember(mm.name || '');
    if (mmName && !/not stated/i.test(mmName)) {
      const ok = gate('Member maintaining the measure', mmName, mm.evidence);
      const named = NLP.findMembers(mm.evidence || '').some(m => m.name === mmName) || NLP.findMembers(text).some(m => m.name === mmName);
      res.maintaining = ok && named ? { name: mmName, evidence: mm.evidence, verified: ok } : null;
      if (ok && !named) log.rejected.push({ field: 'Member maintaining the measure', value: mmName, reason: 'Member not named in the statement' });
    }
    if (r.raising_member && r.raising_member.name) {
      const n = NLP.canonMember(r.raising_member.name);
      res.raising = gate('Raising Member', n, r.raising_member.evidence) ? n : null;
    }
    if (r.core_issue && gate('Core issue', r.core_issue.text, r.core_issue.evidence)) res.coreIssue = { text: r.core_issue.text, evidence: r.core_issue.evidence };
    if (r.measure && (r.measure.description || r.measure.document_reference)) {
      const ok = gate('Measure', r.measure.description, r.measure.evidence);
      const refOk = !r.measure.document_reference || phraseInText(text, r.measure.document_reference);
      if (ok) res.measure = { description: r.measure.description, reference: refOk ? r.measure.document_reference : '', evidence: r.measure.evidence };
    }
    res.requests = (r.requests || []).filter(x => gate('Request', x.text, x.evidence)).map(x => ({ text: x.text, evidence: x.evidence }));
    res.issueTypes = [];
    (r.issue_types || []).forEach(x => { const th = NLP.THEMES.find(t => t.id === x.id); if (th && gate('Issue type', th.label, x.evidence) && !res.issueTypes.some(y => y.id === th.id)) res.issueTypes.push({ id: th.id, label: th.label, plain: th.plain, evidence: [x.evidence] }); });
    res.supporters = (r.other_members_supporting || []).map(x => ({ name: NLP.canonMember(x.name), ev: x.evidence })).filter(x => x.name && gate('Supporting Member', x.name, x.ev)).map(x => x.name);
    const signals = (r.escalation_signals || []).filter(x => SIG_W[x.signal] && gate('Escalation signal', SIG_LABEL[x.signal], x.evidence));
    const score = [...new Set(signals.map(s => s.signal))].reduce((s, k) => s + SIG_W[k], 0);
    res.attention = { level: score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low', score, why: [...new Set(signals.map(s => SIG_LABEL[s.signal]))], evidence: signals.map(s => s.evidence) };
    res.horizontal = !!r.applies_to_many_products;

    // Plain summary: cannot be quote-checked, so check its concrete details instead
    const sum = String(r.summary_plain || '');
    const problems = [];
    (sum.match(/\b\d[\d.,/-]*\b/g) || []).forEach(n => { if (!text.includes(n.replace(/[.,]$/, ''))) problems.push(`number “${n}”`); });
    NLP.findMembers(sum).forEach(m => { if (!NLP.findMembers(text).some(x => x.name === m.name) && NLP.canonMember(raising) !== m.name) problems.push(`Member “${m.name}”`); });
    res.summary = sum; res.summaryOk = !problems.length; res.summaryProblems = problems;
    if (problems.length) log.rejected.push({ field: 'Plain summary', value: sum.slice(0, 120), reason: 'mentions details not in the statement: ' + problems.join(', ') });

    // Products → closed-set HS classification
    const prods = [];
    (r.products || []).forEach(p => {
      const phrase = String(p.phrase || '').trim();
      if (!phrase || prods.some(x => x.phrase.toLowerCase() === phrase.toLowerCase())) return;
      log.checked++;
      if (!phraseInText(text, phrase) && !verifyQuote(text, p.evidence).ok) { log.rejected.push({ field: 'Product', value: phrase, reason: 'product not found in the statement' }); return; }
      log.verified++;
      prods.push({ phrase, evidence: p.evidence, candidates: candidates(phrase, p.evidence) });
    });
    res.products = [];
    if (prods.length) {
      const cl = await task('classify', { context: prods.map(p => p.evidence).join(' … '), products: prods.map(p => ({ phrase: p.phrase, candidates: p.candidates })) });
      const local = new Set(NLP.suggestHS(text, { short: false, limit: 10 }).map(s => s.code.slice(0, 4)));
      prods.forEach((p, idx) => {
        const a = (cl.result.assignments || []).find(x => String(x.product || '').toLowerCase() === p.phrase.toLowerCase()) || (cl.result.assignments || [])[idx] || {};
        let code = a.hs_code ? String(a.hs_code).replace(/\D/g, '') : null;
        const rank = code ? p.candidates.findIndex(c => c.code === code) : -1;
        const entry = { phrase: p.phrase, evidence: p.evidence, candidates: p.candidates.slice(0, 6), reason: a.reason || '' };
        if (code && (rank < 0 || !NLP.hsInfo(code))) { log.rejected.push({ field: 'HS code', value: `${a.hs_code} for “${p.phrase}”`, reason: 'code was not one of the official candidates' }); code = null; }
        if (!code) { entry.code = null; entry.status = 'No confident match — needs expert review'; entry.confidence = 0; res.products.push(entry); return; }
        let conf = { high: 0.9, medium: 0.7, low: 0.45 }[a.certainty] || 0.45;
        const agrees = local.has(code.slice(0, 4));
        if (agrees) conf += 0.05; if (rank > 6) conf -= 0.1;
        conf = Math.max(0.1, Math.min(0.97, conf));
        Object.assign(entry, { code, certainty: a.certainty, confidence: Math.round(conf * 100) / 100, agreesWithBaseline: agrees, status: conf >= 0.7 ? 'AI-assigned (checked)' : 'Needs human review' });
        res.products.push(entry);
      });
      res.classifyModel = cl.model;
    }
    res.trust = log.checked ? Math.round(log.verified / log.checked * 100) : 100;
    return res;
  }

  /* ---------------- Cache + applying AI results to a concern ---------------- */
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
  const keyOf = c => VERSION + ':' + hash(c.text);
  let cache = null;
  async function loadCache() { if (!cache) cache = (await KV.get('ai-cache')) || {}; return cache; }
  async function saveCache() { await KV.set('ai-cache', cache); }

  function apply(c, r) {
    if (!c.local) c.local = { summary: c.summary, responding: c.responding, themes: c.themes, hs: c.hs, products: c.products, attention: c.attention, title: c.title };
    c.ai = r;
    if (r.summary && r.summaryOk) c.summary = Object.assign({}, c.local.summary, { short: r.summary, asks: r.requests.map(x => x.text), problems: r.coreIssue ? [r.coreIssue.text] : c.local.summary.problems });
    else c.summary = Object.assign({}, c.local.summary, { asks: r.requests.length ? r.requests.map(x => x.text) : c.local.summary.asks });
    if (!c.respondingGiven && r.maintaining) c.responding = r.maintaining.name;
    if (r.issueTypes.length) c.themes = r.issueTypes.map(t => Object.assign({ hits: 1 }, t));
    c.attention = r.attention;
    const good = r.products.filter(p => p.code && p.confidence >= 0.6);
    c.products = good.map(p => ({ code: p.code, confidence: p.confidence, level: NLP.confidenceLabel(p.confidence), evidence: `mentions “${p.phrase}”`, info: NLP.hsInfo(p.code), method: 'AI (closed-set)' }));
    c.title = c.titleGiven || Store.autoTitle(c);
  }
  async function applyCached(concerns) {
    await loadCache();
    let n = 0; concerns.forEach(c => { const r = cache[keyOf(c)]; if (r) { apply(c, r); n++; } });
    return n;
  }
  async function analyseConcern(c, { force } = {}) {
    await loadCache();
    const k = keyOf(c);
    if (!force && cache[k]) { apply(c, cache[k]); return cache[k]; }
    const r = await analyseText(c.text, c.lead);
    cache[k] = r; await saveCache(); apply(c, r);
    return r;
  }
  async function analyseMany(list, onProgress, signal) {
    await loadCache();
    const todo = list.filter(c => !cache[keyOf(c)]);
    let done = 0, failed = 0; const errors = [];
    const worker = async () => {
      while (todo.length) {
        if (signal && signal.aborted) return;
        const c = todo.shift();
        try { await analyseConcern(c); } catch (e) { failed++; errors.push(`#${c.id}: ${e.message}`); if (/access code|not configured/i.test(e.message)) { todo.length = 0; } }
        done++; onProgress && onProgress(done, done + todo.length, failed);
      }
    };
    await Promise.all([worker(), worker()]);
    return { done, failed, errors };
  }
  function coverage(concerns) { return concerns.filter(c => c.ai).length; }
  async function clearCache() { cache = {}; await saveCache(); }

  /* ---------------- Q&A agent: tools run on the loaded data ---------------- */
  const THEME_BY_ID = id => NLP.THEMES.find(t => t.id === id);
  function filterSet(a) {
    let set = Store.concerns.filter(c => !c.duplicateOf);
    const m = a.member ? NLP.canonMember(a.member) : '';
    if (m) set = set.filter(c => a.role === 'raising' ? c.raisers.includes(m) : a.role === 'maintaining' ? c.responding === m : (c.raisers.includes(m) || c.responding === m));
    if (a.theme) set = set.filter(c => c.themes.some(t => t.id === a.theme));
    if (a.hs_prefix) { const p = String(a.hs_prefix).replace(/\D/g, ''); set = set.filter(c => Store.finalCodes(c).some(code => code.startsWith(p) || p.startsWith(code))); }
    if (a.committee) set = set.filter(c => c.committee.toUpperCase() === String(a.committee).toUpperCase());
    if (a.year_from) set = set.filter(c => c.year >= a.year_from);
    if (a.year_to) set = set.filter(c => c.year <= a.year_to);
    if (a.query && a.query.trim()) {
      const ids = new Set(set.map(c => c.id));
      set = Store.index.search(NLP.tokens(a.query), { limit: 1000, filter: d => ids.has(d.id) }).filter(h => h.score > 0.8).map(h => h.meta);
    }
    return set;
  }
  const brief = c => ({ id: String(c.id), title: c.title, committee: c.committee, first_raised: c.date, last_discussed: c.lastDate, raised_by: c.raisers, maintained_by: c.responding, issue_types: c.themes.map(t => t.label), hs_codes: Store.finalCodes(c).map(code => code + ' ' + ((NLP.hsInfo(code) || {}).desc || '').slice(0, 60)), summary: c.summary.short.slice(0, 300), analysis: c.ai ? 'AI-verified' : 'basic' });
  const TOOLS = {
    search_concerns(a) { const set = filterSet(a); const lim = Math.min(15, a.limit || 8); return { total_matches: set.length, returned: Math.min(lim, set.length), results: set.slice(0, lim).map(brief) }; },
    count_concerns(a) {
      const set = filterSet(a); const g = a.group_by || 'none';
      if (g === 'none') return { total: set.length };
      const key = { year: c => c.year ? [String(c.year)] : [], raising_member: c => c.raisers, maintaining_member: c => c.responding !== 'Not identified' ? [c.responding] : [], theme: c => c.themes.map(t => t.label), committee: c => [c.committee], hs_chapter: c => [...new Set(Store.finalCodes(c).map(x => x.slice(0, 2) + ' ' + ((NLP.hsInfo(x.slice(0, 2)) || {}).desc || '').split(';')[0]))] }[g];
      const m = new Map(); set.forEach(c => key(c).forEach(k => m.set(k, (m.get(k) || 0) + 1)));
      const groups = [...m.entries()].map(([k, n]) => ({ group: k, count: n })).sort((x, y) => g === 'year' ? x.group.localeCompare(y.group) : y.count - x.count);
      return { total_concerns: set.length, grouped_by: g, groups: groups.slice(0, 40), note: g === 'year' ? 'Years with zero concerns are omitted.' : undefined };
    },
    get_concern(a) {
      const c = Store.get(a.id); if (!c) return { error: `No concern with id ${a.id} in the loaded data.` };
      return Object.assign(brief(c), {
        duplicate_of: c.duplicateOf || undefined,
        statements: c.statements.map(s => ({ member: s.member, date: s.date, text: s.text.slice(0, 3500) })),
        verified_analysis: c.ai ? { core_issue: c.ai.coreIssue && c.ai.coreIssue.text, measure: c.ai.measure, requests: c.ai.requests.map(r => r.text), products: c.ai.products.map(p => ({ product: p.phrase, hs: p.code, status: p.status })) } : 'not yet analysed by AI — rely on statements',
        human_review: Store.review(c.id) || 'not reviewed'
      });
    },
    hs_lookup(a) {
      if (a.code) { const code = String(a.code).replace(/\D/g, ''); const i = NLP.hsInfo(code); return i ? { code, description: i.desc, chapter: i.chapter, section: i.sectionName } : { error: 'Not a valid HS code' }; }
      return { candidates: candidates(a.query || '', '').slice(0, 8) };
    },
    async trade_flows(a) {
      if (!UI.API.status.comtrade) return { error: 'Live trade data is not available on this deployment.' };
      const rc = NLP.memberCode(a.importer), pc = !a.exporter || /world/i.test(a.exporter) ? 0 : NLP.memberCode(a.exporter);
      if (rc == null || pc == null) return { error: 'Unknown Member for trade data. Supported: ' + NLP.MEMBERS.map(m => m.name).slice(0, 20).join(', ') + '…' };
      const yrs = []; for (let y = a.year_from; y <= Math.min(a.year_to, a.year_from + 20); y++) yrs.push(y);
      const j = await UI.API.flows({ reporter: rc, partner: pc, hs: String(a.hs).replace(/\D/g, ''), flow: 'M', years: yrs.join(',') });
      const by = {}; (j.rows || []).forEach(r => { by[r.year] = (by[r.year] || 0) + (+r.value || 0); });
      return { importer: a.importer, partner: a.exporter || 'World', hs: a.hs, unit: 'US dollars', source: 'UN Comtrade', imports_by_year: by };
    }
  };

  async function ask(question, history, onStep) {
    const messages = history.slice(-6).map(m => ({ role: m.role, content: m.text })).filter(m => m.content);
    while (messages.length && messages[0].role !== 'user') messages.shift();
    messages.push({ role: 'user', content: question });
    const seen = new Set(); const evidence = []; const steps = [];
    let answer = '', model = '';
    for (let turn = 0; turn < 8; turn++) {
      const j = await post({ task: 'agent', messages });
      model = j.model;
      messages.push({ role: 'assistant', content: j.content });
      const uses = (j.content || []).filter(b => b.type === 'tool_use');
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (!uses.length || j.stop_reason !== 'tool_use') { answer = text; break; }
      const results = [];
      for (const u of uses) {
        onStep && onStep(stepLabel(u));
        let out; try { out = TOOLS[u.name] ? await TOOLS[u.name](u.input || {}) : { error: 'unknown tool' }; } catch (e) { out = { error: e.message }; }
        collectIds(out, seen);
        const s = JSON.stringify(out);
        evidence.push(`[${u.name} ${JSON.stringify(u.input)}]\n${s.slice(0, 9000)}`);
        steps.push({ tool: u.name, input: u.input });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: s.slice(0, 14000) });
      }
      messages.push({ role: 'user', content: results });
    }
    if (!answer) answer = 'I could not complete the analysis in the allowed number of steps. Please try a narrower question.';
    const checks = await checkAnswer(answer, question, seen, evidence);
    return { answer, model, steps, seen: [...seen], checks };
  }
  function stepLabel(u) {
    const i = u.input || {};
    return { search_concerns: `Searching records${i.query ? ` for “${i.query}”` : ''}`, count_concerns: `Counting concerns${i.group_by && i.group_by !== 'none' ? ' by ' + i.group_by.replace('_', ' ') : ''}`, get_concern: `Reading concern #${i.id}`, hs_lookup: `Looking up HS codes${i.query ? ` for “${i.query}”` : ''}`, trade_flows: 'Fetching UN Comtrade data' }[u.name] || u.name;
  }
  function collectIds(o, seen) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(x => collectIds(x, seen)); return; }
    if (o.id != null && Store.get(o.id)) seen.add(String(o.id));
    Object.values(o).forEach(v => typeof v === 'object' && collectIds(v, seen));
  }

  /* ---------------- Deterministic + model-based answer checks ---------------- */
  async function checkAnswer(answer, question, seen, evidence) {
    const ev = evidence.join('\n');
    const cites = [...new Set((answer.match(/\[#\s*([\w\-]+)\]/g) || []).map(x => x.replace(/[\[\]#\s]/g, '')))];
    const badCites = cites.filter(id => !seen.has(id));
    const nums = (answer.replace(/\[#[^\]]*\]/g, '').match(/(?<![\w.])\d[\d,]*(?:\.\d+)?%?/g) || []).map(n => n.replace(/,/g, ''));
    const evNums = new Set((ev.match(/\d+(?:\.\d+)?/g) || []).concat(question.match(/\d+(?:\.\d+)?/g) || []));
    const badNums = [...new Set(nums.filter(n => { const v = n.replace('%', ''); if (evNums.has(v)) return false; if (/^\d$/.test(v)) return false; return true; }))];
    let verifier = null;
    if (evidence.length) {
      try { const v = await task('verify', { answer, evidence: ev }); verifier = v.result; } catch (e) { verifier = { error: e.message }; }
    }
    const ok = !badCites.length && !badNums.length && verifier && !verifier.error && verifier.verdict === 'supported';
    return { cites, badCites, badNums, verifier, ok, noEvidence: !evidence.length };
  }

  async function narrate(stats) {
    const j = await task('narrate', { stats });
    const r = j.result || {};
    const all = [r.headline, ...(r.points || []), r.caveat].filter(Boolean).join(' ');
    const evNums = new Set((JSON.stringify(stats).match(/\d+(?:\.\d+)?/g) || []));
    const bad = [...new Set((all.match(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, '')).filter(n => !evNums.has(n) && !/^\d$/.test(n)))];
    return { result: r, model: j.model, badNums: bad };
  }

  global.AI = { VERSION, task, verifyQuote, candidates, analyseText, analyseConcern, analyseMany, applyCached, coverage, clearCache, ask, narrate, checkAnswer, TOOLS, get enabled() { return !!(UI.API.status && UI.API.status.llm); } };
})(window);
