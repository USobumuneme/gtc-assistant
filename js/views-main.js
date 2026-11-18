/* =====================================================================
   Views: Home, Browse concerns, Concern detail
   ===================================================================== */
(function () {
  'use strict';
  const { $, $$, esc, icon, fmt, fmtDate, toast, confBar, aiNote, chart, palette, css, route, go } = UI;

  /* ---------- Shared bits ---------- */
  function themeChips(c, n = 3) { return c.themes.slice(0, n).map(t => `<span class="chip theme">${esc(t.label)}</span>`).join(''); }
  function hsChips(c, n = 3) { return Store.finalCodes(c).slice(0, n).map(code => { const i = NLP.hsInfo(code); return `<span class="chip hs" title="${esc(i ? i.desc : '')}">HS ${NLP.hsPretty(code)}</span>`; }).join(''); }
  window.concernItem = function (c) {
    const reviewed = Store.review(c.id);
    return `<button class="citem" data-open="${esc(c.id)}">
      <div class="meta"><span>${esc(c.committee)}</span><span>#${esc(c.id)}</span><span>${fmtDate(c.date)}</span><span>${c.meetings} meeting${c.meetings === 1 ? '' : 's'}</span>${reviewed ? '<span style="color:var(--green)">✓ reviewed</span>' : ''}${c.duplicateOf ? `<span style="color:var(--amber)">possible duplicate of #${esc(c.duplicateOf)}</span>` : ''}</div>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.summary.short)}</p>
      <div class="chips"><span class="chip">Raised by ${esc(c.raisers.join(', '))}</span><span class="chip att-${c.attention.level}">${c.attention.level} attention</span>${themeChips(c, 2)}${hsChips(c, 2)}</div>
    </button>`;
  };
  function bindOpen(root) { $$('[data-open]', root).forEach(b => b.addEventListener('click', () => go('/concern/' + encodeURIComponent(b.dataset.open)))); }
  window.bindOpen = bindOpen;

  function countBy(arr, fn) { const m = new Map(); arr.forEach(x => { const ks = [].concat(fn(x)).filter(Boolean); ks.forEach(k => m.set(k, (m.get(k) || 0) + 1)); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
  window.countBy = countBy;

  /* =================== HOME =================== */
  route('home', async (view) => {
    const C = Store.concerns;
    const statements = C.reduce((s, c) => s + c.statements.length, 0);
    const members = new Set(); C.forEach(c => { c.raisers.forEach(m => members.add(m)); if (c.responding !== 'Not identified') members.add(c.responding); });
    const withHS = C.filter(c => Store.finalCodes(c).length).length;
    const high = C.filter(c => c.attention.level === 'High');
    const years = C.map(c => c.year).filter(Boolean);
    const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';
    const tasks = [
      ['#/analyse', 'doc', 'Explain a statement', 'Paste any trade-concern text and get a short, plain-language brief.'],
      ['#/hs', 'tag', 'Find a product code', 'Describe a product in your own words and get matching HS codes.'],
      ['#/ask', 'chat', 'Ask a question', '“Which concerns involve labelling?” — answers with sources.'],
      ['#/concerns', 'list', 'Browse all concerns', 'Filter by Member, committee, product or issue type.'],
      ['#/flows', 'globe', 'See trade affected', 'How much of a product is traded, and did it change after a concern?'],
      ['#/trends', 'trend', 'Spot emerging issues', 'Trends over time, hotspots and early-warning signals.']
    ];
    view.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Trade concerns monitoring &amp; analysis</div>
        <h1>What would you like to find out today?</h1>
        <p class="muted" style="font-size:1.05rem">This assistant reads the statements Members make in WTO committees, explains them in plain language, links them to the products and trade flows involved, and highlights patterns over time. No technical knowledge needed — pick a task below.</p>
      </section>
      <div class="task-grid">${tasks.map(([h, i, t, d]) => `<a class="task" href="${h}"><span class="ic">${icon(i)}</span><span><b>${t}</b><span>${d}</span></span></a>`).join('')}</div>

      <h2 style="margin-top:32px">At a glance</h2>
      <p class="muted small" style="margin-top:-4px">Based on <b>${esc(Store.fileName)}</b> · ${Store.source === 'sample' ? 'sample data — load the full database export in <a href="#/data">Data &amp; review</a>' : 'your imported data'}</p>
      <div class="grid g4">
        <div class="kpi"><div class="lbl">Trade concerns</div><div class="val">${fmt(C.length)}</div><div class="sub">${fmt(statements)} statements · ${span}</div></div>
        <div class="kpi"><div class="lbl">Members involved</div><div class="val">${fmt(members.size)}</div><div class="sub">raising or maintaining measures</div></div>
        <div class="kpi"><div class="lbl">Linked to products</div><div class="val">${C.length ? Math.round(withHS / C.length * 100) : 0}%</div><div class="sub">${fmt(withHS)} concerns with HS codes</div></div>
        <div class="kpi"><div class="lbl">Need attention</div><div class="val" style="color:var(--red)">${fmt(high.length)}</div><div class="sub">flagged high by the AI</div></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Most common issue types</h3><a class="small" href="#/trends">More trends →</a></div><div class="chart-box"><canvas id="ch-themes" aria-label="Bar chart of issue types"></canvas></div></div>
        <div class="card"><div class="card-h"><h3>Who raises concerns most often</h3></div><div class="chart-box"><canvas id="ch-raisers" aria-label="Bar chart of raising Members"></canvas></div></div>
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Needing attention</h3><a class="small" href="#/concerns?sort=attention">See all →</a></div>
          <div class="clist">${(high.length ? high : C).slice(0, 4).map(concernItem).join('') || '<p class="muted">No concerns loaded.</p>'}</div></div>
        <div class="card"><div class="card-h"><h3>Measures most often challenged</h3></div>
          <table class="tbl"><thead><tr><th>Member maintaining the measure</th><th class="num">Concerns</th></tr></thead><tbody>
          ${countBy(C, c => c.responding !== 'Not identified' ? c.responding : null).slice(0, 8).map(([m, n]) => `<tr><td><a href="#/concerns?member=${encodeURIComponent(m)}&role=responding">${esc(m)}</a></td><td class="num">${n}</td></tr>`).join('')}
          </tbody></table></div>
      </div>`;
    bindOpen(view);
    const P = palette();
    const th = countBy(C, c => c.themes.map(t => t.label)).slice(0, 7);
    chart($('#ch-themes'), { type: 'bar', data: { labels: th.map(x => x[0]), datasets: [{ data: th.map(x => x[1]), backgroundColor: P[0], borderRadius: 4, barThickness: 16 }] }, options: { indexAxis: 'y', scales: { x: { ticks: { precision: 0 }, grid: { color: css('--line') } }, y: { grid: { display: false } } } } });
    const rs = countBy(C, c => c.raisers).slice(0, 7);
    chart($('#ch-raisers'), { type: 'bar', data: { labels: rs.map(x => x[0]), datasets: [{ data: rs.map(x => x[1]), backgroundColor: P[1], borderRadius: 4, barThickness: 16 }] }, options: { indexAxis: 'y', scales: { x: { ticks: { precision: 0 }, grid: { color: css('--line') } }, y: { grid: { display: false } } } } });
  });

  /* =================== BROWSE =================== */
  route('concerns', async (view, r) => {
    const C = Store.concerns;
    const committees = [...new Set(C.map(c => c.committee))].sort();
    const members = [...new Set(C.flatMap(c => c.raisers.concat(c.responding !== 'Not identified' ? [c.responding] : [])))].sort();
    const themes = NLP.THEMES.filter(t => C.some(c => c.themes.some(x => x.id === t.id)));
    const sectors = countBy(C, c => [...new Set(Store.finalCodes(c).map(code => { const i = NLP.hsInfo(code); return i ? i.section : null; }))]).map(([s]) => s);
    const st = { q: r.q.get('q') || '', committee: r.q.get('committee') || '', member: r.q.get('member') || '', role: r.q.get('role') || 'any', theme: r.q.get('theme') || '', sector: r.q.get('sector') || '', sort: r.q.get('sort') || 'newest', shown: 30 };
    view.innerHTML = `
      <div class="row" style="margin-bottom:6px"><h1 style="margin:0">Browse trade concerns</h1><span class="spacer"></span>
        <button class="sm" id="exp">${icon('down')}Download as spreadsheet</button></div>
      <p class="muted">Use the filters to narrow the list. Click any concern for a plain-language brief, product codes and related trade data.</p>
      <div class="filters">
        <input type="search" id="f-q" placeholder="Words to look for…" value="${esc(st.q)}" aria-label="Search words">
        <select id="f-committee" aria-label="Committee"><option value="">All committees</option>${committees.map(x => `<option ${x === st.committee ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="f-member" aria-label="Member"><option value="">All Members</option>${members.map(x => `<option ${x === st.member ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="f-theme" aria-label="Issue type"><option value="">All issue types</option>${themes.map(t => `<option value="${t.id}" ${t.id === st.theme ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        <select id="f-sector" aria-label="Product sector"><option value="">All product sectors</option>${sectors.map(s => `<option value="${s}" ${s === st.sector ? 'selected' : ''}>${esc(Store.hsRaw.sections[s] || s)}</option>`).join('')}</select>
      </div>
      <div class="row small" style="margin-bottom:12px">
        <span>Member role:</span>
        <select id="f-role" style="width:auto;min-height:34px;padding:4px 10px"><option value="any">raised or maintained</option><option value="raising" ${st.role === 'raising' ? 'selected' : ''}>raised the concern</option><option value="responding" ${st.role === 'responding' ? 'selected' : ''}>maintains the measure</option></select>
        <span style="margin-left:12px">Sort:</span>
        <select id="f-sort" style="width:auto;min-height:34px;padding:4px 10px"><option value="newest">Newest first</option><option value="oldest" ${st.sort === 'oldest' ? 'selected' : ''}>Oldest first</option><option value="attention" ${st.sort === 'attention' ? 'selected' : ''}>Needs attention</option><option value="meetings" ${st.sort === 'meetings' ? 'selected' : ''}>Most discussed</option></select>
        <span class="spacer"></span><span id="count" class="muted"></span>
      </div>
      <div class="clist" id="list"></div>
      <div style="text-align:center;margin-top:16px"><button id="more" hidden>Show more</button></div>`;
    const list = $('#list');
    let results = [];
    function apply() {
      let rs = st.q ? Store.search(st.q, 2000).map(x => x.c) : C.slice();
      rs = rs.filter(c => (!st.committee || c.committee === st.committee)
        && (!st.member || (st.role !== 'responding' && c.raisers.includes(st.member)) || (st.role !== 'raising' && c.responding === st.member))
        && (!st.theme || c.themes.some(t => t.id === st.theme))
        && (!st.sector || Store.finalCodes(c).some(code => { const i = NLP.hsInfo(code); return i && i.section === st.sector; })));
      const att = { High: 3, Medium: 2, Low: 1 };
      if (!st.q || st.sort !== 'newest') {
        if (st.sort === 'oldest') rs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        else if (st.sort === 'attention') rs.sort((a, b) => att[b.attention.level] - att[a.attention.level] || b.attention.score - a.attention.score);
        else if (st.sort === 'meetings') rs.sort((a, b) => b.meetings - a.meetings || b.statements.length - a.statements.length);
        else if (!st.q) rs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      results = rs; st.shown = 30; draw();
      const qs = new URLSearchParams(Object.entries(st).filter(([k, v]) => v && k !== 'shown' && !(k === 'role' && v === 'any') && !(k === 'sort' && v === 'newest')));
      history.replaceState(null, '', '#/concerns' + (qs.toString() ? '?' + qs : ''));
    }
    function draw() {
      $('#count').textContent = `${results.length} concern${results.length === 1 ? '' : 's'}`;
      list.innerHTML = results.slice(0, st.shown).map(concernItem).join('') || `<div class="empty"><p><b>No concerns match these filters.</b></p><p>Try removing a filter or using different words.</p></div>`;
      $('#more').hidden = results.length <= st.shown;
      bindOpen(list);
    }
    let tmr;
    $('#f-q').addEventListener('input', e => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = e.target.value.trim(); apply(); }, 200); });
    [['#f-committee', 'committee'], ['#f-member', 'member'], ['#f-theme', 'theme'], ['#f-sector', 'sector'], ['#f-role', 'role'], ['#f-sort', 'sort']].forEach(([s, k]) => $(s).addEventListener('change', e => { st[k] = e.target.value; apply(); }));
    $('#more').addEventListener('click', () => { st.shown += 30; draw(); });
    $('#exp').addEventListener('click', () => { UI.download('trade-concerns-with-ai-analysis.csv', Store.toCSV()); toast('Spreadsheet downloaded — opens in Excel.'); });
    apply();
  });

  /* =================== DETAIL =================== */
  route('concern', async (view, r) => {
    const c = Store.get(r.arg);
    if (!c) { view.innerHTML = `<div class="card"><h2>Concern not found</h2><p>It may not be in the data currently loaded.</p><a class="btn" href="#/concerns">Browse concerns</a></div>`; return; }
    const rev = Store.review(c.id);
    const codes = Store.finalCodes(c);
    const firstProduct = codes[0];
    const flowsLink = `#/flows?${new URLSearchParams({ hs: firstProduct ? firstProduct.slice(0, 6) : '', importer: c.responding !== 'Not identified' ? c.responding : '', exporter: c.lead, year: c.year || '', concern: c.id })}`;
    view.innerHTML = `
      <div class="no-print" style="margin-bottom:10px"><a href="#/concerns" class="small">${icon('back')} Back to all concerns</a></div>
      <div class="detail-h">
        <div style="min-width:0;flex:1">
          <div class="muted small">${esc(c.committee)} · Concern #${esc(c.id)}</div>
          <h1>${esc(c.title)}</h1>
          <div class="chips"><span class="chip att-${c.attention.level}">${c.attention.level} attention</span>${themeChips(c, 4)}</div>
          ${c.duplicateOf ? `<div class="callout warn small" style="margin-top:10px">Data quality: this record has the same text as <a href="#/concern/${encodeURIComponent(c.duplicateOf)}">concern #${esc(c.duplicateOf)}</a> and may be a duplicate entry.</div>` : ''}
        </div>
        <div class="row no-print">
          <a class="btn primary" href="#/ask?about=${encodeURIComponent(c.id)}">${icon('chat')}Ask about this</a>
          <a class="btn" href="${flowsLink}">${icon('globe')}Trade affected</a>
          <button id="print">${icon('print')}Print brief</button>
        </div>
      </div>
      <dl class="facts" style="margin:18px 0">
        <div><dt>Raised by</dt><dd>${esc(c.lead)}</dd>${c.raisers.length > 1 ? `<div class="tiny muted">supported by ${esc(c.raisers.slice(1).join(', '))}</div>` : ''}</div>
        <div><dt>Measure maintained by</dt><dd>${esc(c.responding)}</dd>${c.respondingGiven ? '' : '<div class="tiny muted">identified by AI</div>'}</div>
        <div><dt>First raised</dt><dd>${fmtDate(c.date)}</dd>${c.lastDate !== c.date ? `<div class="tiny muted">last discussed ${fmtDate(c.lastDate)}</div>` : ''}</div>
        <div><dt>Discussed at</dt><dd>${c.meetings} meeting${c.meetings === 1 ? '' : 's'}</dd><div class="tiny muted">${c.statements.length} statement${c.statements.length === 1 ? '' : 's'}</div></div>
      </dl>
      <div class="grid g-main">
        <div class="stack">
          <div class="card" id="brief-card"></div>
          <div class="card" id="hs-card"></div>
          <div class="card">
            <h2>Type of issue</h2>
            ${c.themes.length ? `<table class="tbl"><tbody>${c.themes.map(t => `<tr><td style="width:38%"><b>${esc(t.label)}</b><div class="tiny muted">${esc(t.plain)}</div></td><td class="small">${c.ai ? 'Evidence: ' + t.evidence.map(e => `<q class="ev">${esc(e)}</q>`).join(' ') : 'Signals found: ' + t.evidence.map(e => `<span class="chip">${esc(e)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No specific issue type detected.</p>'}
            ${c.references.length ? `<h3 style="margin-top:16px">Documents and rules mentioned</h3><div class="chips">${c.references.map(x => `<span class="chip mono">${esc(x)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="card">
            <details class="orig"><summary>Read the original statements (${c.statements.length})</summary>
              ${c.statements.map(s => `<div class="txt" style="margin-top:10px"><b>${esc(s.member)}</b> · ${fmtDate(s.date)}<br>${esc(s.text)}</div>`).join('')}
            </details>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <h3>Why this attention level?</h3>
            <p class="small">${c.attention.why.length ? 'Flagged: ' + c.attention.why.map(esc).join('; ') + '.' : 'No escalation signals were found in the statements.'}</p>
            ${c.ai && c.attention.evidence && c.attention.evidence.length ? `<div class="small">${c.attention.evidence.slice(0, 4).map(e => `<q class="ev">${esc(e)}</q>`).join('<br>')}</div>` : ''}
            <p class="tiny muted" style="margin-top:8px">Transparent rule: verified signals of discrimination or legal inconsistency (2 points each), long-running issues, unanswered questions, claimed trade impact and support from other Members (1 point each). 4+ = High, 2–3 = Medium.</p>
          </div>
          <div class="card"><h3>Discussion history</h3>
            <div class="timeline">${c.statements.map(s => `<div class="ev"><b>${esc(s.member)}</b> <span class="tiny">${fmtDate(s.date)}</span><div class="small muted">${esc(NLP.summarise(s.text, { sentences: 1 }).short.slice(0, 200))}${s.text.length > 200 ? '…' : ''}</div></div>`).join('')}</div>
          </div>
          <div class="card no-print"><div class="card-h"><h3>Similar concerns</h3><span class="tiny muted">by shared terms</span></div><div id="similar"></div></div>
        </div>
      </div>`;
    $('#print').addEventListener('click', () => window.print());
    renderBrief(c);
    renderHS(c);
    renderSimilar(c);
  });

  /* ---------- Plain-language brief (AI-verified or basic) ---------- */
  window.verifiedBadge = function (ai) {
    const rej = ai.log.rejected.length;
    return `<span class="chip ${rej ? 'att-Medium' : 'att-Low'}" title="Share of the AI's factual claims whose quotes were found in the statement">${icon('check')} Fact-checked · ${ai.trust}% of claims verified${rej ? ` · ${rej} rejected` : ''}</span>`;
  };
  window.rejectedHTML = function (ai) {
    if (!ai.log.rejected.length) return '';
    return `<details class="small" style="margin-top:10px"><summary style="cursor:pointer;color:var(--amber)">${ai.log.rejected.length} AI claim${ai.log.rejected.length === 1 ? ' was' : 's were'} rejected by the checks and are not shown</summary>
      <ul class="small">${ai.log.rejected.map(x => `<li><b>${esc(x.field)}</b>: “${esc(x.value)}” — ${esc(x.reason)}</li>`).join('')}</ul></details>`;
  };
  window.aiBriefHTML = function (ai, fallbackSummary) {
    const sum = ai.summary && ai.summaryOk ? ai.summary : fallbackSummary;
    return `
      <p style="font-size:1.04rem">${esc(sum)}</p>
      ${ai.summary && !ai.summaryOk ? `<p class="tiny" style="color:var(--amber)">The AI summary mentioned details not found in the statement (${esc(ai.summaryProblems.join(', '))}), so an extract from the original text is shown instead.</p>` : ''}
      ${ai.coreIssue ? `<h3>What is the problem?</h3><p>${esc(ai.coreIssue.text)}<br><q class="ev">${esc(ai.coreIssue.evidence)}</q></p>` : ''}
      ${ai.measure ? `<h3>The measure</h3><p>${esc(ai.measure.description || '')}${ai.measure.reference ? ` <span class="chip mono">${esc(ai.measure.reference)}</span>` : ''}<br><q class="ev">${esc(ai.measure.evidence)}</q></p>` : ''}
      ${ai.requests.length ? `<h3>What is being asked for?</h3><ul class="brief-list">${ai.requests.map(r => `<li>${esc(r.text)}<br><q class="ev">${esc(r.evidence)}</q></li>`).join('')}</ul>` : ''}`;
  };
  function renderBrief(c) {
    const box = $('#brief-card');
    if (c.ai) {
      box.innerHTML = `<div class="card-h"><h2>In plain language</h2><div class="row no-print">${verifiedBadge(c.ai)}<button class="sm ghost" id="rerun" title="Analyse again">Re-analyse</button></div></div>
        ${aiBriefHTML(c.ai, c.local ? c.local.summary.short : c.summary.short)}
        ${rejectedHTML(c.ai)}
        <div style="margin-top:12px">${aiNote(`Written by ${esc(c.ai.model)}. Every fact above is backed by a quote (in italics) that was automatically matched to the official statement. Analysed ${fmtDate(c.ai.at.slice(0, 10))}.`)}</div>`;
      $('#rerun').addEventListener('click', () => runAI(true));
      return;
    }
    box.innerHTML = `<div class="card-h"><h2>In plain language</h2><span class="chip">Basic engine</span></div>
      <p style="font-size:1.04rem">${esc(c.summary.short)}</p>
      ${c.summary.problems.length ? `<h3>What is the problem?</h3><ul class="brief-list">${c.summary.problems.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${c.summary.asks.length ? `<h3 style="margin-top:12px">What is being asked for?</h3><ul class="brief-list">${c.summary.asks.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${AI.enabled ? `<div class="callout no-print" style="margin:12px 0"><b>Get a fact-checked AI analysis.</b> The language model reads the full statement; every fact it reports must quote the text, and product codes are chosen only from the official HS list.<div style="margin-top:10px"><button class="primary sm" id="run-ai">${icon('spark')}Analyse with AI</button></div></div>` : ''}
      ${aiNote(AI.enabled ? 'Basic engine: sentences selected from the official statements. Use “Analyse with AI” for a verified plain-language analysis.' : 'Basic engine: sentences selected from the official statements. The language model is not switched on for this site (see Help).')}`;
    const b = $('#run-ai'); if (b) b.addEventListener('click', () => runAI(false));
    async function runAI(force) {
      box.innerHTML = `<p class="muted"><span class="spinner"></span> Reading the statement, checking every quote against the source and matching products to official HS codes… (about 10–20 seconds)</p>`;
      try { await AI.analyseConcern(c, { force }); Store.buildIndex(); UI.render(); toast('AI analysis complete and fact-checked'); }
      catch (e) { box.innerHTML = `<h2>In plain language</h2><p style="color:var(--red)">${esc(e.message)}</p><p>${esc(c.summary.short)}</p>`; }
    }
  }

  window.ctxOf = c => ({ id: c.id, title: c.title, raisedBy: c.raisers.join(', '), maintainedBy: c.responding, date: c.date });
  window.mdLite = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4} (.+)$/gm, '<b>$1</b>').replace(/^\s*[-•*] (.+)$/gm, '• $1')
    .replace(/\[#\s*([\w\-]+)\]/g, (m, id) => Store.get(id) ? `<a href="#/concern/${encodeURIComponent(id)}" class="cite-link" data-cite="${esc(id)}">[#${esc(id)}]</a>` : `<span class="bad-cite" title="This reference was not found in the records">[#${esc(id)}?]</span>`)
    .replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>');

  /* ---------- Products & HS codes with human review ---------- */
  function renderHS(c) {
    const box = $('#hs-card');
    const rev = Store.review(c.id);
    const ai = c.ai;
    const sugg = ai ? ai.products.filter(p => p.code).map(p => ({ code: p.code, confidence: p.confidence, status: p.status, phrase: p.phrase, reason: p.reason, evidence: p.evidence, agrees: p.agreesWithBaseline, alts: p.candidates.filter(x => x.code !== p.code).slice(0, 3) }))
      : c.hs.slice(0, 6).map(s => ({ code: s.code, confidence: s.confidence, why: s.evidence, subheading: s.subheading }));
    const unmatched = ai ? ai.products.filter(p => !p.code) : [];
    const selected = new Set(rev && rev.codes ? rev.codes : sugg.filter(s => s.confidence >= (ai ? 0.7 : 0.6)).map(s => s.code));
    const extra = [...selected].filter(code => !sugg.some(s => s.code === code));
    box.innerHTML = `
      <div class="card-h"><h2>Products affected</h2>${rev ? `<span class="chip" style="color:var(--green)">${icon('check')} Reviewed ${fmtDate(rev.at.slice(0, 10))}</span>` : `<span class="chip">${ai ? 'AI-assigned' : 'Basic suggestion'} · not yet reviewed</span>`}</div>
      ${c.hsGiven ? `<p class="small">Codes given in the source data: <span class="chip hs">${esc(c.hsGiven)}</span></p>` : ''}
      ${ai && ai.horizontal ? '<p class="small callout">The AI judged this measure to apply across many products (a horizontal measure), so product codes may not capture its full scope.</p>' : ''}
      ${sugg.length || extra.length ? `<p class="small muted">Tick the codes that are correct, then press <b>Save review</b>. Codes marked “needs review” are not ticked by default.</p>` : `<p class="muted">No specific product was identified. Add a code below if you know it.</p>`}
      <div>${sugg.map(s => hsRow(s, selected.has(s.code))).join('')}${extra.map(code => hsRow({ code }, true)).join('')}</div>
      ${unmatched.length ? `<div class="callout warn small" style="margin-top:10px"><b>Named in the text but not confidently matched:</b> ${unmatched.map(p => `“${esc(p.phrase)}”`).join(', ')}. None of the official HS candidates clearly fits — an expert should assign these.</div>` : ''}
      <div class="row no-print" style="margin-top:12px">
        <input type="text" id="add-code" placeholder="Add a code, e.g. 6905 or 040690" style="max-width:260px" aria-label="Add HS code">
        <button class="sm" id="add-btn">Add</button><span class="spacer"></span>
        ${rev ? '<button class="sm ghost" id="undo">Clear review</button>' : ''}
        <button class="sm primary" id="save">${icon('check')}Save review</button>
      </div>
      <div style="margin-top:12px">${aiNote(ai ? 'The language model could only choose among codes retrieved from the official HS 2022 nomenclature; any other code is rejected automatically. Confidence combines the model’s certainty with agreement from the independent baseline engine.' : 'Basic suggestions from the products named in the text, matched to the official HS 2022 nomenclature.')}</div>`;
    $('#add-btn', box).addEventListener('click', () => {
      const v = $('#add-code', box).value.replace(/\D/g, '');
      if (!NLP.hsInfo(v)) { toast('That code is not in the HS nomenclature. Use 4 or 6 digits.'); return; }
      selected.add(v); Store.setReview(c.id, { codes: [...selected], status: 'Reviewed' }).then(() => renderHS(c)); toast('Code added and saved');
    });
    $('#save', box).addEventListener('click', async () => {
      const codes = $$('input[data-code]:checked', box).map(i => i.dataset.code);
      await Store.setReview(c.id, { codes, status: codes.length ? 'Reviewed' : 'Reviewed – no product' });
      toast('Review saved'); renderHS(c);
    });
    const u = $('#undo', box); if (u) u.addEventListener('click', async () => { await Store.setReview(c.id, null); renderHS(c); });
  }
  window.hsRow = function (s, checked, readonly) {
    const i = NLP.hsInfo(s.code); if (!i) return '';
    const status = s.status ? `<span class="chip ${s.confidence >= 0.7 ? 'att-Low' : 'att-Medium'}">${esc(s.status)}</span>` : '';
    const why = s.phrase ? `<div class="why">Product in text: “${esc(s.phrase)}” · ${esc(s.reason || '')}${s.agrees ? ' · baseline engine agrees' : ''}</div>${s.alts && s.alts.length ? `<div class="tiny muted">Other candidates considered: ${s.alts.map(a => `<span class="mono">${NLP.hsPretty(a.code)}</span>`).join(', ')}</div>` : ''}`
      : s.why ? `<div class="why">Why: ${esc(s.why)}</div>` : '<div class="why">Added by a reviewer</div>';
    const sub = s.subheading ? `<div class="tiny muted">Most likely sub-heading: <span class="mono">${NLP.hsPretty(s.subheading.code)}</span> ${esc(s.subheading.desc)}</div>` : '';
    return `<label class="hsrow">
      <span class="row" style="gap:10px;flex-wrap:nowrap">${readonly ? '' : `<input type="checkbox" data-code="${s.code}" ${checked ? 'checked' : ''} style="width:18px;height:18px">`}<span class="hscode">${NLP.hsPretty(s.code)}</span></span>
      <span><b style="font-weight:600">${esc(i.desc)}</b><div class="tiny muted">Chapter ${i.chapterCode}: ${esc(i.chapter || '')}</div>${sub}${why}</span>
      <span style="text-align:right">${s.confidence != null ? UI.confBar(s.confidence) : ''}<div style="margin-top:4px">${status}</div></span>
    </label>`;
  };

  function renderSimilar(c) {
    const box = $('#similar');
    const q = NLP.tokens(c.text, { keepProcedural: false });
    const list = Store.index.search(q, { limit: 8, filter: d => d.id !== c.id && d.meta.id !== c.duplicateOf && d.meta.duplicateOf !== c.id }).slice(0, 5);
    box.innerHTML = list.length ? list.map(h => `<button class="cite" data-open="${esc(h.meta.id)}"><b>${esc(h.meta.title)}</b><div class="tiny muted">#${esc(h.meta.id)} · ${esc(h.meta.lead)} · ${fmtDate(h.meta.date)}</div></button>`).join('') : '<p class="muted small">No similar concerns in the loaded data.</p>';
    bindOpen(box);
  }
})();
