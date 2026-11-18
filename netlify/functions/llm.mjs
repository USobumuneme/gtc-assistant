// POST /api/llm — secure gateway to the language model.
//
// Design principles (anti-hallucination):
//  * The browser can never change the system prompts, tools or models — they are fixed here per task.
//  * Extraction / classification / verification use forced tool calls, so the model must return
//    structured JSON that the browser then checks against the source text and the HS nomenclature.
//  * The Q&A agent cannot "know" anything: it must call data tools (executed in the browser on the
//    user's own records) and cite the record IDs those tools returned. Counts come from tools, never
//    from the model.
//
// Environment variables:
//   ANTHROPIC_API_KEY   (required for AI features)
//   ANTHROPIC_MODEL     model for reasoning/answers   (default claude-sonnet-5-5)
//   ANTHROPIC_FAST_MODEL model for extraction/checks  (default: same as ANTHROPIC_MODEL)
//   APP_ACCESS_CODE     optional shared code users must enter to use AI features (protects your credits)
//   RATE_LIMIT_PER_10MIN optional, default 120 requests per IP per 10 minutes (best effort)

const THEME_IDS = ['transparency', 'labelling', 'origin', 'gi', 'conformity', 'intlstd', 'design', 'language', 'regional', 'discrimination', 'foodsafety', 'animalplant', 'licensing', 'environment', 'digital'];
const EVIDENCE = { type: 'string', description: 'An EXACT quote (max 30 words) copied character-for-character from the statement that proves this. Never paraphrase.' };

const SYS_EXTRACT = `You are a meticulous trade-policy analyst. You read statements made by WTO Members in WTO committees and record ONLY what the text states.
Hard rules:
- Every factual field must be backed by an exact, verbatim quote from the statement in its "evidence" field. Quotes are machine-checked; paraphrased or invented quotes are rejected.
- If something is not stated, leave it empty / use "Not stated". Never guess, never use outside knowledge.
- "maintaining_member" is the Member whose measure is being discussed (not the one raising the concern).
- "products" are concrete goods named in the text, copied exactly as written (e.g. "interlocking clay roof tiles"). Do not list generic words like "products", "goods", "imports".
- Write "summary_plain" in plain English (max 80 words) for a non-specialist; it must contain no fact absent from the statement.`;

const SYS_CLASSIFY = `You assign Harmonized System (HS) codes to products named in WTO trade-concern statements.
Hard rules:
- You may ONLY choose a code from the candidate list supplied for that product. Never invent or modify codes.
- If none of the candidates genuinely fits, return hs_code null.
- Prefer the most specific candidate that is clearly correct. If you cannot decide between 6-digit sub-headings, choose the 4-digit heading if it is in the list.
- certainty: "high" only when the product wording leaves no reasonable doubt; "medium" when one plausible alternative exists; "low" otherwise.`;

const SYS_VERIFY = `You are a strict fact-checker. Compare an AI-written answer with the evidence records it was based on.
List every factual claim in the answer that is NOT directly supported by the evidence (wrong numbers, dates, Members, products, or statements the records do not make). Ignore style, hedging, and general explanations of terms. Be strict but fair: a claim supported by any evidence record is supported.`;

const SYS_NARRATE = `You write short analytical commentary on statistics about WTO trade concerns for non-specialist readers.
Use ONLY the numbers in the supplied statistics JSON — never compute new totals, percentages or growth rates that are not given, and never use outside knowledge. Neutral tone, no predictions beyond the supplied forecast, no legal judgements. Mention limitations if the data period is short.`;

const SYS_AGENT = `You are GTC Assistant, an analyst helping WTO Secretariat staff, Member delegates and researchers explore trade concerns raised in WTO committees.
You have NO knowledge of the records except through your tools. Follow these rules strictly:
1. Always use tools to find information before answering. For any number (how many, most, trend), call count_concerns — never count yourself from a list.
2. Use search_concerns to find relevant records and get_concern to read a record's full text before describing it in detail.
3. Cite every record you rely on as [#ID] using IDs returned by tools in this conversation. Never cite an ID you have not seen in a tool result.
4. If the tools return nothing relevant, say clearly that the loaded records do not contain the answer and suggest how to rephrase. Do not fill gaps with general knowledge about the WTO or trade disputes.
5. You may explain general terms (e.g. what "TBT" means) but label such explanations as general background.
6. Plain English, short paragraphs or bullets. Neutral; no legal conclusions about WTO consistency.
7. Use hs_lookup when the user names a product, so you can filter by HS code. Use trade_flows only when asked about trade values; report its numbers exactly and note that changes in trade have many causes.`;

const filters = {
  member: { type: 'string', description: 'WTO Member name, e.g. "European Union", "Korea, Republic of"' },
  role: { type: 'string', enum: ['raising', 'maintaining', 'any'], description: 'Whether the member raised the concern or maintains the measure' },
  theme: { type: 'string', enum: THEME_IDS, description: 'Issue type id' },
  hs_prefix: { type: 'string', description: 'HS code prefix (2, 4 or 6 digits) to filter products' },
  committee: { type: 'string', description: 'e.g. TBT, SPS' },
  year_from: { type: 'integer' }, year_to: { type: 'integer' }
};
const AGENT_TOOLS = [
  { name: 'search_concerns', description: 'Search the loaded trade-concern records by keywords and/or filters. Returns matching records (id, title, date, members, issue types, HS codes, short summary) and the total number of matches.', input_schema: { type: 'object', properties: Object.assign({ query: { type: 'string', description: 'Keywords; may be empty when filtering only' }, limit: { type: 'integer', description: 'max results, default 8, max 15' } }, filters) } },
  { name: 'count_concerns', description: 'Exact counts of concerns matching filters, optionally grouped. Use for every numeric statement.', input_schema: { type: 'object', properties: Object.assign({ query: { type: 'string' }, group_by: { type: 'string', enum: ['none', 'year', 'raising_member', 'maintaining_member', 'theme', 'committee', 'hs_chapter'] } }, filters) } },
  { name: 'get_concern', description: 'Full record for one concern: all statements (original text), verified AI analysis and HS codes.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'hs_lookup', description: 'Find official HS codes for a product description, or describe a given HS code.', input_schema: { type: 'object', properties: { query: { type: 'string' }, code: { type: 'string' } } } },
  { name: 'trade_flows', description: 'Annual import values (US$) from UN Comtrade for an importing Member, product HS code and years, optionally from one partner.', input_schema: { type: 'object', properties: { importer: { type: 'string' }, exporter: { type: 'string', description: 'partner Member or "World"' }, hs: { type: 'string' }, year_from: { type: 'integer' }, year_to: { type: 'integer' } }, required: ['importer', 'hs', 'year_from', 'year_to'] } }
];

const TASKS = {
  extract: {
    fast: true, max_tokens: 2000, system: SYS_EXTRACT,
    tool: {
      name: 'record_analysis', description: 'Record the verified analysis of the statement.',
      input_schema: {
        type: 'object', required: ['summary_plain', 'core_issue', 'maintaining_member', 'products', 'issue_types', 'requests'],
        properties: {
          summary_plain: { type: 'string' },
          core_issue: { type: 'object', properties: { text: { type: 'string', description: 'One plain sentence: what the problem is' }, evidence: EVIDENCE }, required: ['text', 'evidence'] },
          raising_member: { type: 'object', properties: { name: { type: 'string' }, evidence: EVIDENCE } },
          maintaining_member: { type: 'object', properties: { name: { type: 'string', description: 'Member maintaining the measure, or "Not stated"' }, evidence: EVIDENCE }, required: ['name'] },
          measure: { type: 'object', properties: { description: { type: 'string' }, document_reference: { type: 'string', description: 'Document symbol / regulation number exactly as written, or empty' }, evidence: EVIDENCE } },
          products: { type: 'array', items: { type: 'object', properties: { phrase: { type: 'string', description: 'Product exactly as written in the text' }, evidence: EVIDENCE }, required: ['phrase', 'evidence'] } },
          applies_to_many_products: { type: 'boolean', description: 'True if the measure is horizontal (applies across many products) rather than product-specific' },
          issue_types: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', enum: THEME_IDS }, evidence: EVIDENCE }, required: ['id', 'evidence'] } },
          requests: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'What the raising Member asks for, in plain English' }, evidence: EVIDENCE }, required: ['text', 'evidence'] } },
          other_members_supporting: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, evidence: EVIDENCE } } },
          escalation_signals: { type: 'array', items: { type: 'object', properties: { signal: { type: 'string', enum: ['alleged_inconsistency', 'discrimination', 'long_running', 'no_response', 'trade_impact_claimed', 'broad_support'] }, evidence: EVIDENCE }, required: ['signal', 'evidence'] } }
        }
      }
    },
    user: i => `<statement raised_by="${esc(i.raising || 'unknown')}">\n${i.text}\n</statement>\nAnalyse this statement and call record_analysis.`
  },
  classify: {
    fast: true, max_tokens: 1500, system: SYS_CLASSIFY,
    tool: {
      name: 'assign_hs_codes', description: 'Assign HS codes chosen only from the candidates.',
      input_schema: { type: 'object', required: ['assignments'], properties: { assignments: { type: 'array', items: { type: 'object', required: ['product', 'hs_code', 'certainty', 'reason'], properties: { product: { type: 'string' }, hs_code: { type: ['string', 'null'] }, certainty: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: { type: 'string', description: 'max 25 words' } } } } } }
    },
    user: i => `Context sentence(s) from the statement:\n"""${String(i.context || '').slice(0, 1500)}"""\n\n` + (i.products || []).slice(0, 8).map(p => `PRODUCT: "${p.phrase}"\nCANDIDATES:\n${(p.candidates || []).slice(0, 15).map(c => `- ${c.code}: ${c.desc}`).join('\n')}`).join('\n\n') + '\n\nCall assign_hs_codes with one assignment per product.'
  },
  verify: {
    fast: true, max_tokens: 1200, system: SYS_VERIFY,
    tool: { name: 'report_verification', description: 'Report unsupported claims.', input_schema: { type: 'object', required: ['verdict', 'unsupported_claims'], properties: { verdict: { type: 'string', enum: ['supported', 'partially_supported', 'unsupported'] }, unsupported_claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, problem: { type: 'string' } } } } } } },
    user: i => `<evidence>\n${String(i.evidence || '').slice(0, 40000)}\n</evidence>\n<answer>\n${String(i.answer || '').slice(0, 6000)}\n</answer>\nCheck the answer against the evidence and call report_verification.`
  },
  narrate: {
    fast: false, max_tokens: 900, system: SYS_NARRATE,
    tool: { name: 'write_commentary', description: 'Commentary on the statistics.', input_schema: { type: 'object', required: ['headline', 'points'], properties: { headline: { type: 'string', description: 'One sentence' }, points: { type: 'array', items: { type: 'string' }, description: '3-5 short bullet points' }, caveat: { type: 'string' } } } },
    user: i => `<statistics>\n${JSON.stringify(i.stats || {}).slice(0, 12000)}\n</statistics>\nWrite the commentary and call write_commentary.`
  }
};

function esc(s) { return String(s).replace(/[<>"]/g, ''); }
const hits = new Map();
function limited(ip) {
  const max = +(process.env.RATE_LIMIT_PER_10MIN || 120); const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 600000); arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
function validAgentMessages(ms) {
  if (!Array.isArray(ms) || !ms.length || ms.length > 40) return false;
  if (JSON.stringify(ms).length > 250000) return false;
  return ms.every(m => (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.every(b => ['text', 'tool_use', 'tool_result'].includes(b.type)))));
}

async function callClaude(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || `Model error ${r.status}`); e.status = r.status; throw e; }
  return j;
}

export default async (req, context) => {
  if (req.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'AI is not configured on this site (missing ANTHROPIC_API_KEY).' }, { status: 503 });
  const code = process.env.APP_ACCESS_CODE;
  if (code && req.headers.get('x-access-code') !== code) return Response.json({ error: 'Access code required or incorrect.', needCode: true }, { status: 401 });
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'anon';
  if (limited(ip)) return Response.json({ error: 'Too many requests — please wait a few minutes.' }, { status: 429 });

  let body; try { body = await req.json(); } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  const MAIN = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const FAST = process.env.ANTHROPIC_FAST_MODEL || MAIN;

  try {
    if (body.task === 'agent') {
      if (!validAgentMessages(body.messages)) return Response.json({ error: 'Invalid conversation' }, { status: 400 });
      const j = await callClaude({ model: MAIN, max_tokens: 1800, system: SYS_AGENT, tools: AGENT_TOOLS, messages: body.messages });
      return Response.json({ content: j.content, stop_reason: j.stop_reason, model: j.model || MAIN });
    }
    const t = TASKS[body.task];
    if (!t) return Response.json({ error: 'Unknown task' }, { status: 400 });
    const input = body.input || {};
    if (JSON.stringify(input).length > 60000) return Response.json({ error: 'Input too large' }, { status: 413 });
    const model = t.fast ? FAST : MAIN;
    const j = await callClaude({ model, max_tokens: t.max_tokens, temperature: 0, system: t.system, tools: [t.tool], tool_choice: { type: 'tool', name: t.tool.name }, messages: [{ role: 'user', content: t.user(input) }] });
    const use = (j.content || []).find(b => b.type === 'tool_use');
    if (!use) return Response.json({ error: 'The model did not return a structured result.' }, { status: 502 });
    return Response.json({ result: use.input, model: j.model || model });
  } catch (e) {
    return Response.json({ error: e.message || 'AI request failed' }, { status: e.status === 429 ? 429 : 502 });
  }
};
export const config = { path: '/api/llm' };
