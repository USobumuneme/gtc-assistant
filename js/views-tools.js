/* =====================================================================
   Views: Explain a statement, Find a product code, Ask a question
   ===================================================================== */
(function () {
  'use strict';
  const { $, $$, esc, icon, fmt, fmtDate, toast, confBar, aiNote, route, go } = UI;

  /* =================== EXPLAIN A STATEMENT =================== */
  route('analyse', async (view) => {
    const examples = Store.concerns.filter(c => c.text.length > 400).slice(0, 3);
    const members = NLP.MEMBERS.map(m => m.name).sort();
    view.innerHTML = `
      <h1>Explain a statement</h1>
      <p class="muted">Paste the text of a trade concern — from meeting minutes, a notification comment or an email — and the assistant will explain it in plain language, identify the products and HS codes involved, and find similar past concerns.</p>
      <div class="card">
        <label class="f" for="a-text">Statement text</label>
        <textarea id="a-text" placeholder="e.g. The representative of Canada raised concern about the EU regulation on…"></textarea>
        <div class="row" style="margin-top:10px">
          <div style="min-width:220px"><label class="f" for="a-member">Raised by (optional)</label><select id="a-member"><option value="">Not sure / detect it</option>${members.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
          <span class="spacer"></span>
          <button id="a-clear" class="ghost">Clear</button>
          <button id="a-go" class="primary">${icon('spark')}Explain this</button>
        </div>
        ${examples.length ? `<div class="suggest"><span class="small muted" style="align-self:center">Try an example:</span>${examples.map((c, i) => `<button data-ex="${i}">${esc(c.title.slice(0, 60))}</button>`).join('')}</div>` : ''}
      </div>
      <div id="a-out" style="margin-top:16px"></div>`;
    $$('[data-ex]').forEach(b => b.addEventListener('click', () => { const c = examples[+b.dataset.ex]; $('#a-text').value = c.statements[0].text; $('#a-member').value = c.lead; run(); }));
    $('#a-clear').addEventListener('click', () => { $('#a-text').value = ''; $('#a-out').innerHTML = ''; });
    $('#a-go').addEventListener('click', run);

    async function run() {
      const text = $('#a-text').value.trim();
      if (text.length < 40) { toast('Please paste a longer statement (at least a sentence or two).'); return; }
      const detected = NLP.findMembers(text);
      let raising = $('#a-member').value;
      if (!raising) { const m = text.match(/representative of (the )?([A-Z][A-Za-z ,]+?)(?= (raised|expressed|drew|said|informed|welcomed|noted|also|thanked|referred|stated|asked|shared|recalled|reiterated|highlighted))/); raising = m ? NLP.canonMember(m[2]) : (detected[0] ? detected[0].name : ''); }
      const a = NLP.analyse(text, { raising });
      const similar = Store.index.search(NLP.tokens(text, { keepProcedural: false }), { limit: 4 });
      const out = $('#a-out');
      let ai = null, aiErr = '';
      if (AI.enabled) {
        out.innerHTML = '<div class="card"><p class="muted"><span class="spinner"></span> The language model is reading the statement. Every fact it reports will be checked against your text, and product codes matched only to the official HS list… (about 10–20 seconds)</p></div>';
        try { ai = await AI.analyseText(text, raising); } catch (e) { aiErr = e.message; }
      }
      const themes = ai && ai.issueTypes.length ? ai.issueTypes : a.themes;
      const maintaining = ai ? (ai.maintaining ? ai.maintaining.name : 'Not stated') : (a.responding || 'Not identified');
      const att = ai ? ai.attention : a.attention;
      const hsBlock = ai
        ? (ai.products.filter(p => p.code).map(p => hsRow({ code: p.code, confidence: p.confidence, status: p.status, phrase: p.phrase, reason: p.reason, agrees: p.agreesWithBaseline, alts: p.candidates.filter(x => x.code !== p.code).slice(0, 3) }, false, true)).join('')
          + (ai.products.filter(p => !p.code).length ? `<div class="callout warn small" style="margin-top:10px">Named but not confidently matched: ${ai.products.filter(p => !p.code).map(p => `“${esc(p.phrase)}”`).join(', ')} — needs an expert.</div>` : '')
          || '<p class="muted">No specific product is named in the statement.</p>')
        : (a.hs.length ? a.hs.map(s => hsRow({ code: s.code, confidence: s.confidence, why: s.evidence, subheading: s.subheading }, false, true)).join('') : '<p class="muted">No specific product named. The measure may apply across many products.</p>');
      out.innerHTML = `
        ${aiErr ? `<div class="callout warn" style="margin-bottom:12px">The language model could not be used (${esc(aiErr)}). Showing the basic analysis instead.</div>` : ''}
        <div class="grid g-main">
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>In plain language</h2>${ai ? verifiedBadge(ai) : '<span class="chip">Basic engine</span>'}</div>
              ${ai ? aiBriefHTML(ai, a.summary.short) + rejectedHTML(ai) : `
                <p style="font-size:1.04rem">${esc(a.summary.short)}</p>
                ${a.summary.problems.length ? `<h3>What is the problem?</h3><ul class="brief-list">${a.summary.problems.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
                ${a.summary.asks.length ? `<h3 style="margin-top:12px">What is being asked for?</h3><ul class="brief-list">${a.summary.asks.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}`}
              <div style="margin-top:10px">${aiNote(ai ? `Written by ${esc(ai.model)}; quotes in italics were matched automatically to your text. Claims that failed the check are not shown.` : 'Basic engine: sentences selected from your text.')}</div>
            </div>
            <div class="card"><h2>Products and HS codes</h2>${hsBlock}</div>
          </div>
          <div class="stack">
            <div class="card"><h3>Key facts</h3>
              <table class="tbl"><tbody>
                <tr><td class="muted">Raised by</td><td><b>${esc(raising || 'Not identified')}</b></td></tr>
                <tr><td class="muted">Measure maintained by</td><td><b>${esc(maintaining)}</b>${ai && ai.maintaining ? `<div class="tiny"><q class="ev">${esc(ai.maintaining.evidence)}</q></div>` : ''}</td></tr>
                <tr><td class="muted">Attention level</td><td><span class="chip att-${att.level}">${att.level}</span><div class="tiny muted">${esc(att.why.join('; ') || 'no escalation signals')}</div></td></tr>
              </tbody></table>
            </div>
            <div class="card"><h3>Type of issue</h3><div class="chips">${themes.map(t => `<span class="chip theme" title="${esc(t.plain)}">${esc(t.label)}</span>`).join('') || '<span class="muted small">None detected</span>'}</div>
              ${a.references.length ? `<h3 style="margin-top:14px">Documents mentioned</h3><div class="chips">${a.references.map(r => `<span class="chip mono">${esc(r)}</span>`).join('')}</div>` : ''}</div>
            <div class="card"><h3>Similar concerns already on record</h3>${similar.length ? similar.map(h => `<button class="cite" data-open="${esc(h.id)}"><b>${esc(h.meta.title)}</b><div class="tiny muted">#${esc(h.id)} · ${esc(h.meta.lead)} · ${fmtDate(h.meta.date)}</div></button>`).join('') : '<p class="muted small">None found in the loaded data.</p>'}</div>
          </div>
        </div>`;
      bindOpen(out);
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* =================== FIND A PRODUCT CODE =================== */
  route('hs', async (view, r) => {
    const ex = ['clay roof tiles', 'frozen boneless beef', 'lithium-ion batteries', 'women’s cotton dresses', 'infant formula', 'solar panels', 'fresh avocados', 'wristwatches'];
    view.innerHTML = `
      <h1>Find a product code</h1>
      <p class="muted">Describe a product in everyday words. The assistant searches all ${fmt(Store.hsRaw.codes.length)} entries of the Harmonized System (HS 2022) and explains why each code matches.</p>
      <div class="card">
        <form id="h-form" class="row" style="flex-wrap:nowrap">
          <input type="search" id="h-q" placeholder="e.g. frozen shrimp, electric cars, wool fabric…" value="${esc(r.q.get('q') || '')}" aria-label="Product description">
          <button class="primary" type="submit">${icon('search')}Find codes</button>
        </form>
        <div class="suggest"><span class="small muted" style="align-self:center">Examples:</span>${ex.map(e => `<button data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <div class="row small muted"><span>Or look up a code directly:</span><input type="text" id="h-code" placeholder="e.g. 0406 or 870380" style="max-width:200px;min-height:34px"><button class="sm" id="h-code-go">Look up</button></div>
      </div>
      <div id="h-out" style="margin-top:16px"></div>`;
    $$('[data-q]').forEach(b => b.addEventListener('click', () => { $('#h-q').value = b.dataset.q; run(); }));
    $('#h-form').addEventListener('submit', e => { e.preventDefault(); run(); });
    $('#h-code-go').addEventListener('click', () => showCode($('#h-code').value.replace(/\D/g, '')));
    if (r.q.get('q')) run(); else if (r.q.get('code')) showCode(r.q.get('code'));

    async function run() {
      const q = $('#h-q').value.trim(); if (!q) return;
      history.replaceState(null, '', '#/hs?q=' + encodeURIComponent(q));
      const out = $('#h-out');
      const res = NLP.suggestHS(q, { short: true, limit: 8 });
      if (!res.length) { out.innerHTML = `<div class="card empty"><p><b>No matching codes found.</b></p><p>Try a simpler or more general word (e.g. “shoes” instead of a brand name).</p></div>`; return; }
      out.innerHTML = `
        ${AI.enabled ? `<div class="card" id="h-ai" style="margin-bottom:16px"><div class="card-h"><h2>AI recommendation</h2></div><p class="small muted">The language model reviews the official candidate codes below and picks the best one — it cannot suggest a code that is not in the HS nomenclature.</p><button class="primary sm" id="h-ai-go">${icon('spark')}Ask AI to choose the best code</button></div>` : ''}
        <div class="card"><div class="card-h"><h2>Matches for “${esc(q)}”</h2><span class="tiny muted">Ranked by wording match with the official HS text</span></div>
        ${res.map(s => `<div class="hsrow"><span class="hscode">${NLP.hsPretty(s.code)}</span>
          <span><b style="font-weight:600">${esc(s.info.desc)}</b><div class="tiny muted">Section ${s.info.section} · ${esc(s.info.sectionName || '')} › Chapter ${s.info.chapterCode}: ${esc(s.info.chapter || '')}</div>
          ${s.subheading ? `<div class="tiny muted">Most likely sub-heading <span class="mono">${NLP.hsPretty(s.subheading.code)}</span> ${esc(s.subheading.desc)}</div>` : ''}
          <div class="why">Why: ${esc(s.evidence)}</div></span>
          <span class="row" style="gap:6px;justify-content:flex-end">${confBar(s.confidence)}<button class="sm" data-code="${s.code}">Details</button></span></div>`).join('')}
        <div style="margin-top:12px">${aiNote('Always confirm the final classification against the HS Explanatory Notes or your customs authority — codes can depend on material, processing or use.')}</div></div>`;
      $$('[data-code]', out).forEach(b => b.addEventListener('click', () => showCode(b.dataset.code)));
      const go = $('#h-ai-go');
      if (go) go.addEventListener('click', async () => {
        const box = $('#h-ai');
        const cands = AI.candidates(q, q);
        box.innerHTML = '<p class="muted"><span class="spinner"></span> Comparing the official candidates…</p>';
        try {
          const j = await AI.task('classify', { context: q, products: [{ phrase: q, candidates: cands }] });
          const a = (j.result.assignments || [])[0] || {};
          const code = a.hs_code ? String(a.hs_code).replace(/\D/g, '') : null;
          const valid = code && cands.some(c => c.code === code) && NLP.hsInfo(code);
          if (!valid) {
            box.innerHTML = `<div class="card-h"><h2>AI recommendation</h2></div><p><b>No confident match.</b> ${code ? 'The model proposed a code outside the official candidates, so it was rejected. ' : ''}${esc(a.reason || '')}</p><p class="small muted">Try describing the material, form or use (e.g. “frozen boneless beef cuts” rather than “beef”).</p>`;
            return;
          }
          const conf = { high: 0.9, medium: 0.7, low: 0.45 }[a.certainty] || 0.45;
          box.innerHTML = `<div class="card-h"><h2>AI recommendation</h2><span class="chip ${conf >= 0.7 ? 'att-Low' : 'att-Medium'}">${conf >= 0.7 ? 'Checked: code is in the official list' : 'Low certainty — confirm with an expert'}</span></div>
            ${hsRow({ code, confidence: conf, reason: a.reason, phrase: q }, false, true)}
            <p class="tiny muted">Chosen by ${esc(j.model)} from ${cands.length} official candidates: ${cands.map(c => `<span class="mono">${NLP.hsPretty(c.code)}</span>`).join(', ')}.</p>`;
        } catch (e) { box.innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`; }
      });
    }
    function showCode(code) {
      const i = NLP.hsInfo(code);
      const out = $('#h-out');
      if (!i) { toast('Code not found. Use 2, 4 or 6 digits.'); return; }
      const children = Store.hsRaw.codes.filter(([c, , lvl]) => c.startsWith(code) && c !== code && lvl === (code.length === 2 ? 4 : 6)).slice(0, 60);
      const related = Store.concerns.filter(c => Store.finalCodes(c).some(x => x.startsWith(code.slice(0, 4)) || code.startsWith(x)));
      out.innerHTML = `<div class="card">
        <div class="muted small">Section ${i.section} · ${esc(i.sectionName || '')}${code.length > 2 ? ` › Chapter ${i.chapterCode}: ${esc(i.chapter || '')}` : ''}${code.length === 6 ? ` › Heading ${code.slice(0, 4)}` : ''}</div>
        <h2 style="margin-top:4px"><span class="hscode">${NLP.hsPretty(code)}</span> ${esc(i.desc)}</h2>
        ${children.length ? `<h3 style="margin-top:14px">${code.length === 2 ? 'Headings' : 'Sub-headings'} in this ${code.length === 2 ? 'chapter' : 'heading'}</h3><table class="tbl"><tbody>${children.map(([c, d]) => `<tr><td style="width:90px"><a href="#" data-code="${c}" class="mono">${NLP.hsPretty(c)}</a></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>` : ''}
        <div class="row" style="margin-top:14px">
          ${code.length > 2 ? `<a class="btn sm" href="#" data-code="${code.slice(0, code.length === 6 ? 4 : 2)}">${icon('up')}Up one level</a>` : ''}
          <a class="btn sm primary" href="#/flows?hs=${code.length >= 4 ? code : ''}">${icon('globe')}See trade in this product</a>
        </div>
        <h3 style="margin-top:18px">Trade concerns involving this product (${related.length})</h3>
        <div class="clist">${related.slice(0, 6).map(concernItem).join('') || '<p class="muted small">None in the loaded data.</p>'}</div></div>`;
      $$('[data-code]', out).forEach(a => a.addEventListener('click', e => { e.preventDefault(); showCode(a.dataset.code); }));
      bindOpen(out);
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* =================== ASK A QUESTION =================== */
  const chatLog = [];
  route('ask', async (view, r) => {
    const about = r.q.get('about') ? Store.get(r.q.get('about')) : null;
    const C = Store.concerns;
    const topMember = countBy(C, c => c.responding !== 'Not identified' ? c.responding : null)[0];
    const topTheme = countBy(C, c => c.themes.map(t => t.label))[0];
    const sugg = about ? ['Summarise this concern in three sentences', 'Which products are affected?', 'Has a similar concern been raised before?', 'What exactly is being asked for?']
      : ['Which concerns involve labelling requirements?', topMember ? `How many concerns are about measures maintained by ${topMember[0]}?` : 'How many concerns are there?', 'Which Members raise the most concerns?', 'Show concerns about food products', 'How have concerns changed over time?', topTheme ? `Explain the concerns about ${topTheme[0].toLowerCase()}` : 'What are the main issues?'];
    view.innerHTML = `
      <div class="row"><h1 style="margin:0">Ask a question</h1><span class="spacer"></span><button class="sm ghost" id="clear-chat">New conversation</button></div>
      <p class="muted">Ask in everyday language. ${AI.enabled ? 'The AI analyst searches and counts the loaded records with exact tools, cites every record it uses, and each answer is fact-checked before you see it.' : 'Answers come from the built-in search engine (the language model is not switched on for this site — see Help).'}</p>
      ${about ? `<div class="callout" style="margin-bottom:12px">Asking about: <b>${esc(about.title)}</b> (#${esc(about.id)})</div>` : ''}
      <div class="chat">
        <div class="msgs" id="msgs" aria-live="polite"></div>
        <div class="composer">
          <div class="suggest" id="sugg">${sugg.map(s => `<button>${esc(s)}</button>`).join('')}</div>
          <form id="ask-form"><textarea id="ask-q" placeholder="Type your question…" aria-label="Your question"></textarea><button class="primary" type="submit">Ask</button></form>
        </div>
      </div>`;
    const msgs = $('#msgs');
    function checksHTML(k) {
      if (!k) return '';
      if (k.noEvidence) return `<div class="check warn">${icon('alert')}<span>No records were consulted for this answer — treat it as general information only.</span></div>`;
      const v = k.verifier || {};
      const issues = [];
      if (k.badCites.length) issues.push(`cited record(s) ${k.badCites.map(x => '#' + esc(x)).join(', ')} were not returned by any search and may not exist`);
      if (k.badNums.length) issues.push(`number(s) ${k.badNums.map(esc).join(', ')} do not appear in the data consulted`);
      (v.unsupported_claims || []).forEach(x => issues.push(`${esc(x.claim)} — ${esc(x.problem || 'not supported')}`));
      if (v.error) issues.push('the independent fact-check could not run (' + esc(v.error) + ')');
      if (!issues.length) return `<div class="check ok">${icon('check')}<span><b>Fact-checked.</b> Every citation points to a record the tools returned, every number appears in the data, and an independent check found no unsupported claims.</span></div>`;
      return `<div class="check warn">${icon('alert')}<span><b>Check before relying on this answer.</b><ul>${issues.map(i => `<li>${i}</li>`).join('')}</ul></span></div>`;
    }
    function paint() {
      msgs.innerHTML = chatLog.length ? chatLog.map(m => m.role === 'user' ? `<div class="msg user">${esc(m.text)}</div>` :
        `<div class="msg bot">${m.html}${checksHTML(m.checks)}${m.cites && m.cites.length ? `<div class="cites"><div class="tiny muted">Records used:</div>${m.cites.map(c => `<button class="cite" data-open="${esc(c.id)}"><b>#${esc(c.id)}</b> ${esc(c.title)} <span class="tiny muted">· ${esc(c.lead)} · ${fmtDate(c.date)}</span></button>`).join('')}</div>` : ''}
          ${m.steps && m.steps.length ? `<details class="tiny" style="margin-top:8px"><summary style="cursor:pointer" class="muted">How this answer was found (${m.steps.length} step${m.steps.length === 1 ? '' : 's'})</summary><ol>${m.steps.map(s => `<li><span class="mono">${esc(s.tool)}</span> ${esc(JSON.stringify(s.input))}</li>`).join('')}</ol></details>` : ''}
          <div class="tiny muted" style="margin-top:8px">${esc(m.engine || '')}</div></div>`).join('')
        : `<div class="empty"><p>Pick a suggestion below or type your own question.</p></div>`;
      bindOpen(msgs);
    }
    paint();
    $$('#sugg button').forEach(b => b.addEventListener('click', () => { $('#ask-q').value = b.textContent; send(); }));
    $('#ask-form').addEventListener('submit', e => { e.preventDefault(); send(); });
    $('#ask-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#clear-chat').addEventListener('click', () => { chatLog.length = 0; paint(); });

    let busy = false;
    async function send() {
      const q0 = $('#ask-q').value.trim(); if (!q0 || busy) return;
      busy = true;
      $('#ask-q').value = '';
      const q = about ? `${q0}\n\n(The user is asking about concern [#${about.id}]. Use get_concern with id "${about.id}".)` : q0;
      const history = chatLog.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.role === 'user' ? m.text : (m.plain || '') }));
      chatLog.push({ role: 'user', text: q0 }); paint();
      msgs.insertAdjacentHTML('beforeend', '<div class="msg bot" id="typing"><span class="typing"><i></i><i></i><i></i></span> <span class="small muted" id="step">Thinking…</span></div>');
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      let out;
      if (AI.enabled) {
        try {
          const r = await AI.ask(q, history, label => { const s = $('#step'); if (s) s.textContent = label + '…'; });
          const s = $('#step'); if (s) s.textContent = 'Fact-checking the answer…';
          out = { html: mdLite(r.answer), plain: r.answer, checks: r.checks, steps: r.steps, cites: r.checks.cites.filter(id => r.seen.includes(id)).map(id => Store.get(id)).filter(Boolean), engine: `Answer by ${r.model} · data tools run on ${fmt(Store.concerns.length)} loaded concerns` };
        } catch (e) {
          out = answerLocal(q0, about); out.engine = 'Built-in engine — the AI service failed: ' + e.message;
        }
      } else out = answerLocal(q0, about);
      chatLog.push(Object.assign({ role: 'bot' }, out));
      busy = false;
      paint(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  });

  /* ---------- Built-in answer engine (no external AI needed) ---------- */
  function answerLocal(q, about) {
    const C = Store.concerns;
    const ql = q.toLowerCase();
    if (about) return answerAbout(q, about);
    const members = NLP.findMembers(q).map(m => m.name);
    const years = (q.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    const themes = NLP.classifyThemes(q).map(t => t.id);
    if (/food|agri/.test(ql)) themes.push('__food');
    const prodCodes = NLP.suggestHS(q, { short: false }).filter(s => s.method === 'Product dictionary').map(s => s.code.slice(0, 4));
    const role = /against|maintain|imposed|measure(s)? (of|by)|target/.test(ql) ? 'responding' : /raised by|raise[sd]?|complain|brought by/.test(ql) ? 'raising' : 'any';
    const intent = /how many|number of|count/.test(ql) ? 'count' : /trend|over time|per year|by year|changed|increas|decreas/.test(ql) ? 'trend' : /which member|which countr|who .*most|most often|top|most active/.test(ql) ? 'top' : 'list';

    let set = C.filter(c => {
      if (members.length && !members.some(m => role === 'responding' ? c.responding === m : role === 'raising' ? c.raisers.includes(m) : (c.raisers.includes(m) || c.responding === m))) return false;
      if (years.length && !(years.length === 2 ? c.year >= Math.min(...years) && c.year <= Math.max(...years) : years.includes(c.year))) return false;
      const th = themes.filter(t => t !== '__food');
      if (th.length && !c.themes.some(t => th.includes(t.id))) return false;
      if (themes.includes('__food') && !Store.finalCodes(c).some(code => +code.slice(0, 2) <= 24) && !c.themes.some(t => ['foodsafety', 'animalplant'].includes(t.id))) return false;
      if (prodCodes.length && !Store.finalCodes(c).some(code => prodCodes.includes(code.slice(0, 4)))) return false;
      return true;
    });
    set = set.filter(c => !c.duplicateOf);
    const filtered = members.length || years.length || themes.length || prodCodes.length;
    const rest = NLP.tokens(q, { keepProcedural: false }).filter(t => !['concern', 'show', 'explain', 'many', 'involve', 'list', 'tell', 'food'].includes(t));
    if (!filtered) {
      const hits = Store.index.search(NLP.tokens(q, { keepProcedural: false }), { limit: 12 });
      set = hits.filter(h => h.score > 1.5 && !h.meta.duplicateOf).map(h => h.meta);
    } else if (rest.length && set.length > 5) {
      const ids = new Set(set.map(c => c.id));
      const ranked = Store.index.search(rest, { limit: 200, filter: d => ids.has(d.id) }).map(h => h.meta);
      set = ranked.concat(set.filter(c => !ranked.includes(c)));
    }
    const desc = [members.length ? (role === 'responding' ? 'about measures maintained by ' : role === 'raising' ? 'raised by ' : 'involving ') + members.join(' or ') : '', themes.filter(t => t !== '__food').length ? 'about ' + NLP.THEMES.filter(t => themes.includes(t.id)).map(t => t.label.toLowerCase()).join(' or ') : '', themes.includes('__food') ? 'about food and agricultural products' : '', prodCodes.length ? 'concerning ' + [...new Set(prodCodes)].map(c => (NLP.hsInfo(c) || {}).desc || c).map(d => d.split(/[;,(]/)[0].toLowerCase()).join(' / ') : '', years.length ? (years.length === 2 ? `between ${Math.min(...years)} and ${Math.max(...years)}` : 'in ' + years.join(', ')) : ''].filter(Boolean).join(', ');
    const stats = { total: C.length, matched: set.length, filter: desc };
    let html = '';
    if (intent === 'top') {
      const key = role === 'responding' || /maintain|measure|against|target/.test(ql) ? 'responding' : 'raising';
      const rows = countBy(set.length ? set : C, c => key === 'responding' ? (c.responding !== 'Not identified' ? c.responding : null) : c.raisers).slice(0, 6);
      html = `<p>${key === 'responding' ? 'Members whose measures were most often challenged' : 'Members that raised the most concerns'}${desc ? ' (' + esc(desc) + ')' : ''}:</p><table class="tbl"><tbody>${rows.map(([m, n], i) => `<tr><td>${i + 1}. ${esc(m)}</td><td class="num">${n} concern${n === 1 ? '' : 's'}</td></tr>`).join('')}</tbody></table>`;
      set = set.length ? set : C;
    } else if (intent === 'trend') {
      const by = countBy(set.length ? set : C, c => c.year ? String(c.year) : null).sort((a, b) => a[0].localeCompare(b[0]));
      html = `<p>Number of concerns by year${desc ? ' (' + esc(desc) + ')' : ''}:</p><p>${by.map(([y, n]) => `<b>${y}</b>: ${n}`).join(' · ') || 'No dated records.'}</p><p class="small"><a href="#/trends">Open Trends &amp; early warning</a> for charts and forecasts.</p>`;
    } else if (!set.length) {
      html = `<p>I could not find any concerns ${desc ? esc(desc) : 'matching that question'} in the loaded data (${fmt(C.length)} concerns from <b>${esc(Store.fileName)}</b>).</p><p class="small">Tips: use a Member name (e.g. “Korea”), a product (“cheese”), or an issue type (“labelling”, “testing”, “transparency”).</p>`;
    } else if (intent === 'count') {
      html = `<p>There ${set.length === 1 ? 'is' : 'are'} <b>${set.length}</b> concern${set.length === 1 ? '' : 's'} ${esc(desc || 'matching your question')} out of ${fmt(C.length)} loaded.</p>`
        + `<p>The most recent ${Math.min(3, set.length) === 1 ? 'is' : 'are'}: ${set.slice(0, 3).map(c => `<a href="#/concern/${encodeURIComponent(c.id)}">${esc(c.title)}</a> (${fmtDate(c.date)})`).join('; ')}.</p>`;
    } else {
      const top = set.slice(0, 4);
      html = `<p>I found <b>${set.length}</b> concern${set.length === 1 ? '' : 's'} ${esc(desc || 'related to your question')}. ${set.length > 4 ? 'Here are the most relevant:' : ''}</p>`
        + top.map(c => `<p><b><a href="#/concern/${encodeURIComponent(c.id)}">${esc(c.title)}</a></b><br><span class="small">${esc(c.summary.short.slice(0, 380))}${c.summary.short.length > 380 ? '…' : ''}</span></p>`).join('');
      const th = countBy(set, c => c.themes.map(t => t.label)).slice(0, 3);
      if (set.length > 1 && th.length) html += `<p class="small muted">Common issue types in these results: ${th.map(([t, n]) => `${esc(t)} (${n})`).join(', ')}.</p>`;
    }
    return { html, cites: set.slice(0, 6), stats, engine: 'Built-in search engine · answers only from loaded records' };
  }

  function answerAbout(q, c) {
    const ql = q.toLowerCase(); let html;
    if (/product|hs|code|good/.test(ql)) {
      const codes = Store.finalCodes(c);
      html = codes.length ? `<p>The products identified are:</p><ul>${codes.map(code => { const i = NLP.hsInfo(code); return `<li><span class="mono">${NLP.hsPretty(code)}</span> — ${esc(i ? i.desc : '')}</li>`; }).join('')}</ul>` : '<p>No specific product could be identified; the measure may apply across many products.</p>';
    } else if (/similar|before|precedent|related/.test(ql)) {
      const hits = Store.index.search(NLP.tokens(c.text, { keepProcedural: false }), { limit: 5, filter: d => d.id !== c.id });
      return { html: hits.length ? `<p>These earlier or related concerns share the most terms with this one:</p>` : '<p>No similar concerns found in the loaded data.</p>', cites: hits.map(h => h.meta), engine: 'Built-in search engine' };
    } else if (/ask|request|want|demand/.test(ql)) {
      html = c.summary.asks.length ? `<ul>${c.summary.asks.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p>The statements do not contain an explicit request.</p>';
    } else {
      html = `<p>${esc(NLP.summarise(c.text, { sentences: 3 }).short)}</p><p class="small">Raised by <b>${esc(c.raisers.join(', '))}</b> about a measure maintained by <b>${esc(c.responding)}</b>; first raised ${fmtDate(c.date)}.</p>`;
    }
    return { html, cites: [c], stats: { about: c.id }, engine: 'Built-in engine' };
  }
})();
