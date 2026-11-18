/* =====================================================================
   GTC Assistant — Language engine
   Runs entirely in the browser. No data leaves the user's machine
   unless the optional AI service (Netlify function) is switched on.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- Text basics ---------------- */
  const STOP = new Set(('a an the and or of to in on for by with at from as is are was were be been being this that these those it its his her their our your he she they we i you which who whom whose what when where why how not no nor but if then than so such into onto over under about above below between within without also any all some each other others more most less least can could would should may might must shall will do does did done has have had having there here very same both either neither per via upon'.split(' ')));

  // Words that appear in almost every trade-concern statement and carry no product meaning
  const PROCEDURAL = new Set(('representative delegation delegations committee member members concern concerns concerned expressed express raised raise issue issues regulation regulations measure measures authorities authority government governments said says noted note notes recalled recall urged urge requested request asked ask regretted regret welcomed welcome information information reply replies response meeting meetings agreement agreements article articles wto tbt sps gatt notification notifications notified notify standard standards requirement requirements technical barrier barriers trade trading draft proposed proposal final rule rules law laws provide provided providing point points enquiry enquiries matter matters view views time country countries national international product products import imports imported importing export exports exporting exporter exporters market markets relevant related relating regarding concerning apply applied application applies new current currently further also however although since still well e g ie etc mr mrs ms year years month months day days june july january february march april may august september october november december first second third secretariat process procedure procedures mandatory voluntary review used use using based basis way level levels case cases number numbers part parts given give take taken make made possible party parties obligation obligations comment comments discussion discussions bilateral bilaterally solution solutions shared share interest interests system systems official origin name names content equipment percentage value strength characteristic characteristics accident company companies competition industry industries design performance safety approval test tests label labels labelling labeling marking list registration development state states member producer producers manufacturer manufacturers consumer consumers supplier suppliers sector sectors effect effects impact impacts quality method methods type types item items good goods kind area region regional'.split(' ')));
  const PLACE_TOKENS = new Set();

  const SYN = {
    woollen: 'wool', woolen: 'wool', aluminum: 'aluminium', automobile: 'car', automobiles: 'car', automotive: 'vehicle',
    cars: 'car', tyres: 'tyre', tires: 'tyre', tire: 'tyre', colour: 'color', fibres: 'fibre', fiber: 'fibre',
    timepiece: 'watch', timepieces: 'watch', wristwatch: 'watch', medicines: 'medicament', medicine: 'medicament',
    drugs: 'medicament', drug: 'medicament', pharmaceutical: 'medicament', pharmaceuticals: 'medicament',
    beef: 'bovine', cattle: 'bovine', pork: 'swine', pig: 'swine', pigs: 'swine', chicken: 'fowl', chickens: 'fowl', poultry: 'fowl',
    mobile: 'telephone', smartphone: 'telephone', smartphones: 'telephone', phones: 'telephone', phone: 'telephone',
    garments: 'apparel', garment: 'apparel', clothing: 'apparel', clothes: 'apparel', shoes: 'footwear',
    porcelain: 'porcelain', crockery: 'tableware', fridge: 'refrigerator', fridges: 'refrigerator',
    laptops: 'computer', laptop: 'computer', computers: 'computer', whisky: 'whiskies', whiskey: 'whiskies',
    spirits: 'spirit', liquor: 'spirit', cigarettes: 'cigarette', cosmetic: 'cosmetic', cosmetics: 'cosmetic',
    toys: 'toy', solar: 'photovoltaic', pv: 'photovoltaic'
  };

  function stem(w) {
    if (SYN[w]) return SYN[w];
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && (w.endsWith('ches') || w.endsWith('shes') || w.endsWith('sses') || w.endsWith('xes'))) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|ys)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(text, { keepProcedural = true } = {}) {
    const out = [];
    const raw = String(text || '').toLowerCase().replace(/[’']/g, '').match(/[a-z][a-z\-]{1,}/g) || [];
    for (let w of raw) {
      for (const part of w.split('-')) {
        if (part.length < 2 || STOP.has(part)) continue;
        if (!keepProcedural && PROCEDURAL.has(part)) continue;
        out.push(stem(part));
      }
    }
    return out;
  }

  /* ---------------- BM25 search index ---------------- */
  class BM25 {
    constructor(k1 = 1.4, b = 0.7) { this.k1 = k1; this.b = b; this.docs = []; this.df = new Map(); this.avg = 0; }
    add(id, toks, meta) {
      const tf = new Map(); toks.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
      this.docs.push({ id, tf, len: toks.length, meta });
      tf.forEach((_, t) => this.df.set(t, (this.df.get(t) || 0) + 1));
    }
    finish() { this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length); this.N = this.docs.length; return this; }
    idf(t) { const n = this.df.get(t) || 0; return Math.log(1 + (this.N - n + 0.5) / (n + 0.5)); }
    search(qToks, { limit = 10, filter } = {}) {
      const q = [...new Set(qToks)];
      const res = [];
      for (const d of this.docs) {
        if (filter && !filter(d)) continue;
        let s = 0, hits = [];
        for (const t of q) {
          const f = d.tf.get(t); if (!f) continue;
          const idf = this.idf(t);
          s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avg));
          hits.push(t);
        }
        if (s > 0) res.push({ id: d.id, score: s, hits, coverage: hits.length / q.length, meta: d.meta });
      }
      res.sort((a, b) => b.score - a.score);
      return res.slice(0, limit);
    }
  }

  /* ---------------- WTO Members (names, adjectives, UN M49 codes for trade data) ---------------- */
  const MEMBERS = [
    ['European Union', ['european union', 'european communities', 'european community', 'the ec', ' ec ', 'ec regulation', 'eu', 'cen', 'european commission', 'commission'], 97],
    ['United States', ['united states of america', 'united states', 'u.s.', ' us ', 'usa', 'federal register', 'american'], 842],
    ['Canada', ['canada', 'canadian'], 124], ['Japan', ['japan', 'japanese'], 392], ['China', ['china', 'chinese'], 156],
    ['Korea, Republic of', ['korea', 'korean'], 410], ['India', ['india', 'indian'], 699], ['Brazil', ['brazil', 'brazilian'], 76],
    ['Mexico', ['mexico', 'mexican'], 484], ['Israel', ['israel', 'israeli'], 376], ['Switzerland', ['switzerland', 'swiss'], 757],
    ['Australia', ['australia', 'australian'], 36], ['New Zealand', ['new zealand'], 554], ['Norway', ['norway', 'norwegian'], 579],
    ['United Kingdom', ['united kingdom', 'british', ' uk '], 826], ['Russian Federation', ['russian federation', 'russia', 'russian'], 643],
    ['Indonesia', ['indonesia', 'indonesian'], 360], ['Malaysia', ['malaysia', 'malaysian'], 458], ['Thailand', ['thailand', 'thai'], 764],
    ['Philippines', ['philippines', 'philippine'], 608], ['Viet Nam', ['viet nam', 'vietnam', 'vietnamese'], 704], ['Singapore', ['singapore'], 702],
    ['Chinese Taipei', ['chinese taipei', 'taipei'], 490], ['Hong Kong, China', ['hong kong'], 344], ['Argentina', ['argentina', 'argentine'], 32],
    ['Chile', ['chile', 'chilean'], 152], ['Colombia', ['colombia', 'colombian'], 170], ['Peru', ['peru', 'peruvian'], 604],
    ['Ecuador', ['ecuador'], 218], ['Costa Rica', ['costa rica'], 188], ['Uruguay', ['uruguay'], 858], ['Paraguay', ['paraguay'], 600],
    ['South Africa', ['south africa', 'south african'], 710], ['Nigeria', ['nigeria', 'nigerian'], 566], ['Kenya', ['kenya', 'kenyan'], 404],
    ['Egypt', ['egypt', 'egyptian'], 818], ['Morocco', ['morocco', 'moroccan'], 504], ['Ghana', ['ghana', 'ghanaian'], 288],
    ['Saudi Arabia, Kingdom of', ['saudi arabia', 'saudi'], 682], ['United Arab Emirates', ['united arab emirates', 'uae'], 784],
    ['Türkiye', ['turkiye', 'türkiye', 'turkey', 'turkish'], 792], ['Ukraine', ['ukraine', 'ukrainian'], 804], ['Pakistan', ['pakistan', 'pakistani'], 586],
    ['Bangladesh', ['bangladesh'], 50], ['Sri Lanka', ['sri lanka'], 144], ['Qatar', ['qatar'], 634], ['Bahrain, Kingdom of', ['bahrain'], 48],
    ['Oman', ['oman'], 512], ['Kuwait, the State of', ['kuwait'], 414], ['Jordan', ['jordan'], 400], ['Iceland', ['iceland'], 352],
    ['Germany', ['germany', 'german'], 276], ['France', ['france', 'french'], 251], ['Italy', ['italy', 'italian'], 380], ['Spain', ['spain', 'spanish'], 724],
    ['Netherlands', ['netherlands', 'dutch'], 528], ['Belgium', ['belgium', 'belgian'], 56], ['Poland', ['poland', 'polish'], 616]
  ].map(([name, aliases, m49]) => ({ name, aliases, m49 }));

  const MEMBER_CANON = {
    'european union': 'European Union', 'european communities': 'European Union', 'european community': 'European Union', 'eu': 'European Union', 'ec': 'European Union',
    'united states of america': 'United States', 'united states': 'United States', 'usa': 'United States', 'us': 'United States',
    'korea': 'Korea, Republic of', 'republic of korea': 'Korea, Republic of', 'korea, republic of': 'Korea, Republic of', 'russia': 'Russian Federation',
    'vietnam': 'Viet Nam', 'turkey': 'Türkiye', 'uk': 'United Kingdom', 'saudi arabia': 'Saudi Arabia, Kingdom of'
  };
  function canonMember(name) {
    const n = String(name || '').trim(); if (!n) return '';
    const k = n.toLowerCase();
    if (MEMBER_CANON[k]) return MEMBER_CANON[k];
    const m = MEMBERS.find(m => m.name.toLowerCase() === k); return m ? m.name : n;
  }
  function findMembers(text) {
    const t = ' ' + String(text || '').replace(/[^\w\s.']/g, ' ').replace(/\s+/g, ' ') + ' ';
    const lower = t.toLowerCase();
    const counts = new Map();
    for (const m of MEMBERS) {
      let c = 0;
      for (const a of m.aliases) {
        const needle = a.startsWith(' ') ? a : a;
        if (a === 'eu' || a === 'commission') continue; // handled below
        const re = new RegExp('(^|[^a-z])' + needle.trim().replace(/[.]/g, '\\.') + '(?=[^a-z]|$)', 'g');
        const src = (a.trim() === 'us' || a.trim() === 'ec' || a.trim() === 'uk') ? t : lower; // case-sensitive for short acronyms
        const re2 = (a.trim() === 'us' || a.trim() === 'ec' || a.trim() === 'uk') ? new RegExp('(^|[^A-Za-z])' + a.trim().toUpperCase() + '(?=[^A-Za-z]|$)', 'g') : re;
        const hits = src.match(re2); if (hits) c += hits.length;
      }
      if (m.name === 'European Union') { const h = t.match(/(^|[^A-Za-z])EU(?=[^A-Za-z])/g); if (h) c += h.length; }
      if (c) counts.set(m.name, c);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }
  function memberCode(name) { const m = MEMBERS.find(x => x.name === canonMember(name)); return m ? m.m49 : null; }

  /* ---------------- Themes (what kind of issue is it?) ---------------- */
  const THEMES = [
    { id: 'transparency', label: 'Transparency & notification', plain: 'The measure was not notified, or questions went unanswered.', re: /(not been notified|no(t)? notif|failed to notify|should be notified|enquiry point|no reply|no response|unanswered|no information had been received|transparen|advance knowledge|article 2\.9|article 5\.6|comment period)/gi },
    { id: 'labelling', label: 'Labelling & marking', plain: 'Rules on labels, marks or packaging information.', re: /(label|marking|marks? of origin|mark\b|packag|care labelling|content labelling)/gi },
    { id: 'origin', label: 'Origin rules & origin marking', plain: 'How the country of origin must be shown or proven.', re: /(marks? of origin|origin marking|country of origin|origin regulation|domestic and foreign content|geographical origin)/gi },
    { id: 'gi', label: 'Geographical indications & names', plain: 'Protected product names (e.g. regional food names).', re: /(geographical indication|designations? of origin|product names|appellation)/gi },
    { id: 'conformity', label: 'Testing & certification', plain: 'Product testing, approval, certification or inspection procedures.', re: /(conformity assessment|certif|approv|test(ing|s)?\b|inspection|ce mark|counter mark|accredit|article 5\.1)/gi },
    { id: 'intlstd', label: 'Use of international standards', plain: 'Whether international standards (ISO, Codex, etc.) were followed.', re: /(international standard|\biso\b|codex|iec\b|unece|article 2\.4|relevant international)/gi },
    { id: 'design', label: 'Design-based vs performance rules', plain: 'Rules that dictate design rather than how a product performs.', re: /(design[- ]based|design rather than|performance rather than|in terms of performance|design requirements|performance and durability)/gi },
    { id: 'language', label: 'Language requirements', plain: 'Information must be given in a specific language.', re: /(in (the )?(korean|spanish|english|french|chinese|arabic|local) language|language label|mandatory marking in)/gi },
    { id: 'regional', label: 'Regional / private standard-setting', plain: 'Standards developed regionally (e.g. CEN) with limited outside input.', re: /(\bcen\b|regional standard|european standard|prEN|standstill|standardizing bod)/gi },
    { id: 'discrimination', label: 'Discrimination & market access', plain: 'Imports appear treated less favourably, or blocked.', re: /(discriminat|keep out|less favourable|national treatment|prevent the export|adverse trade effect|affected negatively|unnecessary obstacle|more trade.restrictive|could not meet|would not be able to meet|inconsistent with)/gi },
    { id: 'foodsafety', label: 'Food safety & residues', plain: 'Limits on contaminants, residues, additives or hygiene.', re: /(maximum residue|mrl|pesticide|contaminant|food safety|additive|hygien|microbiolog|aflatoxin)/gi },
    { id: 'animalplant', label: 'Animal & plant health', plain: 'Disease, pest or quarantine restrictions.', re: /(animal health|plant health|quarantine|disease|pest\b|bse|avian|foot.and.mouth|phytosanitary|carcass)/gi },
    { id: 'licensing', label: 'Import licensing & restrictions', plain: 'Licences, quotas or bans on imports.', re: /(import licen|licensing|quota|import ban|prohibit|article xi)/gi },
    { id: 'environment', label: 'Environment & sustainability', plain: 'Environmental, climate or chemical-safety objectives.', re: /(environment|deforestation|carbon|climate|recycl|chemical substance|reach\b|hazardous|circular)/gi },
    { id: 'digital', label: 'Digital & cybersecurity', plain: 'ICT security, encryption or data rules for products.', re: /(cybersecurity|encryption|ict product|software|source code|data localisation)/gi }
  ];
  function classifyThemes(text) {
    const res = [];
    for (const th of THEMES) {
      const m = String(text || '').match(th.re);
      if (m && m.length) res.push({ id: th.id, label: th.label, plain: th.plain, hits: m.length, evidence: [...new Set(m.map(x => x.toLowerCase()))].slice(0, 4) });
    }
    res.sort((a, b) => b.hits - a.hits);
    return res;
  }

  /* ---------------- Measure / document references ---------------- */
  const REF_PATTERNS = [
    /G\/(?:TBT|SPS)\/(?:N|Notif)[\/.][A-Z0-9.\/\-]+/g,
    /(?:TBT|SPS)\/Notif[\/.]\d+\.\d+/g,
    /NOM-\d{3}-[A-Z]{2,5}-\d{4}/g,
    /Regulation \((?:EC|EU|EEC)\) No\.? ?\d+\/\d+/g,
    /Council Regulation \(EEC\) No\.? ?\d+\/\d+/g,
    /\bISO ?\d+(?:[.:\-]\d+)*/g,
    /\b(?:CEN Standard )?prEN ?\d+/gi,
    /\bstandard \d{2,5}\b/gi,
    /\bArticle \d+(?:\.\d+)?(?: of the [A-Z][A-Za-z ]+)?/g
  ];
  function findReferences(text) {
    const s = new Set();
    for (const re of REF_PATTERNS) (String(text || '').match(re) || []).forEach(x => s.add(x.replace(/[.,;]$/, '').trim()));
    const arr = [...s];
    return arr.filter(x => !arr.some(y => y !== x && y.includes(x)));
  }

  /* ---------------- Product cue lexicon → HS headings ---------------- */
  // Phrase (as found in narratives) → HS heading(s). Curated from frequently cited products in TBT/SPS concerns.
  const LEX = [
    ['interlocking clay roof tiles', ['6905']], ['clay roof tiles', ['6905']], ['roof tiles', ['6905']], ['roofing tiles', ['6905']], ['ceramic tiles', ['6907']],
    ['porcelain tableware', ['6911']], ['tableware', ['6911', '6912']], ['asphalt shingles', ['6807']], ['shingles', ['6807']], ['cement', ['2523']],
    ['seal gate valves', ['8481']], ['gate valves', ['8481']], ['gas connection valves', ['8481']], ['valves', ['8481']], ['taps', ['8481']],
    ['welding products', ['8515', '8311']], ['welding', ['8515', '8311']], ['home appliances', ['8516', '8450', '8418']], ['household appliances', ['8516', '8450', '8418']],
    ['refrigerators', ['8418']], ['washing machines', ['8450']], ['air conditioners', ['8415']], ['vacuum cleaners', ['8508']],
    ['motor vehicles', ['8703', '8704']], ['motor vehicle', ['8703', '8704']], ['passenger cars', ['8703']], ['electric vehicles', ['8703']], ['automobiles', ['8703']],
    ['trucks', ['8704']], ['vehicle parts', ['8708']], ['side door', ['8708']], ['motorcycles', ['8711']], ['tyres', ['4011']], ['tires', ['4011']],
    ['engine', ['8407', '8408']], ['transmission', ['8708']],
    ['watches', ['9101', '9102']], ['clocks', ['9105']], ['woollen fabrics', ['5111', '5112']], ['wool fabrics', ['5111', '5112']], ['wool', ['5101', '5111']],
    ['cotton fabrics', ['5208']], ['cotton', ['5201', '5208']], ['textiles', ['6302', '5208', '6109']], ['textile', ['6302', '5208', '6109']], ['apparel', ['6109', '6204', '6203']],
    ['clothing', ['6109', '6204', '6203']], ['garments', ['6109', '6204', '6203']], ['footwear', ['6403', '6404']], ['shoes', ['6403', '6404']], ['leather', ['4107']],
    ['carpets', ['5703']], ['toys', ['9503']], ['furniture', ['9403', '9401']], ['mattresses', ['9404']], ['lighting', ['9405', '8539']], ['lamps', ['8539', '9405']],
    ['batteries', ['8507', '8506']], ['mobile phones', ['8517']], ['smartphones', ['8517']], ['telecommunications equipment', ['8517']], ['telecommunication', ['8517']],
    ['computers', ['8471']], ['laptops', ['8471']], ['semiconductors', ['8541', '8542']], ['integrated circuits', ['8542']], ['solar panels', ['8541']], ['photovoltaic', ['8541']],
    ['drones', ['8806']], ['medical devices', ['9018', '9021']], ['pharmaceutical products', ['3004']], ['pharmaceuticals', ['3004']], ['medicines', ['3004']], ['vaccines', ['3002']],
    ['cosmetics', ['3304']], ['perfumes', ['3303']], ['detergents', ['3402']], ['pesticides', ['3808']], ['fertilizers', ['3105', '3102']], ['fertilisers', ['3105', '3102']],
    ['chemicals', ['2901', '3824']], ['plastics', ['3901', '3926']], ['plastic bags', ['3923']], ['packaging', ['3923', '4819']], ['paper', ['4802']],
    ['steel', ['7208', '7308']], ['iron and steel', ['7208']], ['aluminium', ['7601', '7604']], ['aluminum', ['7601', '7604']], ['copper', ['7403']], ['timber', ['4407']], ['wood', ['4407', '4403']],
    ['cheese', ['0406']], ['dairy products', ['0401', '0406', '0402']], ['milk', ['0401', '0402']], ['butter', ['0405']], ['infant formula', ['1901']],
    ['meat', ['0201', '0202', '0203', '0207']], ['beef', ['0201', '0202']], ['carcasses', ['0201', '0202', '0203']], ['carcass', ['0201', '0202', '0203']], ['pork', ['0203']],
    ['poultry', ['0207']], ['chicken', ['0207']], ['eggs', ['0407']], ['fish', ['0302', '0303', '0304']], ['seafood', ['0306', '0307']], ['shrimp', ['0306']], ['honey', ['0409']],
    ['live animals', ['0102', '0103']], ['cattle', ['0102']], ['fruit', ['0805', '0806', '0808']], ['fresh fruit', ['0805', '0806', '0808']], ['bananas', ['0803']], ['apples', ['0808']],
    ['citrus', ['0805']], ['grapes', ['0806']], ['vegetables', ['0702', '0709']], ['potatoes', ['0701']], ['tomatoes', ['0702']], ['nuts', ['0802']], ['cut flowers', ['0603']],
    ['seeds', ['1209']], ['rice', ['1006']], ['wheat', ['1001']], ['maize', ['1005']], ['corn', ['1005']], ['soybeans', ['1201']], ['coffee', ['0901']], ['tea', ['0902']],
    ['cocoa', ['1801']], ['chocolate', ['1806']], ['sugar', ['1701']], ['olive oil', ['1509']], ['palm oil', ['1511']], ['vegetable oils', ['1507', '1511', '1512']],
    ['wine', ['2204']], ['wines', ['2204']], ['beer', ['2203']], ['spirits', ['2208']], ['whisky', ['2208']], ['alcoholic beverages', ['2203', '2204', '2208']],
    ['soft drinks', ['2202']], ['energy drinks', ['2202']], ['mineral water', ['2201']], ['bottled water', ['2201']], ['food supplements', ['2106']], ['processed food', ['2106', '1905']],
    ['tobacco', ['2401', '2402']], ['cigarettes', ['2402']], ['e-cigarettes', ['8543', '2404']], ['biofuels', ['3826', '2207']], ['ethanol', ['2207']]
  ].sort((a, b) => b[0].length - a[0].length);

  /* ---------------- HS index ---------------- */
  let HS = null; // {byCode, sections, bm25, list}
  function buildHS(raw) {
    const byCode = new Map();
    raw.codes.forEach(([code, desc, level, section]) => byCode.set(code, { code, desc, level, section }));
    const bm = new BM25(1.2, 0.5);
    for (const [code, e] of byCode) {
      if (e.level === 2) continue;
      const parent = e.level === 6 ? byCode.get(code.slice(0, 4)) : null;
      const chap = byCode.get(code.slice(0, 2));
      const toks = tokens(e.desc).concat(parent ? tokens(parent.desc) : []).concat(chap ? tokens(chap.desc).slice(0, 4) : []);
      bm.add(code, toks, e);
    }
    HS = { byCode, sections: raw.sections, bm25: bm.finish() };
    return HS;
  }
  function hsInfo(code) {
    if (!HS) return null;
    const e = HS.byCode.get(code); if (!e) return null;
    const heading = HS.byCode.get(code.slice(0, 4)); const chapter = HS.byCode.get(code.slice(0, 2));
    return { code, desc: e.desc, level: e.level, heading: heading && heading.desc, chapter: chapter && chapter.desc, chapterCode: code.slice(0, 2), section: e.section, sectionName: HS.sections[e.section] };
  }
  function hsPretty(code) { return code.length === 6 ? code.slice(0, 4) + '.' + code.slice(4) : code; }

  // Pull out short product phrases from a narrative ("... standard for asphalt shingles", "regulations for watches")
  function productPhrases(text) {
    const t = String(text || '');
    const out = [];
    const re = /\b(?:for|on|of|concerning|covering|relating to|regarding|on imports of|exports? of)\s+((?:[a-z][a-z\-]+\s){0,3}[a-z][a-z\-]+)/gi;
    let m;
    while ((m = re.exec(t))) {
      const ph = m[1].toLowerCase().replace(/\s+(which|that|and|from|to|in|the|was|were|had|would|by|with)(\s.*)?$/, '').trim();
      const tk = tokens(ph, { keepProcedural: false }).filter(t => !memberToken(t));
      if (tk.length) out.push({ phrase: ph, toks: tk });
    }
    return out;
  }

  let _mt = null;
  function memberToken(t) {
    if (!_mt) { _mt = new Set(); MEMBERS.forEach(m => m.aliases.concat([m.name]).forEach(a => tokens(a).forEach(x => _mt.add(x)))); }
    return _mt.has(t);
  }
  function confidenceLabel(c) { return c >= 0.75 ? 'High' : c >= 0.5 ? 'Medium' : 'Low'; }

  /**
   * Suggest HS codes for a narrative or a short product description.
   * Returns ranked suggestions with the evidence that produced them (explainable AI).
   */
  function suggestHS(text, { limit = 6, short = null } = {}) {
    if (!HS) return [];
    const src = String(text || '');
    const lower = ' ' + src.toLowerCase().replace(/[^a-z0-9\s\-]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const isShort = short == null ? tokens(src).length <= 12 : short;
    const cand = new Map();
    const push = (code, score, evidence, method) => {
      const info = hsInfo(code); if (!info) return;
      const cur = cand.get(code);
      if (!cur || cur.score < score) cand.set(code, { code, score, evidence: cur && cur.evidence !== evidence ? cur.evidence + '; ' + evidence : evidence, method, info });
      else if (cur) cur.score = Math.min(0.97, cur.score + 0.03);
    };

    // 1) Lexicon of known product cues (longest phrases first, avoid double-counting overlaps)
    let masked = lower;
    for (const [ph, codes] of LEX) {
      const needle = ' ' + ph + ' ';
      const alt = ' ' + ph.replace(/s$/, '') + ' ';
      if (masked.includes(needle) || (ph.endsWith('s') && masked.includes(alt))) {
        const base = ph.split(' ').length >= 2 ? 0.88 : 0.78;
        codes.forEach((c, i) => push(c, base - i * 0.06, `mentions “${ph}”`, 'Product dictionary'));
        masked = masked.split(needle).join(' ').split(alt).join(' ');
      }
    }

    // 2) Search the official HS nomenclature
    const queries = isShort ? [{ phrase: src.trim(), toks: tokens(src, { keepProcedural: false }) }] : productPhrases(src);
    for (const q of queries) {
      if (!q.toks.length) continue;
      const hits = HS.bm25.search(q.toks, { limit: 5 });
      if (!hits.length) continue;
      const top = hits[0].score;
      const lexFound = cand.size > 0;
      hits.forEach((h, i) => {
        if (!isShort && (h.coverage < 1 || i > 1)) return; // long narratives: only keep precise matches
        const rel = h.score / top;
        let c = (isShort ? 0.42 : 0.32) + 0.38 * h.coverage * rel - i * 0.04;
        if (h.coverage === 1 && q.toks.length > 1) c += 0.08;
        if (!isShort && lexFound) c -= 0.12;
        if (!isShort && c < 0.45) return;
        push(h.id, Math.max(0.15, Math.min(0.86, c)), `“${q.phrase}” matches HS wording (${h.hits.join(', ')})`, 'HS nomenclature search');
      });
    }

    // 3) For 4-digit headings, find the best 6-digit subheading using the surrounding context
    const ctx = tokens(src, { keepProcedural: false });
    const result = [...cand.values()].map(c => {
      if (c.code.length === 4) {
        const subs = HS.bm25.search(ctx, { limit: 1, filter: d => d.id.length === 6 && d.id.startsWith(c.code) });
        c.subheading = subs.length ? hsInfo(subs[0].id) : null;
      }
      c.confidence = Math.round(c.score * 100) / 100;
      c.level = confidenceLabel(c.confidence);
      return c;
    });
    result.sort((a, b) => b.score - a.score);
    // Keep diversity: no more than 2 codes from the same chapter in the top results
    const seen = {}; const final = [];
    for (const r of result) { const ch = r.code.slice(0, 2); seen[ch] = (seen[ch] || 0) + 1; if (seen[ch] <= 2) final.push(r); if (final.length >= limit) break; }
    return final;
  }

  /* ---------------- Summarisation ---------------- */
  function sentences(text) {
    const t = String(text || '').replace(/\s+/g, ' ').replace(/([a-z\)"])\.(The|He|She|His|Her|They|It|In|However)\b/g, '$1. $2');
    const protectedT = t.replace(/\b(No|Art|e\.g|i\.e|Mr|Mrs|Dr|St|vs|etc|Notif)\./g, '$1§');
    return protectedT.split(/(?<=[.!?])\s+(?=[A-Z"“])/).map(s => s.replace(/§/g, '.').trim()).filter(s => s.length > 20);
  }
  function plainify(s) {
    return s
      .replace(/^The representative of (the )?/i, '')
      .replace(/\bthe representative of (the )?/gi, '')
      .replace(/\bEuropean Communities'/g, "EU's").replace(/\bEuropean Communities\b/g, 'EU')
      .replace(/\b(his|her) (delegation|authorities|government|country)\b/gi, 'their $2')
      .replace(/^(\w)/, c => c.toUpperCase());
  }
  const ASK_RE = /\b(urged|requested|asked|sought|called on|invited|questioned|hoped|looked forward)\b/i;
  const PROBLEM_RE = /\b(concern|regret|difficult|inconsistent|burdensome|negativ|barrier|adverse|not been|no reply|unsatisfactory|problem|prevent|could not|would not)\b/i;

  function summarise(text, opts = {}) {
    const sents = sentences(text);
    if (!sents.length) return { short: '', bullets: [], asks: [], problems: [] };
    const qtoks = tokens(text, { keepProcedural: false });
    const freq = new Map(); qtoks.forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
    const scored = sents.map((s, i) => {
      const tk = tokens(s, { keepProcedural: false });
      let sc = tk.reduce((a, t) => a + Math.log(1 + (freq.get(t) || 0)), 0) / Math.sqrt(tk.length + 4);
      if (i === 0) sc *= 1.6;
      if (PROBLEM_RE.test(s)) sc *= 1.3;
      if (ASK_RE.test(s)) sc *= 1.2;
      if (s.length > 450) sc *= 0.7;
      return { s, i, sc };
    });
    const n = opts.sentences || (sents.length <= 3 ? sents.length : sents.length <= 8 ? 2 : 3);
    const top = [...scored].sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i);
    const used = new Set(top.map(x => x.i));
    const asks = sents.filter((s, i) => ASK_RE.test(s) && !used.has(i)).map(plainify).slice(0, 3);
    const problems = sents.filter((s, i) => PROBLEM_RE.test(s) && !ASK_RE.test(s) && !used.has(i)).map(plainify).slice(0, 3);
    return { short: top.map(x => plainify(x.s)).join(' '), bullets: top.map(x => plainify(x.s)), asks, problems };
  }

  /* ---------------- One-shot full analysis of a concern ---------------- */
  function analyse(text, { raising = '' } = {}) {
    const members = findMembers(text);
    const raisingC = canonMember(raising);
    const others = members.filter(m => m.name !== raisingC);
    const themes = classifyThemes(text);
    const hs = suggestHS(text, { short: false });
    const sum = summarise(text);
    const refs = findReferences(text);
    const words = tokens(text).length;
    // Risk / attention indicator — simple, transparent rule
    let attention = 0; const why = [];
    if (themes.find(t => t.id === 'discrimination')) { attention += 2; why.push('possible discrimination or blocked market access'); }
    if (themes.find(t => t.id === 'transparency')) { attention += 1; why.push('transparency obligations questioned'); }
    if (/inconsistent with|violat|breach/i.test(text)) { attention += 2; why.push('legal inconsistency alleged'); }
    if (/no satisfactory solution|so far no|despite|again|reiterated|for a long time|years/i.test(text)) { attention += 1; why.push('long-running / unresolved'); }
    if (/also expressed|shared the concern|also indicated/i.test(text)) { attention += 1; why.push('other Members share the concern'); }
    const level = attention >= 4 ? 'High' : attention >= 2 ? 'Medium' : 'Low';
    return {
      responding: others[0] ? others[0].name : '', alsoMentioned: others.slice(1, 4).map(m => m.name),
      themes, hs, summary: sum, references: refs, words, attention: { level, score: attention, why }
    };
  }

  global.NLP = { hsIndex: () => HS && HS.bm25, tokens, BM25, MEMBERS, canonMember, findMembers, memberCode, THEMES, classifyThemes, findReferences, buildHS, hsInfo, hsPretty, suggestHS, summarise, sentences, analyse, confidenceLabel, plainify };
})(window);
