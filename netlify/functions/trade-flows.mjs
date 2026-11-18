// GET /api/trade-flows?reporter=376&partner=0|all|<code>&hs=6905&flow=M&years=2015,2016
// Proxies UN Comtrade (free public preview, or full API when COMTRADE_API_KEY is set).
const PREVIEW = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const FULL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';

export default async (req) => {
  const u = new URL(req.url);
  const reporter = (u.searchParams.get('reporter') || '').replace(/\D/g, '');
  const partner = u.searchParams.get('partner') || '0';
  const hs = (u.searchParams.get('hs') || '').replace(/\D/g, '');
  const flow = (u.searchParams.get('flow') || 'M').replace(/[^MX]/g, '') || 'M';
  const years = (u.searchParams.get('years') || '').split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 25);
  if (!reporter || !hs || !years.length || ![2, 4, 6].includes(hs.length)) return Response.json({ error: 'Missing or invalid reporter, product code or years.' }, { status: 400 });

  const key = process.env.COMTRADE_API_KEY;
  const base = key ? FULL : PREVIEW;
  const chunks = []; for (let i = 0; i < years.length; i += 12) chunks.push(years.slice(i, i + 12));
  const rows = [];
  try {
    for (const ch of chunks) {
      const q = new URLSearchParams({ reporterCode: reporter, period: ch.join(','), cmdCode: hs, flowCode: flow, partner2Code: '0', customsCode: 'C00', motCode: '0', includeDesc: 'true' });
      if (partner !== 'all') q.set('partnerCode', partner.replace(/\D/g, '') || '0');
      const r = await fetch(`${base}?${q}`, { headers: key ? { 'Ocp-Apim-Subscription-Key': key } : {} });
      if (r.status === 429) return Response.json({ error: 'UN Comtrade is busy (rate limit). Please wait a minute and try again.' }, { status: 429 });
      if (!r.ok) return Response.json({ error: `UN Comtrade returned an error (${r.status}).` }, { status: 502 });
      const j = await r.json();
      for (const d of j.data || []) rows.push({ year: d.refYear || d.period, reporterCode: d.reporterCode, partnerCode: d.partnerCode, partnerDesc: d.partnerDesc || '', cmdCode: d.cmdCode, value: d.primaryValue ?? d.cifvalue ?? d.fobvalue ?? 0, netWgt: d.netWgt ?? null });
    }
    return Response.json({ rows, mode: key ? 'full' : 'preview', year: years[years.length - 1] }, { headers: { 'cache-control': 'public, max-age=86400' } });
  } catch (e) {
    return Response.json({ error: 'Could not reach UN Comtrade: ' + e.message }, { status: 502 });
  }
};
export const config = { path: '/api/trade-flows' };
