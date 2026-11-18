/* GTC Assistant — start-up */
(function () {
  'use strict';
  const { $ } = UI;

  // Theme toggle (remembered per browser)
  try { const t = localStorage.getItem('gtc-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { }
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gtc-theme', next); } catch (e) { }
    UI.render();
  });
  // Mobile menu
  $('#menu-btn').addEventListener('click', () => { $('#side').classList.add('open'); $('#scrim').classList.add('open'); });
  $('#scrim').addEventListener('click', () => { $('#side').classList.remove('open'); $('#scrim').classList.remove('open'); });
  // Global search → Browse
  $('#global-search').addEventListener('submit', e => { e.preventDefault(); const q = $('#global-q').value.trim(); UI.go('/concerns' + (q ? '?q=' + encodeURIComponent(q) : '')); });

  async function start() {
    try {
      await Store.init();
    } catch (e) {
      $('#view').innerHTML = `<div class="card"><h2>Could not load data</h2><p>${UI.esc(e.message)}</p><p class="small muted">If you opened index.html directly from your computer, please run it from a web server or the deployed Netlify site (browsers block local file loading).</p></div>`;
      return;
    }
    updateLabel();
    window.addEventListener('hashchange', UI.render);
    UI.render();
    await UI.API.health();
    updateStatus();
    if (UI.API.status.llm || UI.API.status.comtrade) UI.render();
  }
  start();
})();
