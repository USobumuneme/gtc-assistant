# GTC Assistant — Trade Concerns Monitoring & Analysis (Prototype)

An AI assistant that helps WTO Secretariat staff, Member delegations and researchers understand trade concerns raised in WTO committees — written for non-technical users.

## How it avoids false results

The language model does the reading and reasoning. The app checks everything it says before showing it.

| Safeguard | What it stops | How |
|---|---|---|
| **Evidence gate** | Invented facts about a concern | Every fact the model extracts (Member maintaining the measure, the measure, the core issue, requests, issue types, escalation signals, products) must include a word-for-word quote. The app matches each quote to the official statement. Facts without a matching quote are rejected, logged and never shown as fact. |
| **Summary check** | Invented details in the plain-language summary | Numbers and Member names in the AI summary must appear in the statement. If they don't, the app shows an extract of the original text instead and says why. |
| **Closed-set HS coding** | Invented or wrong product codes | For each product, candidate codes are retrieved from the official HS 2022 nomenclature (6,939 entries). The model may only choose from that list or say "none fits". Any other code is rejected. Low certainty is marked "needs human review" and is not ticked by default. Agreement with an independent baseline engine raises confidence. |
| **Tools, not memory** | Made-up counts and records in answers | The Q&A analyst has no knowledge of the data except through tools that run in the browser on the loaded records: `search_concerns`, `count_concerns`, `get_concern`, `hs_lookup`, `trade_flows`. Every number must come from a tool. |
| **Answer checks** | Wrong citations, numbers or claims | (1) Every cited record must have been returned by a tool in that turn. (2) Every number must appear in the tool results. (3) An independent fact-checking pass lists claims the evidence does not support. Problems are shown above the answer. |
| **Statistics commentary check** | Invented trend figures | AI commentary on Trends may only use the computed statistics, and every number it writes is checked against them. |
| **Human review + metrics** | Silent drift | Reviewers confirm or correct codes. Precision, recall, F1 and top-1 accuracy are measured against reviews and against known codes, with the language model compared side by side with the baseline. |

The checks were tested with a fake model that deliberately invents a quote, a product, an HS code, a citation, a count and a statistic. All six were caught.

## What users can do

- **Browse concerns** by Member, committee, product sector or issue type.
- **Read a fact-checked brief** of any concern: the problem, the measure, what is asked for, with the evidence quotes.
- **Review product codes** and save decisions, which flow into every view and export.
- **Explain a statement:** paste any text and get the same verified analysis.
- **Find a product code:** describe a product, and the AI picks the best official code from the candidates.
- **Ask a question:** an AI analyst with exact counting and cited, fact-checked answers.
- **Trade flows** from UN Comtrade, with a before/after comparison around the date the concern was raised.
- **Trends & early warning:** forecast, rising topics, a who-raises-about-whom matrix, and fact-checked AI commentary.
- **Data & review:** CSV/Excel import, batch AI analysis, data-quality flags (duplicates), accuracy dashboard, and exports.

If the language model is not configured, every page still works with the **basic engine** (product dictionary + HS search + extractive summaries). The basic engine is clearly labelled.

The included sample is `data/sample-concerns.csv` (15 TBT statements, 1995–96). Load a full export from the WTO Trade Concerns Database for real trends.

---

## Deploy on Netlify

### Option A — Full deployment (recommended: language model + live trade data)

1. Put this folder in a GitHub repository (upload the files on github.com, or `git init && git add . && git commit -m "GTC Assistant" && git push`).
2. In Netlify: **Add new site → Import an existing project → GitHub**, choose the repository.
3. Build settings are read from `netlify.toml`. No build command is needed. Leave **Publish directory** as `.`.
4. Press **Deploy**.
5. In **Site configuration → Environment variables**, add:

   | Variable | Required? | Purpose |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Yes, for AI | Switches on the language model ([console.anthropic.com](https://console.anthropic.com)) |
   | `APP_ACCESS_CODE` | **Strongly recommended** | Users must enter this code once before AI features work, so strangers can't spend your credits |
   | `ANTHROPIC_MODEL` | Optional | Model for answers and commentary (default `claude-sonnet-5-5`) |
   | `ANTHROPIC_FAST_MODEL` | Optional | Model for extraction, coding and fact-checks (default: same as above). A faster model such as `claude-haiku-5-5` lowers cost and latency |
   | `RATE_LIMIT_PER_10MIN` | Optional | AI requests per visitor per 10 minutes (default 120) |
   | `COMTRADE_API_KEY` | Optional | UN Comtrade subscription key. Without it, the free public preview is used |

   Redeploy after you add the variables.

   Timeouts: each AI step is a separate short request. If you see time-out errors on very long statements, set `ANTHROPIC_FAST_MODEL` to a faster model, or raise the function timeout on a paid Netlify plan.

Or use the Netlify CLI: `npm i -g netlify-cli && netlify deploy --prod` from this folder.

### Option B — Drag and drop (fastest, static only)

Drag the folder onto <https://app.netlify.com/drop>. The basic engine works (briefs, HS search, review, trends, question answering). **Netlify Drop does not deploy server functions**, so the language model and live trade data stay off. Use Option A for the full AI system.

### Run locally

```
npx netlify-cli dev        # serves the site and the functions on http://localhost:8888
```
Or serve the files as a static site with `python3 -m http.server`. The app works, but without the functions. Opening `index.html` directly from disk does not work, because browsers block loading the data files that way.

---

## Project structure

```
index.html                 App shell and navigation
css/styles.css             Design system (light/dark, responsive, print)
js/nlp.js                  Language engine: tokeniser, BM25, Member detection, issue types, summariser, HS classifier
js/ai.js                   AI pipeline: evidence gate, closed-set HS coding, tool-using analyst, answer checks, cache, batch
js/store.js                CSV import, column detection, concern grouping, enrichment, review storage, exports
js/core.js                 Helpers, router, charts, client for server functions
js/views-*.js              Pages
js/vendor/                 PapaParse, Chart.js, SheetJS (bundled locally, so no CDN is needed)
data/hs.json               HS 2022 nomenclature (sections, chapters, headings, sub-headings)
data/sample-concerns.csv   Sample trade-concern records
netlify/functions/
  health.mjs               /api/health: which optional services are on
  llm.mjs                  /api/llm: secure gateway — fixed prompts and tools per task (extract, classify,
                           verify, narrate, agent), forced structured output, access code, rate limit
  trade-flows.mjs          /api/trade-flows: UN Comtrade proxy (preview or full API)
netlify.toml               Netlify configuration and security headers
```

## Importing your own data

The importer accepts any CSV or Excel file with a text column. Columns are recognised by name:

| Meaning | Accepted column names (examples) |
|---|---|
| Concern ID | `ImsId`, `ID`, `Concern ID`, `STC number` |
| Committee | `Area`, `Committee` |
| Date | `MeetingDate`, `Date` (dd/mm/yyyy or yyyy-mm-dd) |
| Raising Member | `RaisingMember`, `Member`, `Raised by` |
| Maintaining Member | `Maintaining Member`, `Responding Member` (otherwise detected by AI) |
| Title | `Title`, `Subject` |
| Text | `Summary`, `Description`, `StatementSubmitted` |
| Known HS codes | `HS`, `HS codes` (used to measure AI accuracy) |

Rows that share a concern ID are grouped into one concern, with each statement shown in its discussion history. Title, statement and summary are merged without repeating text.

## Responsible AI

- Every AI output is labelled as AI-generated, shows its evidence quotes, and lists the claims that were rejected.
- Product codes go through human review, and accuracy is measured (precision, recall, F1).
- Loaded data stays in the browser. When AI is used, only the statement being analysed, or the records the analyst's tools return, are sent to the model through the site's own gateway. The browser can't change the gateway's prompts or tools.
- The tool supports analysis. It does not make legal findings about WTO consistency.
- Before/after trade comparisons are shown as signals, not as proof of impact.

## Known limits and next steps

- Add the HS–ICS concordance for sector analysis. Use reviewer-confirmed codes as a gold set to track accuracy over time.
- Comtrade reporter codes are mapped for about 60 Members. Others can be added in `js/nlp.js` (`MEMBERS`). The EU is reporter code 97 (extra-EU trade).
- Forecasts are simple linear projections. They are only meaningful with several years of data.
- For production: WTO single sign-on, a shared database for review decisions, and a vector store (FAISS or pgvector) for the full corpus.

---

*Independent research prototype. Not an official product of, or endorsed by, the World Trade Organization. HS nomenclature: World Customs Organization HS 2022, via the open `datasets/harmonized-system` collection. Trade statistics: UN Comtrade.*
