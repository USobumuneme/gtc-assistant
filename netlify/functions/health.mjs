// GET /api/health — tells the app which optional services are switched on
export default async () => {
  const llm = !!process.env.ANTHROPIC_API_KEY;
  const main = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  return Response.json({
    ok: true,
    llm,
    model: llm ? main : '',
    fastModel: llm ? (process.env.ANTHROPIC_FAST_MODEL || main) : '',
    requiresCode: llm && !!process.env.APP_ACCESS_CODE,
    comtrade: process.env.COMTRADE_API_KEY ? 'full API' : 'public preview'
  }, { headers: { 'cache-control': 'no-store' } });
};
export const config = { path: '/api/health' };
