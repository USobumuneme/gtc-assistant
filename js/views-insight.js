/* =====================================================================
   Views: Trade flows, Trends & early warning, Data & review, Help
   ===================================================================== */
(function () {
  'use strict';
  const { $, $$, esc, icon, fmt, money, pct, fmtDate, toast, aiNote, chart, palette, css, legend, route, go } = UI;

  /* =================== TRADE FLOWS =================== */
  route('flows', async (view, r) => {
    const members = NLP.MEMBERS.slice().sort((a, b) => a.name.localeCompare(b.name));
    const concern = r.q.get('concern') ? Store.get(r.q.get('concern')) : null;
    const year = +(r.q.get('year') || '') || null;
    const thisYear = new Date().getUTCFullYear();
    const from = year ? Math.max(1992, year - 5) : thisYear - 11, to = year ? Math.min(thisYear - 1, year + 5) : thisYear - 2;
    const opt = (sel) => members.map(m => `<option value="${m.name}" ${m.name === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    view.innerHTML = `
      <h1>Trade flows</h1>
      <p class="muted">See how much of a product a Member imports, from whom, and whether trade changed after a concern was raised. Figures come live from <a href="https://comtradeplus.un.org/" target="_blank" rel="noopener">UN Comtrade</a> (values in US dollars).</p>
      ${concern ? `<div class="callout" style="margin-bottom:14px">Linked to concern <a href="#/concern/${encodeURIComponent(concern.id)}"><b>#${esc(concern.id)} ${esc(concern.title)}</b></a>, first raised ${fmtDate(concern.date)}.</div>` : ''}
      <div class="card">
        <div class="grid g3">
          <div><label class="f" for="t-hs">Product (HS code)</label><input type="text" id="t-hs" value="${esc(r.q.get('hs') || '')}" placeholder="e.g. 6905 or 040690"><div class="hint" id="t-hs-name">Don’t know it? <a href="#/hs">Find a product code</a></div></div>
          <div><label class="f" for="t-imp">Importing Member (applies the measure)</label><select id="t-imp"><option value="">Choose…</option>${opt(r.q.get('importer') || '')}</select></div>
          <div><label class="f" for="t-exp">Exporting partner (raised the concern)</label><select id="t-exp"><option value="World">All partners (World)</option>${opt(r.q.get('exporter') || '')}</select></div>
          <div><label class="f" for="t-from">From year</label><input type="number" id="t-from" value="${from}" min="1988" max="${thisYear}"></div>
          <div><label class="f" for="t-to">To year</label><input type="number" id="t-to" value="${to}" min="1988" max="${thisYear}"></div>
          <div><label class="f" for="t-mark">Concern raised in (for before/after)</label><input type="number" id="t-mark" value="${year || ''}" placeholder="optional, e.g. 2019"></div>
        </div>
        <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="primary" id="t-go">${icon('globe')}Show trade</button></div>
      </div>
      <div id="t-out" style="margin-top:16px"></div>`;
    const showName = () => { const i = NLP.hsInfo($('#t-hs').value.replace(/\D/g, '')); $('#t-hs-name').innerHTML = i ? esc(i.desc) : 'Don’t know it? <a href="#/hs">Find a product code</a>'; };
    $('#t-hs').addEventListener('input', showName); showName();
    $('#t-go').addEventListener('click', run);
    if (r.q.get('hs') && r.q.get('importer')) run();

    async function run() {
      const hs = $('#t-hs').value.replace(/\D/g, ''); const imp = $('#t-imp').value; const exp = $('#t-exp').value;
      const f = +$('#t-from').value, t = +$('#t-to').value, mark = +$('#t-mark').value || null;
      const out = $('#t-out');
      if (!NLP.hsInfo(hs) || hs.length < 2) { toast('Please enter a valid HS code (2, 4 or 6 digits).'); return; }
      if (!imp) { toast('Please choose the importing Member.'); return; }
      if (t < f || t - f > 20) { toast('Choose a range of up to 20 years.'); return; }
      const rc = NLP.memberCode(imp), pc = exp === 'World' ? 0 : NLP.memberCode(exp);
      const linkComtrade = `https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=M&CommodityCodes=${hs}&Partners=${pc}&Reporters=${rc}&period=${t}&AggregateBy=none&BreakdownMode=plus`;
      if (!UI.API.status.comtrade) {
        out.innerHTML = `<div class="card"><h2>Live trade data is not available here</h2><p>Trade figures are fetched through this site’s small server function, which runs once the site is deployed on Netlify. If you are viewing a local copy, open the deployed site instead.</p><p>You can still look up these figures directly:</p><div class="row"><a class="btn" href="${linkComtrade}" target="_blank" rel="noopener">Open in UN Comtrade</a><a class="btn" href="https://wits.worldbank.org/" target="_blank" rel="noopener">Open World Bank WITS</a><a class="btn" href="https://stats.wto.org/" target="_blank" rel="noopener">Open WTO Stats</a></div></div>`;
        return;
      }
      out.innerHTML = '<div class="card"><p class="muted"><span class="spinner"></span> Fetching figures from UN Comtrade… this can take a few seconds.</p></div>';
      try {
        const years = []; for (let y = f; y <= t; y++) years.push(y);
        const [series, partners] = await Promise.all([
          UI.API.flows({ reporter: rc, partner: pc, hs, flow: 'M', years: years.join(',') }),
          UI.API.flows({ reporter: rc, partner: 'all', hs, flow: 'M', years: String(Math.min(t, mark ? Math.max(mark, t) : t)) }).catch(() => ({ rows: [] }))
        ]);
        const byYear = new Map(); (series.rows || []).forEach(x => byYear.set(+x.year, (byYear.get(+x.year) || 0) + (+x.value || 0)));
        const ys = years.filter(y => byYear.has(y));
        if (!ys.length) {
          out.innerHTML = `<div class="card"><h2>No figures reported</h2><p>${esc(imp)} has not reported imports of HS ${NLP.hsPretty(hs)} ${exp === 'World' ? '' : 'from ' + esc(exp) + ' '}for ${f}–${t} in UN Comtrade. Try a broader code (4 digits), a different period, or “All partners”.</p><a class="btn" href="${linkComtrade}" target="_blank" rel="noopener">Check in UN Comtrade</a></div>`;
          return;
        }
        let impact = '';
        if (mark) {
          const before = ys.filter(y => y < mark && y >= mark - 3).map(y => byYear.get(y));
          const after = ys.filter(y => y > mark && y <= mark + 3).map(y => byYear.get(y));
          if (before.length && after.length) {
            const b = before.reduce((a, x) => a + x, 0) / before.length, a = after.reduce((s, x) => s + x, 0) / after.length;
            const ch = b ? (a - b) / b * 100 : 0;
            impact = `<div class="grid g3" style="margin-bottom:14px">
              <div class="kpi"><div class="lbl">Average yearly imports before (${before.length} yrs)</div><div class="val">${money(b)}</div></div>
              <div class="kpi"><div class="lbl">Average yearly imports after (${after.length} yrs)</div><div class="val">${money(a)}</div></div>
              <div class="kpi"><div class="lbl">Change</div><div class="val" style="color:${ch < 0 ? 'var(--red)' : 'var(--green)'}">${pct(ch)}</div><div class="sub">${ch < -10 ? 'Trade fell noticeably after the concern' : ch > 10 ? 'Trade grew after the concern' : 'Little change'}</div></div></div>`;
          } else impact = `<p class="small muted">Not enough years either side of ${mark} to compare before and after.</p>`;
        }
        const tp = (partners.rows || []).filter(x => +x.partnerCode !== 0).sort((a, b) => b.value - a.value).slice(0, 10);
        const totalP = tp.reduce((s, x) => s + (+x.value || 0), 0);
        out.innerHTML = `
          <div class="card"><div class="card-h"><h2>${esc(imp)} imports of ${esc(((NLP.hsInfo(hs) || {}).desc || hs).split(/[;,(]/)[0].toLowerCase())} ${exp === 'World' ? 'from the world' : 'from ' + esc(exp)}</h2><span class="tiny muted">Source: UN Comtrade${series.mode === 'preview' ? ' (public preview)' : ''}</span></div>
            ${impact}
            <div class="chart-box tall"><canvas id="t-ch" aria-label="Imports by year"></canvas></div>
            <div style="margin-top:12px">${aiNote('Changes in trade have many causes (prices, demand, exchange rates, other measures). A drop after a concern was raised is a signal worth investigating, not proof of impact.')}</div>
          </div>
          ${tp.length ? `<div class="card"><div class="card-h"><h2>Top suppliers to ${esc(imp)} (${partners.year || ''})</h2></div><table class="tbl"><thead><tr><th>Partner</th><th class="num">Imports (US$)</th><th class="num">Share of top 10</th></tr></thead><tbody>${tp.map(x => `<tr><td>${esc(x.partnerDesc || (NLP.MEMBERS.find(m => m.m49 === +x.partnerCode) || {}).name || ('Partner code ' + x.partnerCode))}</td><td class="num">${money(+x.value)}</td><td class="num">${totalP ? (x.value / totalP * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div>` : ''}`;
        const P = palette();
        chart($('#t-ch'), {
          type: 'bar',
          data: { labels: ys.map(String), datasets: [{ label: 'Imports (US$)', data: ys.map(y => byYear.get(y)), backgroundColor: ys.map(y => mark && y >= mark ? P[2] : P[0]), borderRadius: 4 }] },
          options: { scales: { y: { ticks: { callback: v => money(v) }, grid: { color: css('--line') } }, x: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } }
        });
        if (mark) $('#t-ch').parentElement.insertAdjacentHTML('beforebegin', legend([['Before concern', P[0]], ['From the year the concern was raised', P[2]]]));
      } catch (e) {
        out.innerHTML = `<div class="card"><h2>Could not fetch trade data</h2><p>${esc(e.message)}</p><a class="btn" href="${linkComtrade}" target="_blank" rel="noopener">Open in UN Comtrade instead</a></div>`;
      }
    }
  });

  /* =================== TRENDS & EARLY WARNING =================== */
  function linreg(xs, ys) {
    const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const b = den ? num / den : 0; const a = my - b * mx;
    const resid = Math.sqrt(ys.reduce((s, y, i) => s + (y - (a + b * xs[i])) ** 2, 0) / Math.max(1, n - 2));
    return { a, b, resid, f: x => a + b * x };
  }
  route('trends', async (view) => {
    const C = Store.concerns.filter(c => c.year && !c.duplicateOf);
    const years = [...new Set(C.map(c => c.year))].sort();
    const thin = years.length < 4;
    const minY = years[0], maxY = years[years.length - 1];
    const allYears = []; for (let y = minY; y <= maxY; y++) allYears.push(y);
    const perYear = allYears.map(y => C.filter(c => c.year === y).length);
    // early warning: compare recent window vs earlier
    const win = Math.max(1, Math.min(3, Math.floor(allYears.length / 3)));
    const recent = C.filter(c => c.year > maxY - win), earlier = C.filter(c => c.year <= maxY - win);
    const share = (set, fn) => { const m = new Map(); set.forEach(c => [...new Set([].concat(fn(c)))].filter(Boolean).forEach(k => m.set(k, (m.get(k) || 0) + 1))); return m; };
    function rising(fn, label) {
      const r = share(recent, fn), e = share(earlier, fn);
      return [...new Set([...r.keys(), ...e.keys()])].map(k => {
        const rs = recent.length ? (r.get(k) || 0) / recent.length : 0, es = earlier.length ? (e.get(k) || 0) / earlier.length : 0;
        return { k, rs, es, d: rs - es, n: r.get(k) || 0, label };
      }).filter(x => x.n >= 1).sort((a, b) => b.d - a.d);
    }
    const riseThemes = rising(c => c.themes.map(t => t.label), 'Issue type');
    const riseChap = rising(c => Store.finalCodes(c).map(code => { const i = NLP.hsInfo(code.slice(0, 2)); return i ? 'Ch. ' + code.slice(0, 2) + ' ' + i.desc.split(';')[0].slice(0, 40) : null; }), 'Product group');
    const riseResp = rising(c => c.responding !== 'Not identified' ? c.responding : null, 'Measures by');
    const signals = [...riseThemes.slice(0, 3), ...riseChap.slice(0, 2), ...riseResp.slice(0, 2)].filter(x => x.d > 0.05).sort((a, b) => b.d - a.d).slice(0, 6);

    // forecast
    let fc = null;
    if (allYears.length >= 4) {
      const lastN = allYears.slice(-10), ys = perYear.slice(-10);
      const lr = linreg(lastN, ys);
      fc = [1, 2, 3].map(h => { const y = maxY + h; const v = Math.max(0, lr.f(y)); return { y, v, lo: Math.max(0, v - 1.64 * lr.resid), hi: v + 1.64 * lr.resid }; });
      fc.slope = lr.b;
    }
    // member network
    const topR = countBy(C, c => c.raisers).slice(0, 10).map(x => x[0]);
    const topM = countBy(C, c => c.responding !== 'Not identified' ? c.responding : null).slice(0, 10).map(x => x[0]);
    const cell = (a, b) => C.filter(c => c.raisers.includes(a) && c.responding === b).length;
    const maxCell = Math.max(1, ...topR.flatMap(a => topM.map(b => cell(a, b))));
    const sections = countBy(C, c => [...new Set(Store.finalCodes(c).map(code => (NLP.hsInfo(code) || {}).section).filter(Boolean))]);
    const themesByPeriod = (() => {
      const bucket = allYears.length > 12 ? 5 : 1;
      const keys = [...new Set(C.map(c => bucket === 1 ? c.year : Math.floor(c.year / 5) * 5))].sort();
      const th = countBy(C, c => c.themes.map(t => t.label)).slice(0, 8).map(x => x[0]);
      return { keys, th, bucket, get: (t, k) => C.filter(c => (bucket === 1 ? c.year : Math.floor(c.year / 5) * 5) === k && c.themes.some(x => x.label === t)).length };
    })();
    const maxTP = Math.max(1, ...themesByPeriod.th.flatMap(t => themesByPeriod.keys.map(k => themesByPeriod.get(t, k))));
    const heatBg = (v, m) => v ? `background:color-mix(in srgb, var(--accent) ${Math.round(15 + 70 * v / m)}%, var(--surface));color:${v / m > .55 ? '#fff' : 'var(--ink)'}` : 'background:var(--surface-2);color:var(--ink-3)';

    const statsForAI = {
      data_period: `${minY}-${maxY}`, total_concerns: C.length,
      concerns_per_year: Object.fromEntries(allYears.map((y, i) => [y, perYear[i]])),
      forecast_next_years: fc ? fc.map(x => ({ year: x.y, expected: Math.round(x.v), likely_low: Math.round(x.lo), likely_high: Math.round(x.hi) })) : 'not available (fewer than 4 years of data)',
      long_run_trend: fc ? (fc.slope > 0.3 ? 'rising' : fc.slope < -0.3 ? 'falling' : 'broadly stable') : 'unknown',
      early_warning_signals: signals.map(x => ({ type: x.label, item: x.k, share_of_recent_concerns_pct: Math.round(x.rs * 100), share_before_pct: Math.round(x.es * 100), recent_count: x.n })),
      recent_window_years: win,
      top_issue_types: countBy(C, c => c.themes.map(t => t.label)).slice(0, 6).map(([k, n]) => ({ issue: k, concerns: n })),
      top_raising_members: countBy(C, c => c.raisers).slice(0, 6).map(([k, n]) => ({ member: k, concerns: n })),
      top_members_maintaining_measures: countBy(C, c => c.responding !== 'Not identified' ? c.responding : null).slice(0, 6).map(([k, n]) => ({ member: k, concerns: n }))
    };
    view.innerHTML = `
      <h1>Trends &amp; early warning</h1>
      <p class="muted">Patterns across ${fmt(C.length)} concerns from ${minY} to ${maxY}. Early-warning signals compare the most recent ${win} year${win > 1 ? 's' : ''} with earlier years.</p>
      ${thin ? `<div class="callout warn" style="margin-bottom:16px"><b>Limited history loaded.</b> The current file covers only ${years.length} year${years.length === 1 ? '' : 's'}, so trends and forecasts are illustrative. <a href="#/data">Load the full Trade Concerns Database export</a> to see real long-term patterns.</div>` : ''}
      ${AI.enabled ? `<div class="card" id="narr" style="margin-bottom:16px"><div class="card-h"><h2>What the data says</h2></div><p class="small muted">The language model writes a short commentary using only the statistics on this page. Any number it writes is checked against those statistics.</p><button class="primary sm" id="narr-go">${icon('spark')}Write AI commentary</button></div>` : ''}
      <div class="grid g-main">
        <div class="card"><div class="card-h"><h2>Concerns raised per year</h2><span class="tiny muted">${fc ? 'Dashed: 3-year forecast (indicative)' : ''}</span></div>
          ${fc ? legend([['Recorded', palette()[0]], ['Forecast', palette()[2]]]) : ''}
          <div class="chart-box tall"><canvas id="tr-year"></canvas></div>
          ${fc ? `<p class="small" style="margin-top:10px">If recent patterns continue, around <b>${Math.round(fc[0].v)}</b> new concerns would be expected in ${fc[0].y} (likely range ${Math.round(fc[0].lo)}–${Math.round(fc[0].hi)}). The long-run trend is ${fc.slope > 0.3 ? '<b>rising</b>' : fc.slope < -0.3 ? '<b>falling</b>' : '<b>broadly stable</b>'}.</p>` : '<p class="small muted">At least four years of data are needed for a forecast.</p>'}
        </div>
        <div class="card"><h2>Early-warning signals</h2>
          <p class="small muted">Topics, products and Members appearing more often recently than before.</p>
          ${signals.length ? signals.map(s => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row" style="gap:8px"><span class="chip">${esc(s.label)}</span><b>${esc(s.k)}</b></div><div class="small muted">${Math.round(s.rs * 100)}% of recent concerns vs ${Math.round(s.es * 100)}% before · ${s.n} recent</div></div>`).join('') : '<p class="muted small">No clear rising signals in the loaded period.</p>'}
          <div style="margin-top:12px">${aiNote('Signals are statistical patterns, not predictions of disputes. Use them to decide what to look at more closely.')}</div>
        </div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h2>Issue types over time</h2><span class="tiny muted">${themesByPeriod.bucket === 5 ? 'by 5-year period' : 'by year'} · darker = more concerns</span></div>
        <div class="tbl-wrap"><table class="heat"><thead><tr><th></th>${themesByPeriod.keys.map(k => `<th>${themesByPeriod.bucket === 5 ? k + '–' + (k + 4) : k}</th>`).join('')}</tr></thead>
        <tbody>${themesByPeriod.th.map(t => `<tr><th>${esc(t)}</th>${themesByPeriod.keys.map(k => { const v = themesByPeriod.get(t, k); return `<td style="${heatBg(v, maxTP)}" title="${esc(t)}: ${v}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h2>Who raises concerns about whom</h2></div><p class="small muted">Rows: Member raising · Columns: Member maintaining the measure</p>
          <div class="tbl-wrap"><table class="heat"><thead><tr><th></th>${topM.map(m => `<th>${esc(m)}</th>`).join('')}</tr></thead><tbody>${topR.map(a => `<tr><th>${esc(a)}</th>${topM.map(b => { const v = cell(a, b); return `<td style="${heatBg(v, maxCell)}" title="${esc(a)} → ${esc(b)}: ${v}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h2>Product sectors affected</h2></div><div class="chart-box tall"><canvas id="tr-sec"></canvas></div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h2>By committee</h2></div><div class="chart-box" style="height:${Math.max(140, countBy(C, c => c.committee).length * 36 + 40)}px"><canvas id="tr-com"></canvas></div></div>`;

    const ng = $('#narr-go');
    if (ng) ng.addEventListener('click', async () => {
      const box = $('#narr'); box.innerHTML = '<p class="muted"><span class="spinner"></span> Writing commentary from the statistics…</p>';
      try {
        const n = await AI.narrate(statsForAI); const r = n.result;
        box.innerHTML = `<div class="card-h"><h2>What the data says</h2>${n.badNums.length ? `<span class="chip att-Medium">${icon('alert')} ${n.badNums.length} number(s) not in the statistics</span>` : `<span class="chip att-Low">${icon('check')} All numbers checked</span>`}</div>
          <p style="font-size:1.05rem"><b>${esc(r.headline || '')}</b></p><ul>${(r.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>${r.caveat ? `<p class="small muted">${esc(r.caveat)}</p>` : ''}
          ${n.badNums.length ? `<div class="check warn">${icon('alert')}<span>These numbers do not appear in the statistics and may be wrong: ${n.badNums.map(esc).join(', ')}</span></div>` : ''}
          <div style="margin-top:10px">${aiNote(`Written by ${esc(n.model)} from the statistics shown on this page only.`)}</div>`;
      } catch (e) { box.innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`; }
    });
    const P = palette();
    const labels = allYears.map(String).concat(fc ? fc.map(x => String(x.y)) : []);
    chart($('#tr-year'), {
      type: 'bar',
      data: { labels, datasets: [
        { type: 'bar', label: 'Concerns', data: perYear.concat(fc ? fc.map(() => null) : []), backgroundColor: P[0], borderRadius: 4 },
        ...(fc ? [{ type: 'line', label: 'Forecast', data: allYears.map((y, i) => i === allYears.length - 1 ? perYear[i] : null).concat(fc.map(x => Math.round(x.v * 10) / 10)), borderColor: P[2], borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: P[2], spanGaps: true }] : [])
      ] },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: css('--line') } }, x: { grid: { display: false } } } }
    });
    const sec = sections.slice(0, 10);
    chart($('#tr-sec'), { type: 'bar', data: { labels: sec.map(([s]) => (s => s.length > 30 ? s.slice(0, 29) + '…' : s)((Store.hsRaw.sections[s] || s).split(';')[0].replace(/^./, c => c.toUpperCase()))), datasets: [{ data: sec.map(x => x[1]), backgroundColor: P[1], borderRadius: 4, barThickness: 16 }] }, options: { indexAxis: 'y', scales: { x: { ticks: { precision: 0 }, grid: { color: css('--line') } }, y: { grid: { display: false } } } } });
    const com = countBy(C, c => c.committee);
    chart($('#tr-com'), { type: 'bar', data: { labels: com.map(x => x[0]), datasets: [{ data: com.map(x => x[1]), backgroundColor: P[3], borderRadius: 4, barThickness: 18 }] }, options: { indexAxis: 'y', scales: { x: { ticks: { precision: 0 }, grid: { color: css('--line') } }, y: { grid: { display: false } } } } });
  });

  /* =================== DATA & REVIEW =================== */
  function prf(pairs) {
    // pairs: [{pred:[codes4], gold:[codes4]}]  micro-averaged at 4-digit heading level
    let tp = 0, fp = 0, fn = 0;
    pairs.forEach(({ pred, gold }) => { const P = new Set(pred), G = new Set(gold); P.forEach(p => G.has(p) ? tp++ : fp++); G.forEach(g => { if (!P.has(g)) fn++; }); });
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    const top1 = pairs.filter(x => x.pred[0] && x.gold.includes(x.pred[0])).length;
    return { n: pairs.length, precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, top1: pairs.length ? top1 / pairs.length : 0 };
  }
  route('data', async (view) => {
    const C = Store.concerns;
    const reviewed = C.filter(c => Store.review(c.id));
    const h4 = codes => [...new Set(codes.map(x => String(x).replace(/\D/g, '').slice(0, 4)).filter(x => x.length === 4))];
    const evalReview = prf(reviewed.map(c => ({ pred: h4(c.products.map(p => p.code)), gold: h4(Store.review(c.id).codes || []) })));
    const given = C.filter(c => c.hsGiven);
    const evalGiven = prf(given.map(c => ({ pred: h4(c.products.map(p => p.code)), gold: h4(c.hsGiven.split(/[;,\s]+/)) })));
    const cm = Store.colmap;
    const aiDone = AI.coverage(C);
    const withAI = C.filter(c => c.ai);
    const rejectedTotal = withAI.reduce((s, c) => s + c.ai.log.rejected.length, 0);
    const avgTrust = withAI.length ? Math.round(withAI.reduce((s, c) => s + c.ai.trust, 0) / withAI.length) : 0;
    const needReview = withAI.reduce((s, c) => s + c.ai.products.filter(p => !p.code || p.confidence < 0.7).length, 0);
    const givenAI = given.filter(c => c.ai);
    const evalAI = prf(givenAI.map(c => ({ pred: h4(c.products.map(p => p.code)), gold: h4(c.hsGiven.split(/[;,\s]+/)) })));
    const evalBase = prf(givenAI.map(c => ({ pred: h4(c.local.products.map(p => p.code)), gold: h4(c.hsGiven.split(/[;,\s]+/)) })));
    const queue = C.filter(c => !Store.review(c.id)).sort((a, b) => (a.products[0] ? a.products[0].confidence : 0) - (b.products[0] ? b.products[0].confidence : 0)).slice(0, 8);
    const metric = (lbl, e) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${e.n ? Math.round(e.f1 * 100) + '%' : '—'}</div><div class="sub">${e.n ? `F1 · precision ${Math.round(e.precision * 100)}% · recall ${Math.round(e.recall * 100)}% · top-1 ${Math.round(e.top1 * 100)}% · n=${e.n}` : 'no data yet'}</div></div>`;
    view.innerHTML = `
      <h1>Data &amp; review</h1>
      <p class="muted">Load the latest trade-concern records, check the AI’s product codes, measure its accuracy and download the results.</p>
      <div class="grid g2">
        <div class="card">
          <h2>1. Load your data</h2>
          <p class="small">Currently using <b>${esc(Store.fileName)}</b> — ${fmt(Store.rowCount || 0)} rows grouped into ${fmt(C.length)} concerns${Store.source === 'sample' ? ' (sample)' : ''}.</p>
          <div class="drop" id="drop"><p style="margin:0 0 8px"><b>Drop a CSV or Excel file here</b></p><p class="small muted" style="margin:0 0 12px">or</p><label class="btn primary" for="file">${icon('up')}Choose a file</label><input type="file" id="file" accept=".csv,.txt,.xlsx,.xls" hidden></div>
          <details style="margin-top:12px"><summary class="small" style="cursor:pointer;color:var(--brand-2)">How do I get the full database?</summary>
            <ol class="small" style="margin-top:8px"><li>Open the <a href="https://tradeconcerns.wto.org/en" target="_blank" rel="noopener">WTO Trade Concerns Database</a>.</li><li>Choose the committee(s) and period, then use its export option to download the results.</li><li>Drop the downloaded file here. Columns are detected automatically (ID, committee, date, Member, title, summary, HS codes…).</li></ol>
            <p class="small muted">Your file stays in this browser — it is not uploaded to any server.</p></details>
          ${C.some(c => c.duplicateOf) ? `<p class="small" style="color:var(--amber)">Data quality: ${C.filter(c => c.duplicateOf).length} record(s) look like duplicates (identical text under a different ID): ${C.filter(c => c.duplicateOf).map(c => `<a href="#/concern/${encodeURIComponent(c.id)}">#${esc(c.id)}</a> = #${esc(c.duplicateOf)}`).join(', ')}. They are left out of answers and counted once in trends.</p>` : ''}
          <p class="small" style="margin-top:10px">Columns detected: ${Object.entries(cm).map(([k, v]) => `<span class="chip">${esc(k)} ← ${esc(v)}</span>`).join(' ') || '—'}</p>
          ${Store.source !== 'sample' ? '<button class="sm" id="reset">Go back to the sample data</button>' : ''}
        </div>
        <div class="card">
          <h2>2. Download results</h2>
          <p class="small">Every concern with its plain-language summary, issue types, AI product codes, confidence, your reviewed codes and attention level.</p>
          <div class="row"><button class="primary" id="dl-csv">${icon('down')}Spreadsheet (CSV)</button><button id="dl-json">${icon('down')}JSON (for developers)</button><button id="dl-rev">${icon('down')}Review decisions</button></div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-h"><h2>AI analysis with fact-checking</h2><span class="small muted">${aiDone} of ${C.length} concerns analysed</span></div>
        <div class="progress" style="margin-bottom:14px"><i id="ai-bar" style="width:${C.length ? aiDone / C.length * 100 : 0}%"></i></div>
        ${AI.enabled ? `
          <p class="small">The language model reads every statement. Each fact it reports must quote the statement word-for-word (quotes are matched automatically), product codes are chosen only from official HS candidates, and anything that fails a check is rejected and logged. Results are saved in this browser, so each concern is analysed once.</p>
          <div class="row"><button class="primary" id="ai-all" ${aiDone === C.length ? 'disabled' : ''}>${icon('spark')}${aiDone === C.length ? 'All concerns analysed' : 'Analyse ' + (aiDone ? 'the remaining ' + (C.length - aiDone) : 'all ' + C.length) + ' concerns'}</button><button id="ai-stop" hidden>Stop</button>${aiDone ? '<button class="ghost" id="ai-clear">Clear AI results</button>' : ''}<span class="small muted" id="ai-msg"></span></div>`
          : '<p class="small">The language model is not switched on for this site, so the app uses its basic engine. An administrator can enable it by adding <span class="mono">ANTHROPIC_API_KEY</span> in Netlify (see Help).</p>'}
        ${withAI.length ? `<div class="grid g4" style="margin-top:16px">
          <div class="kpi"><div class="lbl">AI claims verified</div><div class="val">${avgTrust}%</div><div class="sub">average evidence-match rate</div></div>
          <div class="kpi"><div class="lbl">Claims rejected</div><div class="val">${rejectedTotal}</div><div class="sub">failed a check — never shown as fact</div></div>
          <div class="kpi"><div class="lbl">Products needing review</div><div class="val">${needReview}</div><div class="sub">low certainty or no official match</div></div>
          <div class="kpi"><div class="lbl">Analysed</div><div class="val">${withAI.length}</div><div class="sub">by ${esc([...new Set(withAI.map(c => c.ai.model))].join(', '))}</div></div></div>` : ''}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-h"><h2>3. Review the AI’s product codes</h2><span class="small muted">${reviewed.length} of ${C.length} reviewed</span></div>
        <div class="progress" style="margin-bottom:14px"><i style="width:${C.length ? reviewed.length / C.length * 100 : 0}%"></i></div>
        <p class="small">Human review keeps the AI accountable. Start with the least certain suggestions below — open one, tick the right codes, and save. Reviewed codes are used everywhere in the app and in exports.</p>
        <div class="clist">${queue.map(concernItem).join('') || '<p class="muted">Everything has been reviewed. 🎉</p>'}</div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>4. How accurate is the AI?</h2>
        <p class="small">Measured at the 4-digit HS heading level, as required for evaluation (precision, recall, F1). Scores update as you review.</p>
        <div class="grid g2">${metric('Against your reviews', evalReview)}${metric('Against HS codes in the source file', evalGiven)}</div>
        ${givenAI.length ? `<h3 style="margin-top:16px">Language model vs basic engine (same ${givenAI.length} concerns with known codes)</h3><div class="grid g2">${metric('Language model + checks', evalAI)}${metric('Basic engine', evalBase)}</div>` : ''}
        <p class="tiny muted" style="margin-top:10px">Precision: of the codes the AI suggested, how many were right. Recall: of the right codes, how many the AI found. F1 balances both. Top-1: the AI’s first suggestion was correct.</p>
      </div>`;
    bindOpen(view);
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) load(f); });
    $('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) load(f); });
    async function load(f) {
      drop.innerHTML = '<p><span class="spinner"></span> Reading and analysing… large files can take a minute.</p>';
      await new Promise(r => setTimeout(r, 30));
      try {
        if (/\.xlsx?$/i.test(f.name)) {
          if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader. Please save the file as CSV and try again.')); document.head.appendChild(s); });
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          f = new File([csv], f.name.replace(/\.xlsx?$/i, '.csv'), { type: 'text/csv' });
        }
        const info = await Store.importFile(f);
        updateLabel();
        toast(`Loaded ${fmt(info.concerns)} concerns from ${fmt(info.rows)} rows`);
        UI.render();
      } catch (e) { toast(e.message, 6000); UI.render(); }
    }
    const rs = $('#reset'); if (rs) rs.addEventListener('click', async () => { await Store.resetToSample(); updateLabel(); toast('Sample data restored'); UI.render(); });
    $('#dl-csv').addEventListener('click', () => UI.download('trade-concerns-with-ai-analysis.csv', Store.toCSV()));
    $('#dl-json').addEventListener('click', () => UI.download('trade-concerns.json', JSON.stringify(Store.concerns.map(c => Object.assign(ctxOf(c), { summary: c.summary.short, attention: c.attention.level, hsSuggested: c.hs.map(h => ({ code: h.code, confidence: h.confidence, evidence: h.evidence })), review: Store.review(c.id) })), null, 2), 'application/json'));
    $('#dl-rev').addEventListener('click', () => UI.download('hs-review-decisions.json', JSON.stringify(Store.reviews, null, 2), 'application/json'));
    const allBtn = $('#ai-all');
    if (allBtn) allBtn.addEventListener('click', async () => {
      const ctrl = new AbortController(); const stop = $('#ai-stop'); stop.hidden = false; allBtn.disabled = true;
      stop.onclick = () => { ctrl.abort(); $('#ai-msg').textContent = 'Stopping after the current concern…'; };
      const startDone = AI.coverage(C);
      const res = await AI.analyseMany(C, (d, total, failed) => { $('#ai-msg').textContent = `Analysed ${d} of ${total}${failed ? ` · ${failed} failed` : ''}`; $('#ai-bar').style.width = ((startDone + d) / C.length * 100) + '%'; }, ctrl.signal);
      Store.buildIndex();
      toast(res.failed ? `Finished with ${res.failed} error(s): ${res.errors[0]}` : 'All concerns analysed and fact-checked', 6000);
      UI.render();
    });
    const clr = $('#ai-clear'); if (clr) clr.addEventListener('click', async () => { if (!confirm('Remove all saved AI analyses from this browser?')) return; await AI.clearCache(); await Store.resetCurrent(); UI.render(); });
  });

  /* =================== HELP =================== */
  route('help', async (view) => {
    const s = UI.API.status;
    view.innerHTML = `
      <h1>Help &amp; guide</h1>
      <div class="grid g2">
        <div class="card"><h2>Getting started in 5 steps</h2>
          <ol class="steps">
            <li><b>Browse concerns.</b> Use the filters to find concerns by Member, committee, product sector or issue type.</li>
            <li><b>Open a concern.</b> Read the plain-language summary, the products involved and why it was flagged.</li>
            <li><b>Check the product codes.</b> Tick the correct HS codes and press <i>Save review</i>.</li>
            <li><b>See trade affected.</b> Press <i>Trade affected</i> to view imports before and after the concern was raised.</li>
            <li><b>Ask a question</b> in everyday language, or <b>download a spreadsheet</b> from Data &amp; review.</li>
          </ol></div>
        <div class="card"><h2>Words you will see</h2>
          <dl class="glossary">
            <dt>Trade concern</dt><dd>An issue a WTO Member raises in a committee about another Member’s measure that may affect its trade.</dd>
            <dt>Raised by / maintained by</dt><dd>The Member raising the concern, and the Member whose rule or measure is being discussed.</dd>
            <dt>HS code</dt><dd>The Harmonized System — the international product code list used by customs. 2 digits = chapter, 4 = heading, 6 = sub-heading.</dd>
            <dt>TBT / SPS</dt><dd>Committees on Technical Barriers to Trade (product rules, labels, testing) and Sanitary and Phytosanitary measures (food safety, animal and plant health).</dd>
            <dt>Confidence</dt><dd>How sure the AI is. <b>High</b>: product clearly named. <b>Medium</b>: likely. <b>Low</b>: a guess — please check.</dd>
            <dt>Fact-checked / verified</dt><dd>The AI’s statement was matched automatically to a quote in the official text, or (for answers) to the records it looked up. Italic quotes show the evidence.</dd>
            <dt>Attention level</dt><dd>A simple flag based on signals such as alleged discrimination, legal inconsistency, or a long-running issue.</dd>
          </dl></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>How the AI works</h2>
        <div class="grid g3">
          <div><h3>1. Evidence-gated reading</h3><p class="small">The language model reads each statement and must back every fact (who, what measure, what is asked, issue types, products) with a word-for-word quote. The app matches each quote against the official text. Facts without a matching quote are rejected and listed, never shown as fact.</p></div>
          <div><h3>2. Closed-set product codes</h3><p class="small">For each product named, the app retrieves candidate codes from the full HS 2022 nomenclature. The model may only choose from that list (or say “none fits”). Any other code is rejected. Low-certainty choices are marked “needs review” and are not ticked by default.</p></div>
          <div><h3>3. Tool-based answers, then fact-check</h3><p class="small">For questions, the AI analyst searches and counts the records with exact tools — it never counts from memory. Answers must cite records the tools returned. The app then checks every citation and number, and an independent fact-checking pass lists any unsupported claim.</p></div>
        </div>
        <p class="small" style="margin-top:8px">Without the language model, a basic engine (dictionary + search over the HS nomenclature + extractive summaries) keeps every page working.</p>
        <h3 style="margin-top:12px">Current status</h3>
        <table class="tbl"><tbody>
          <tr><td>Basic engine (summaries, HS search, filters)</td><td><span class="dot on"></span> Always on, runs in your browser</td></tr>
          <tr><td>Language model with fact-checking</td><td>${s.llm ? `<span class="dot on"></span> On · <span class="mono">${esc(s.model)}</span>${s.fastModel && s.fastModel !== s.model ? ` (checks: <span class="mono">${esc(s.fastModel)}</span>)` : ''}${s.requiresCode ? ' · access code required' : ''}` : '<span class="dot"></span> Off — administrator can enable'}</td></tr>
          <tr><td>Live trade data (UN Comtrade)</td><td>${s.comtrade ? `<span class="dot on"></span> On (${esc(s.comtradeMode)})` : '<span class="dot warn"></span> Only on the deployed site'}</td></tr>
        </tbody></table>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h2>Privacy &amp; responsible AI</h2>
          <ul class="small"><li>Data you load stays in your browser. Nothing is uploaded unless the optional language model is switched on, in which case only the question and the few records needed to answer it are sent.</li>
          <li>All AI output is labelled and explains its reasoning. Human review of product codes is built in and measured.</li>
          <li>The tool supports analysis; it does not make legal determinations about WTO consistency.</li></ul></div>
        <div class="card"><h2>For administrators</h2>
          <p class="small">Hosted on Netlify. In <i>Site settings → Environment variables</i>:</p>
          <ul class="small"><li><span class="mono">ANTHROPIC_API_KEY</span> — switches on the language model. Optional: <span class="mono">ANTHROPIC_MODEL</span>, <span class="mono">ANTHROPIC_FAST_MODEL</span> (for extraction and checks).</li>
          <li><span class="mono">APP_ACCESS_CODE</span> — strongly recommended: users must enter this code before using AI features, so strangers cannot spend your credits.</li>
          <li><span class="mono">COMTRADE_API_KEY</span> — optional UN Comtrade subscription key for full trade data (without it the free public preview is used).</li></ul>
          <p class="small">See <span class="mono">README.md</span> in the project for full deployment steps.</p></div>
      </div>
      <p class="disclaimer">GTC Assistant is an independent research prototype developed to explore AI support for trade-concern analysis. It is not an official product of, or endorsed by, the World Trade Organization. Trade-concern texts are as supplied in the loaded file; HS nomenclature from the World Customs Organization’s Harmonized System (HS 2022) via the open “datasets/harmonized-system” collection; trade statistics from UN Comtrade.</p>`;
  });

  /* =================== STATUS HELPERS =================== */
  window.updateLabel = function () { const el = $('#dataset-label'); if (el) el.innerHTML = `<b>${fmt(Store.concerns.length)}</b> concerns loaded<br><span>${esc(Store.fileName)}</span>`; };
  window.updateStatus = async function () {
    const s = UI.API.status;
    const el = $('#ai-status'); if (!el) return;
    el.innerHTML = `<span class="dot ${s.llm ? 'on' : 'warn'}"></span>${s.llm ? 'AI with fact-checking' : 'Basic engine'}${s.comtrade ? ' · live trade data' : ''}`;
  };
})();
