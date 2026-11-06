var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils.js
var jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
var nowISO = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "nowISO");
function j(body, status2 = 200) {
  return new Response(JSON.stringify(body), { status: status2, headers: jsonHeaders });
}
__name(j, "j");
function err(e) {
  return String(e?.message || e).slice(0, 300);
}
__name(err, "err");
function norm(s) {
  return String(s || "").normalize("NFKD").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
__name(norm, "norm");
function html(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(html, "html");
function localTime(date = /* @__PURE__ */ new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}
__name(localTime, "localTime");
var isWeekday = /* @__PURE__ */ __name((local) => !["Sat", "Sun"].includes(local.weekday), "isWeekday");
var marketHolidays = {
  2026: ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25"],
  2027: ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
  2028: ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"]
};
function isMarketDay(local) {
  if (!isWeekday(local)) return false;
  const year = Number(local.day.slice(0, 4));
  return !(marketHolidays[year] || []).includes(local.day.slice(5));
}
__name(isMarketDay, "isMarketDay");
function isScanSlot(local) {
  if (local.hour >= 6 && local.hour < 21 && (local.minute === 0 || local.minute === 30) || local.hour === 21 && local.minute === 0) return true;
  return isMarketDay(local) && (local.hour === 7 && (local.minute === 45 || local.minute === 55) || local.hour === 16 && local.minute === 25);
}
__name(isScanSlot, "isScanSlot");
function isPublishSlot(local) {
  return isMarketDay(local) && (local.hour === 8 && local.minute === 0 || local.hour === 16 && local.minute === 30);
}
__name(isPublishSlot, "isPublishSlot");
function isEmailSlot(local) {
  return isMarketDay(local) && local.hour >= 8 && local.hour <= 11 && local.minute % 5 === 0 && !(local.hour === 8 && local.minute < 5);
}
__name(isEmailSlot, "isEmailSlot");
function schedulePlan(local) {
  return { scan: isScanSlot(local), publish: isPublishSlot(local) ? local.hour === 8 ? "morning" : "closing" : null, email: isEmailSlot(local) };
}
__name(schedulePlan, "schedulePlan");
function expectedEdition(local) {
  if (isMarketDay(local)) {
    if (local.hour > 16 || local.hour === 16 && local.minute >= 45) return { date: local.day, kind: "closing" };
    if (local.hour > 8 || local.hour === 8 && local.minute >= 15) return { date: local.day, kind: "morning" };
  }
  const noon = Date.parse(local.day + "T12:00:00Z");
  for (let offset = 1; offset <= 14; offset++) {
    const before = localTime(new Date(noon - offset * 864e5));
    if (isMarketDay(before)) return { date: before.day, kind: "closing" };
  }
  return null;
}
__name(expectedEdition, "expectedEdition");
function validHttps(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
__name(validHttps, "validHttps");
function verifyPublicStory(s) {
  return Boolean(s && s.status === "verified" && s.ticker && s.issuer && s.impact_note?.trim() && validHttps(s.source_url) && validHttps(s.company_evidence_url) && validHttps(s.impact_evidence_url));
}
__name(verifyPublicStory, "verifyPublicStory");
async function digest(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(token, "token");
async function readJSON(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Source HTTP " + response.status);
  return body;
}
__name(readJSON, "readJSON");
function base(env) {
  return (env.BASE_URL || "https://tickerdocket.com").replace(/\/$/, "");
}
__name(base, "base");

// src/fda.js
var COMPANY_ALIASES = [
  ["ABBOTT LABORATORIES", "ABT", "Abbott Laboratories", "direct"],
  ["ABBOTT MEDICAL", "ABT", "Abbott Laboratories", "affiliate-review"],
  ["MEDTRONIC INC", "MDT", "Medtronic plc", "affiliate-review"],
  ["MEDTRONIC USA INC", "MDT", "Medtronic plc", "affiliate-review"],
  ["BOSTON SCIENTIFIC CORP", "BSX", "Boston Scientific", "direct"],
  ["BOSTON SCIENTIFIC CORPORATION", "BSX", "Boston Scientific", "direct"],
  ["STRYKER CORPORATION", "SYK", "Stryker", "direct"],
  ["STRYKER CORP", "SYK", "Stryker", "direct"],
  ["INTUITIVE SURGICAL INC", "ISRG", "Intuitive Surgical", "direct"],
  ["DEXCOM INC", "DXCM", "DexCom", "direct"],
  ["EDWARDS LIFESCIENCES LLC", "EW", "Edwards Lifesciences", "affiliate-review"],
  ["EDWARDS LIFESCIENCES CORPORATION", "EW", "Edwards Lifesciences", "direct"],
  ["HOLOGIC INC", "HOLX", "Hologic", "direct"],
  ["PENUMBRA INC", "PEN", "Penumbra", "direct"],
  ["TANDEM DIABETES CARE INC", "TNDM", "Tandem Diabetes Care", "direct"],
  ["INSULET CORPORATION", "PODD", "Insulet", "direct"],
  ["ALIGN TECHNOLOGY INC", "ALGN", "Align Technology", "direct"],
  ["ZIMMER BIOMET HOLDINGS INC", "ZBH", "Zimmer Biomet", "direct"],
  ["GLOBUS MEDICAL INC", "GMED", "Globus Medical", "direct"],
  ["BECTON DICKINSON AND COMPANY", "BDX", "Becton Dickinson", "direct"],
  ["GE HEALTHCARE TECHNOLOGIES INC", "GEHC", "GE HealthCare", "direct"],
  ["RESMED INC", "RMD", "ResMed", "direct"],
  ["COOPERSURGICAL INC", "COO", "CooperCompanies", "affiliate-review"],
  ["ETHICON INC", "JNJ", "Johnson & Johnson", "affiliate-review"],
  ["BARD PERIPHERAL VASCULAR INC", "BDX", "Becton Dickinson", "affiliate-review"],
  ["ABBOTT DIABETES CARE INC", "ABT", "Abbott Laboratories", "affiliate-review"]
];
function cleanCompany(s) {
  return String(s || "").normalize("NFKD").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
__name(cleanCompany, "cleanCompany");
var aliasMap = new Map(COMPANY_ALIASES.map(([alias, ticker, issuer, method]) => [cleanCompany(alias), { ticker, issuer, method }]));
function matchPublicIssuer(applicant) {
  return aliasMap.get(cleanCompany(applicant)) || null;
}
__name(matchPublicIssuer, "matchPublicIssuer");
function dateCompact(value) {
  const s = String(value || "").replace(/[^0-9]/g, "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
}
__name(dateCompact, "dateCompact");
var SE_CODES = /* @__PURE__ */ new Set(["SESE", "SEKD", "SESD", "SESK", "SESP", "SESL"]);
var PMA_APPROVED_CODES = /* @__PURE__ */ new Set(["APPR"]);
function normalizeFDADecision(row, kind) {
  const applicant = String(row?.applicant || "").trim();
  const decision_date = dateCompact(row?.decision_date);
  const code = String(row?.decision_code || "").toUpperCase().trim();
  if (!decision_date || !applicant) return null;
  let id, application, device_name, supplement = "", eventLabel, source_url;
  if (kind === "510k") {
    if (!SE_CODES.has(code)) return null;
    application = String(row?.k_number || "").toUpperCase().trim();
    if (!/^K\d{6}$/.test(application)) return null;
    id = "510k:" + application;
    device_name = String(row?.device_name || "Unnamed device").trim();
    eventLabel = "510(k) clearance";
    source_url = "https://api.fda.gov/device/510k.json?search=" + encodeURIComponent('k_number:"' + application + '"');
  } else if (kind === "pma") {
    if (!PMA_APPROVED_CODES.has(code)) return null;
    application = String(row?.pma_number || "").toUpperCase().trim();
    supplement = String(row?.supplement_number || "").toUpperCase().trim();
    if (!/^[A-Z]{1,2}\d{5,7}$/.test(application)) return null;
    id = "pma:" + application + ":" + (supplement || "original");
    device_name = String(row?.trade_name || row?.generic_name || "Unnamed device").trim();
    eventLabel = supplement ? "PMA supplement approval" : "Original PMA approval";
    source_url = "https://api.fda.gov/device/pma.json?search=" + encodeURIComponent('pma_number:"' + application + '"' + (supplement ? ' AND supplement_number:"' + supplement + '"' : ""));
  } else return null;
  const match = matchPublicIssuer(applicant);
  let score = kind === "510k" ? 55 : supplement ? 64 : 80;
  if (match) score += match.method === "direct" ? 16 : 10;
  score = Math.min(100, score);
  const tier = score >= 70 ? "High review" : score >= 45 ? "Worth reviewing" : "Background";
  const rationale = kind === "510k" ? "Substantial-equivalence clearance (not PMA approval). Commercial size and stock-price impact are unknown." : supplement ? "Approved PMA supplement; not necessarily an entirely new product. Check what changed before assessing commercial impact." : "Original PMA approval may represent a device-market authorization; commercial and stock impact require validation.";
  return {
    id,
    kind,
    event_label: eventLabel,
    application_number: application,
    supplement_number: supplement,
    device_name,
    applicant,
    product_code: String(row?.product_code || ""),
    decision_code: code,
    decision_date,
    source_url,
    ticker: match?.ticker || null,
    issuer_name: match?.issuer || null,
    match_type: match?.method || "unmatched",
    score,
    tier,
    rationale: rationale + (match?.method === "affiliate-review" ? " Parent/subsidiary ticker association is a candidate and needs confirmation." : match ? " Issuer-name mapping is curated, not a live SEC identity check." : " No public-company ticker has been verified.")
  };
}
__name(normalizeFDADecision, "normalizeFDADecision");
function fdaRangeEnd(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}
__name(fdaRangeEnd, "fdaRangeEnd");
function fdaRangeStart(now = /* @__PURE__ */ new Date(), days = 90) {
  return new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
}
__name(fdaRangeStart, "fdaRangeStart");
async function readPage(url, fetchFn) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25e3);
  try {
    const r = await fetchFn(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await r.json().catch(() => ({}));
    if (r.status === 404 && payload?.error?.code === "NOT_FOUND" && /no matches/i.test(JSON.stringify(payload))) return { results: [], meta: {} };
    if (!r.ok) throw new Error(`openFDA HTTP ${r.status}: ${String(payload?.error?.message || "source error").slice(0, 100)}`);
    if (!Array.isArray(payload.results)) throw new Error("FDA response is missing results array");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
__name(readPage, "readPage");
async function fetchFDAFeed(kind, now = /* @__PURE__ */ new Date(), fetchFn = fetch) {
  const start = fdaRangeStart(now, 21), end = fdaRangeEnd(now);
  const api = kind === "510k" ? "https://api.fda.gov/device/510k.json" : "https://api.fda.gov/device/pma.json";
  if (!["510k", "pma"].includes(kind)) throw new Error("Unknown FDA feed");
  const results = [];
  let metaDate = null;
  const maxPages = 4, limit = 500;
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(api);
    url.searchParams.set("search", `decision_date:[${start} TO ${end}]`);
    url.searchParams.set("sort", "decision_date:desc");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(page * limit));
    const data = await readPage(url, fetchFn);
    total = Number(data.meta?.results?.total ?? 0);
    metaDate = data.meta?.last_updated || metaDate;
    results.push(...data.results);
    if (data.results.length < limit) break;
  }
  if (total > results.length) throw new Error(`FDA ${kind} result window contains ${total} rows, but scan cap is ${results.length}; reduce lookback or enable pagination`);
  return { kind, count: results.length, updated_at: metaDate, decisions: results.map((r) => normalizeFDADecision(r, kind)).filter(Boolean) };
}
__name(fetchFDAFeed, "fetchFDAFeed");

// src/ingest.js
var REGISTER = "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json";
var SEC = "https://www.sec.gov/files/company_tickers_exchange.json";
function fdDoc(d) {
  const id = String(d.document_number || "");
  if (!/^\d{4}-\d{4,6}$/.test(id)) return null;
  const agencies = (d.agencies || []).map((x) => x.name).filter(Boolean).join(", ");
  const url = d.html_url || d.pdf_url || `https://www.federalregister.gov/d/${id}`;
  return { id: "fr-" + id, source: "Federal Register public inspection", source_url: url, title: String(d.title || "Untitled"), agency: agencies, event_type: String(d.type || "notice"), action_date: d.filed_at?.slice(0, 10) || d.publication_date || null, applicant: null, device_code: null };
}
__name(fdDoc, "fdDoc");
function legalName(s) {
  return norm(s).replace(/\b(CORPORATION|CORP|INCORPORATED|INC|LIMITED|LTD|PLC|CO|COMPANY)\b/g, "").replace(/\s+/g, " ").trim();
}
__name(legalName, "legalName");
async function exactSECApplicants(applicants, fetchFn = fetch) {
  if (!applicants.length) return /* @__PURE__ */ new Map();
  try {
    const r = await fetchFn(SEC, { headers: { "Accept": "application/json", "User-Agent": "TickerDocket research editorial research@tickerdocket.com" }, signal: AbortSignal.timeout(12e3) });
    if (!r.ok) throw Error("SEC issuer reference unavailable");
    const rows = await r.json(), m = /* @__PURE__ */ new Map(), headers = rows.fields || ["cik", "name", "ticker", "exchange"];
    const byTicker = /* @__PURE__ */ new Map();
    for (const raw of rows.data || []) {
      const row = Object.fromEntries(headers.map((h, i) => [h, raw[i]]));
      const name = norm(row.name);
      const ticker = String(row.ticker || "").trim().toUpperCase();
      if (!name || !/^[A-Z.\-]{1,12}$/.test(ticker)) continue;
      const exchange = String(row.exchange || "").toUpperCase();
      if (!/NASDAQ|NYSE|AMEX|CBOE/.test(exchange)) continue;
      byTicker.set(ticker, row);
      if (applicants.includes(name)) m.set(name, { ticker, issuer: row.name, issuer_evidence_url: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(row.cik)}`, method: "sec-exact" });
    }
    for (const name of applicants) {
      if (m.has(name)) continue;
      const alias = matchPublicIssuer(name);
      if (!alias || alias.method !== "direct") continue;
      const row = byTicker.get(alias.ticker);
      if (!row || legalName(name) !== legalName(row.name)) continue;
      m.set(name, { ticker: alias.ticker, issuer: row.name, issuer_evidence_url: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(row.cik)}`, method: "sec-direct-legal-alias" });
    }
    return m;
  } catch (e) {
    const reason = "SEC public-issuer verification unavailable: " + err(e);
    console.warn(reason);
    const empty = /* @__PURE__ */ new Map();
    empty.verification_error = reason;
    return empty;
  }
}
__name(exactSECApplicants, "exactSECApplicants");
async function mappings(env) {
  const r = await env.DB.prepare("SELECT * FROM company_mappings").all();
  return new Map((r.results || []).map((x) => [x.applicant_norm, x]));
}
__name(mappings, "mappings");
async function logRun(env, source, start, status2, count, added, error) {
  await env.DB.prepare("INSERT INTO sync_runs(source,started_at,ended_at,status,seen_count,inserted_count,error) VALUES(?,?,?,?,?,?,?)").bind(source, start, nowISO(), status2, count, added, error || null).run();
}
__name(logRun, "logRun");
async function saveBatch(env, records, day, manualMap, secMap) {
  let inserted = 0;
  for (let i = 0; i < records.length; i += 30) {
    const b = [];
    for (const item of records.slice(i, i + 30)) {
      if (!item || !validHttps(item.source_url)) continue;
      const mapped = manualMap.get(norm(item.applicant)) || secMap.get(norm(item.applicant));
      const approved = !!mapped && String(item.source).startsWith("FDA") && // Subsidiary mappings need a documented issuer-to-applicant ownership link.
      (!manualMap.has(norm(item.applicant)) || norm(item.applicant) === norm(mapped.issuer) || validHttps(mapped.ownership_evidence_url));
      const relation = mapped?.ownership_evidence_url || mapped?.issuer_evidence_url || null;
      const statement = approved ? `FDA record names ${item.applicant} as applicant. ${mapped.issuer} (${mapped.ticker}) is linked through the documented applicant/issuer identity or ownership evidence. This is direct device-regulatory exposure; commercial materiality is unknown.` : null;
      b.push(env.DB.prepare(`INSERT INTO candidates (id,source,source_url,title,agency,event_type,action_date,applicant,device_code,first_seen_local,first_seen_at,last_seen_at,status,ticker,issuer,company_evidence_url,impact_evidence_url,impact_note,approval_method,approved_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,source_url=excluded.source_url,
   title=excluded.title,action_date=excluded.action_date,
   status=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN 'verified' ELSE candidates.status END,
   ticker=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.ticker ELSE candidates.ticker END,
   issuer=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.issuer ELSE candidates.issuer END,
   company_evidence_url=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.company_evidence_url ELSE candidates.company_evidence_url END,
   impact_evidence_url=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.impact_evidence_url ELSE candidates.impact_evidence_url END,
   impact_note=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.impact_note ELSE candidates.impact_note END,
   approval_method=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.approval_method ELSE candidates.approval_method END,
   approved_at=CASE WHEN candidates.status='pending' AND excluded.status='verified' THEN excluded.approved_at ELSE candidates.approved_at END`).bind(item.id, item.source, item.source_url, item.title, item.agency, item.event_type, item.action_date, item.applicant, item.device_code, day, nowISO(), nowISO(), approved ? "verified" : "pending", approved ? mapped.ticker : null, approved ? mapped.issuer : null, approved ? mapped.issuer_evidence_url : null, approved ? item.source_url : null, statement, approved ? mapped.method || "admin-verified-mapping" : null, approved ? nowISO() : null));
      inserted++;
    }
    if (b.length) await env.DB.batch(b);
  }
  return inserted;
}
__name(saveBatch, "saveBatch");
async function scanSource(env, source = "all", at = /* @__PURE__ */ new Date()) {
  const day = localTime(at).day, results = {};
  const manualMap = await mappings(env);
  if (source === "all" || source === "federal") {
    const start = nowISO();
    let count = 0;
    try {
      const r = await fetch(REGISTER, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(23e3) });
      const data = await readJSON(r);
      if (!Array.isArray(data.results)) throw Error("Invalid Federal Register schema");
      const rows = data.results.slice(0, 500).map(fdDoc).filter(Boolean);
      count = rows.length;
      const added = await saveBatch(env, rows, day, manualMap, /* @__PURE__ */ new Map());
      await logRun(env, "federal", start, "ok", count, added);
      results.federal = { ok: true, count, saved: added };
    } catch (e) {
      await logRun(env, "federal", start, "error", count, 0, err(e));
      results.federal = { ok: false, error: err(e) };
    }
  }
  if (source === "all" || source === "fda") {
    for (const kind of ["510k", "pma"]) {
      const start = nowISO();
      let count = 0;
      try {
        const feed2 = await fetchFDAFeed(kind, at);
        count = feed2.decisions.length;
        const sec = await exactSECApplicants([...new Set(feed2.decisions.map((d) => norm(d.applicant)).filter(Boolean))]);
        const rows = feed2.decisions.map((d) => ({
          id: d.id,
          source: kind === "510k" ? "FDA 510(k) clearance" : "FDA PMA approval",
          source_url: d.source_url,
          title: `${d.event_label}: ${d.device_name} (${d.application_number})`,
          agency: "FDA",
          event_type: d.event_label,
          action_date: d.decision_date,
          applicant: d.applicant,
          device_code: d.product_code
        }));
        const added = await saveBatch(env, rows, day, manualMap, sec);
        const secError = sec.verification_error || null;
        await logRun(env, kind, start, secError ? "partial" : "ok", count, added, secError);
        results[kind] = { ok: !secError, count, saved: added, fda_data_updated_at: feed2.updated_at, issuer_verified: !secError, error: secError };
      } catch (e) {
        await logRun(env, kind, start, "error", count, 0, err(e));
        results[kind] = { ok: false, error: err(e) };
      }
    }
  }
  return results;
}
__name(scanSource, "scanSource");

// src/activity.js
async function activity(env) {
  const runs = (await env.DB.prepare(`SELECT source,started_at,ended_at,status,seen_count,inserted_count,error
    FROM sync_runs WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY source) ORDER BY source`).all()).results || [];
  const edition = await env.DB.prepare("SELECT published_at,kind,local_date FROM editions ORDER BY id DESC LIMIT 1").first();
  const totals = await env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM candidates`).first();
  const raw = (await env.DB.prepare(`SELECT id,title,ticker,issuer,agency,event_type,action_date,source,source_url,
       company_evidence_url,impact_evidence_url,impact_note,approved_at,first_seen_at,status
    FROM candidates WHERE status='verified'
    ORDER BY COALESCE(approved_at,first_seen_at) DESC, id DESC LIMIT 80`).all()).results || [];
  const items = raw.filter(verifyPublicStory).slice(0, 18).map((x) => ({
    id: x.id,
    title: x.title,
    ticker: x.ticker,
    issuer: x.issuer,
    agency: x.agency,
    event_type: x.event_type,
    action_date: x.action_date,
    source: x.source,
    source_url: x.source_url,
    company_evidence_url: x.company_evidence_url,
    impact_evidence_url: x.impact_evidence_url,
    impact_note: x.impact_note,
    verified_at: x.approved_at,
    first_seen_at: x.first_seen_at
  }));
  const pendingBySource = (await env.DB.prepare(`SELECT source,COUNT(*) n FROM candidates WHERE status='pending' GROUP BY source`).all()).results || [];
  const newFindings = items.filter((x) => !edition?.published_at || Date.parse(x.first_seen_at) > Date.parse(edition.published_at) || Date.parse(x.verified_at) > Date.parse(edition.published_at));
  const last = runs.filter((x) => x.ended_at).map((x) => Date.parse(x.ended_at)).filter(Number.isFinite);
  const lastScan = last.length ? new Date(Math.max(...last)).toISOString() : null;
  const healthy = runs.length >= 3 && runs.every((x) => x.status === "ok" && x.ended_at && Date.now() - Date.parse(x.ended_at) < 75 * 6e4);
  return {
    as_of: nowISO(),
    last_scan_at: lastScan,
    collection_started: runs.length > 0,
    refresh_schedule: { from: "06:00", to: "21:00", every_minutes: 30, time_zone: "America/Chicago" },
    last_published_edition: edition,
    source_healthy: healthy,
    new_since_edition: newFindings,
    pending_by_source: pendingBySource,
    source_checks: runs,
    counts: { collected: totals?.total || 0, verified: totals?.verified || 0, pending_review: totals?.pending || 0 },
    verified_findings: items,
    note: "New verified records appear between half-hour scans without rewriting immutable editions. Verified research records are not an edition. FDA data publication may lag its underlying decision date; stock-price effects are not established."
  };
}
__name(activity, "activity");

// src/email.js
var MAIL = "https://api.resend.com/emails";
var emailReady = /* @__PURE__ */ __name((env) => Boolean((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.EMAIL_FROM && env.EMAIL_POSTAL_ADDRESS && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && env.EMAIL_LINK_SECRET), "emailReady");
async function mail(env, to, subject, body, headers = {}) {
  const useBrevo = Boolean(env.BREVO_API_KEY);
  const response = await fetch(useBrevo ? "https://api.brevo.com/v3/smtp/email" : MAIL, { method: "POST", headers: useBrevo ? { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" } : { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(useBrevo ? { sender: { name: env.SENDER_NAME || "TickerDocket", email: env.EMAIL_FROM }, to: [{ email: to }], subject, htmlContent: body, headers } : { from: `${env.SENDER_NAME || "TickerDocket"} <${env.EMAIL_FROM}`, to: [to], subject, html: body, headers }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error("Email provider HTTP " + response.status + " " + String(data.message || data.code || "").slice(0, 100));
  return data.messageId || data.id || null;
}
__name(mail, "mail");
async function validateTurnstile(env, answer, ip) {
  if (!env.TURNSTILE_SECRET || !answer) return false;
  const fd = new FormData();
  fd.set("secret", env.TURNSTILE_SECRET);
  fd.set("response", answer);
  if (ip) fd.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
  return !!(await r.json()).success;
}
__name(validateTurnstile, "validateTurnstile");
function confirmationHTML(env, url) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#123"><h1>TickerDocket</h1><p>Confirm your request to receive the morning regulatory intelligence briefing.</p><p><a style="background:#087a75;color:white;padding:13px 18px;display:inline-block" href="${html(url)}">Confirm subscription</a></p><p>If you didn't request this, ignore this email.</p><hr><small>${html(env.EMAIL_POSTAL_ADDRESS)}</small></div>`;
}
__name(confirmationHTML, "confirmationHTML");
async function subscribe(req, env) {
  if (!emailReady(env)) return j({ error: "Newsletter signups are not active until the sender domain, email service and bot protection are configured." }, 503);
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@.]+\.[^\s@.]{2,}$/.test(email) || email.length > 254) return j({ error: "Enter a valid email address." }, 400);
  if (body.agree !== true) return j({ error: "Consent is required." }, 400);
  const good = await validateTurnstile(env, body.turnstile, req.headers.get("CF-Connecting-IP"));
  if (!good) return j({ error: "Bot verification was not completed." }, 400);
  const existing = await env.DB.prepare("SELECT * FROM subscribers WHERE email=?").bind(email).first();
  if (existing?.status === "active" || existing?.status === "unsubscribed" || existing?.status === "suppressed") return j({ ok: true, message: "If this address is eligible, subscription instructions will be emailed." });
  const secret = token(), unsubscribe2 = token(), hash = await digest(secret), unsubHash = await digest(unsubscribe2), exp = new Date(Date.now() + 72 * 36e5).toISOString();
  let id = existing?.id;
  if (existing) {
    await env.DB.prepare("UPDATE subscribers SET confirm_hash=?,confirm_expires_at=?,status=? WHERE id=?").bind(hash, exp, "pending", id).run();
  } else {
    const r = await env.DB.prepare("INSERT INTO subscribers(email,status,created_at,confirm_hash,confirm_expires_at,unsubscribe_hash,consent_source) VALUES(?,?,?,?,?,?,?)").bind(email, "pending", nowISO(), hash, exp, unsubHash, "website/checkbox/turnstile").run();
    id = r.meta?.last_row_id;
  }
  try {
    await mail(env, email, "Confirm your TickerDocket morning briefing", confirmationHTML(env, base(env) + "/api/confirm?token=" + encodeURIComponent(secret)));
    await env.DB.prepare("INSERT INTO email_events(event_type,subscriber_id,timestamp,detail) VALUES(?,?,?,?)").bind("confirm_sent", id, nowISO(), null).run();
    return j({ ok: true, message: "Check your email to confirm your subscription." });
  } catch (e) {
    console.error("confirm delivery failed", err(e));
    return j({ error: "Confirmation email could not be sent. Please try again." }, 502);
  }
}
__name(subscribe, "subscribe");
function simplePage(title, message2) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${html(title)} | TickerDocket</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font:16px system-ui;background:#07101c;color:#eef;padding:8vw"><h1>${html(title)}</h1><p>${html(message2)}</p><a style="color:#40e0c0" href="/">Back to TickerDocket</a></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
__name(simplePage, "simplePage");
async function confirm(req, env) {
  const secret = new URL(req.url).searchParams.get("token");
  if (!secret || secret.length !== 64) return simplePage("Invalid link", "This confirmation link is invalid.");
  const h = await digest(secret), s = await env.DB.prepare("SELECT id,confirm_expires_at,status FROM subscribers WHERE confirm_hash=?").bind(h).first();
  if (!s || s.status !== "pending" || new Date(s.confirm_expires_at).getTime() < Date.now()) return simplePage("Expired or invalid link", "This link is no longer valid.");
  await env.DB.prepare("UPDATE subscribers SET status=?,confirmed_at=?,confirm_hash=NULL,confirm_expires_at=NULL WHERE id=?").bind("active", nowISO(), s.id).run();
  await env.DB.prepare("INSERT INTO email_events(event_type,subscriber_id,timestamp) VALUES(?,?,?)").bind("confirmed", s.id, nowISO()).run();
  return simplePage("Subscription confirmed", "You are subscribed to the TickerDocket morning edition.");
}
__name(confirm, "confirm");
async function unsubscribe(req, env) {
  const secret = new URL(req.url).searchParams.get("token");
  if (!secret || secret.length !== 64) return simplePage("Invalid link", "This unsubscribe link is invalid.");
  const h = await digest(secret), s = await env.DB.prepare("SELECT id FROM subscribers WHERE unsubscribe_hash=?").bind(h).first();
  if (!s) return simplePage("Link not found", "This unsubscribe link is invalid.");
  if (req.method === "GET") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:16px system-ui;background:#07101c;color:#eee;padding:8vw"><h1>Unsubscribe</h1><p>Stop TickerDocket briefing emails?</p><form method="POST"><button style="padding:13px 22px" type="submit">Confirm unsubscribe</button></form></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  await env.DB.prepare("UPDATE subscribers SET status=?,suppressed_reason=? WHERE id=?").bind("unsubscribed", "subscriber request", s.id).run();
  await env.DB.prepare("UPDATE email_queue SET status=? WHERE subscriber_id=? AND status IN (?,?)").bind("cancelled", s.id, "queued", "failed").run();
  await env.DB.prepare("INSERT INTO email_events(event_type,subscriber_id,timestamp) VALUES(?,?,?)").bind("unsubscribed", s.id, nowISO()).run();
  return simplePage("Unsubscribed", "You will no longer receive TickerDocket emails.");
}
__name(unsubscribe, "unsubscribe");
async function queueMorning(env, editionId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO email_queue(edition_id,subscriber_id)
 SELECT ?,id FROM subscribers WHERE status='active'`).bind(editionId).run();
}
__name(queueMorning, "queueMorning");
async function flushMail(env, limit = 20) {
  if (!emailReady(env)) return { sent: 0, skipped: true, reason: "Email not configured" };
  const rows = (await env.DB.prepare(`SELECT q.id,q.edition_id,q.subscriber_id,q.attempts,s.email,s.unsubscribe_hash,
 e.local_date,e.kind FROM email_queue q JOIN subscribers s ON s.id=q.subscriber_id JOIN editions e ON e.id=q.edition_id
 WHERE q.status IN ('queued','failed') AND q.attempts<3 AND s.status='active' AND e.kind='morning'
 ORDER BY q.id ASC LIMIT ?`).bind(limit).all()).results || [];
  let sent = 0, failed = 0;
  for (const q of rows) {
    const items = (await env.DB.prepare("SELECT title,ticker,source,source_url,candidate_id FROM edition_items WHERE edition_id=? ORDER BY ticker ASC LIMIT 15").bind(q.edition_id).all()).results || [];
    const unsub = await makeUnsubscribeLink(env, q.subscriber_id);
    const link = base(env) + "/?utm_source=morning_email&utm_medium=email&utm_campaign=" + encodeURIComponent(q.local_date);
    const parts = items.map((x) => `<li><strong>${html(x.ticker)}</strong> \u2014 <a href="${html(base(env) + "/story/" + encodeURIComponent(x.candidate_id))}">${html(x.title)}</a></li>`).join("");
    const message2 = `<div style="font:16px/1.6 Arial,sans-serif;max-width:650px;margin:auto;color:#15233b"><h1>TickerDocket</h1><p><b>${html(q.local_date)} \xB7 8:00 AM Central premarket edition</b></p>${items.length ? `<p>Verified regulatory developments involving publicly traded companies:</p><ul>${parts}</ul>` : "<p>No newly verified public-company regulatory developments qualified for this edition.</p>"}<p><a href="${html(link)}">Open the full edition and supporting evidence</a></p><hr><p style="font-size:12px;color:#637">TickerDocket publishes independent research. Advertising never determines coverage. Regulatory exposure does not imply a stock-price movement.</p><p style="font-size:12px;color:#637">${html(env.EMAIL_POSTAL_ADDRESS)} \xB7 <a href="${html(unsub)}">Unsubscribe</a></p></div>`;
    try {
      const provider = await mail(env, q.email, `TickerDocket | ${q.local_date} Morning Brief`, message2, { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
      await env.DB.prepare("UPDATE email_queue SET status=?,attempts=attempts+1,last_attempt_at=?,sent_at=?,provider_id=?,error=NULL WHERE id=?").bind("sent", nowISO(), nowISO(), provider, q.id).run();
      sent++;
    } catch (e) {
      await env.DB.prepare("UPDATE email_queue SET status=?,attempts=attempts+1,last_attempt_at=?,error=? WHERE id=?").bind("failed", nowISO(), err(e), q.id).run();
      failed++;
    }
  }
  return { sent, failed, processed: rows.length };
}
__name(flushMail, "flushMail");
async function mac(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.EMAIL_LINK_SECRET), "HMAC", { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(mac, "mac");
async function makeUnsubscribeLink(env, id) {
  const sig = await mac(env, String(id));
  return base(env) + "/api/unsubscribe-signed?id=" + id + "&sig=" + sig;
}
__name(makeUnsubscribeLink, "makeUnsubscribeLink");
async function unsubscribeSigned(req, env) {
  if (!env.EMAIL_LINK_SECRET) return simplePage("Unavailable", "Unsubscribe is temporarily unavailable. Contact the publisher.");
  const u = new URL(req.url), id = Number(u.searchParams.get("id")), sig = u.searchParams.get("sig");
  if (!Number.isSafeInteger(id) || id <= 0 || !sig || !/^[a-f0-9]{64}$/.test(sig)) return simplePage("Invalid link", "This unsubscribe link is invalid.");
  const valid = await mac(env, String(id));
  if (sig !== valid) return simplePage("Invalid link", "This unsubscribe link is invalid.");
  if (req.method === "GET") return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px system-ui;padding:8vw;background:#07101c;color:#eee"><h1>Unsubscribe</h1><p>Unsubscribe from TickerDocket newsletters?</p><form method="POST"><button type="submit">Confirm unsubscribe</button></form></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  await env.DB.prepare("UPDATE subscribers SET status='unsubscribed',suppressed_reason='subscriber request' WHERE id=?").bind(id).run();
  await env.DB.prepare("UPDATE email_queue SET status='cancelled' WHERE subscriber_id=? AND status IN ('queued','failed')").bind(id).run();
  await env.DB.prepare("INSERT INTO email_events(event_type,subscriber_id,timestamp) VALUES(?,?,?)").bind("unsubscribed", id, nowISO()).run();
  return simplePage("Unsubscribed", "You will no longer receive TickerDocket briefing emails.");
}
__name(unsubscribeSigned, "unsubscribeSigned");

// src/worker.js
var message = /* @__PURE__ */ __name((code, text) => j({ error: text }, code), "message");
function authorized(request, secret) {
  const header = request.headers.get("Authorization") || "";
  return Boolean(secret && header === "Bearer " + secret);
}
__name(authorized, "authorized");
var dateOK = /* @__PURE__ */ __name((x) => /^\d{4}-\d{2}-\d{2}$/.test(x || ""), "dateOK");
async function latestEdition(env, day, kind) {
  const query = day && kind ? env.DB.prepare("SELECT * FROM editions WHERE local_date=? AND kind=? ORDER BY id DESC LIMIT 1").bind(day, kind) : env.DB.prepare("SELECT * FROM editions ORDER BY id DESC LIMIT 1");
  return query.first();
}
__name(latestEdition, "latestEdition");
async function editionItems(env, id) {
  return (await env.DB.prepare("SELECT * FROM edition_items WHERE edition_id=? ORDER BY action_date DESC,ticker ASC LIMIT 100").bind(id).all()).results || [];
}
__name(editionItems, "editionItems");
function selectEditionCutoff(previous, now = /* @__PURE__ */ new Date()) {
  return previous?.published_at || new Date(now.getTime() - 72 * 3600 * 1e3).toISOString();
}
__name(selectEditionCutoff, "selectEditionCutoff");
async function sourceCoverage(env, at = nowISO()) {
  const rows = (await env.DB.prepare(`SELECT s.source,s.status,s.ended_at,s.error FROM sync_runs s
   WHERE s.id IN (SELECT MAX(id) FROM sync_runs GROUP BY source)`).all()).results || [];
  const by = Object.fromEntries(rows.map((x) => [x.source, x]));
  const isFresh = /* @__PURE__ */ __name((x) => x && x.ended_at && Date.parse(at) - Date.parse(x.ended_at) < 75 * 6e4, "isFresh");
  const sources = ["federal", "510k", "pma"];
  return sources.every((k) => isFresh(by[k]) && by[k].status === "ok") ? "checked" : sources.some((k) => isFresh(by[k]) && ["ok", "partial"].includes(by[k].status)) ? "partial" : "incomplete";
}
__name(sourceCoverage, "sourceCoverage");
async function publish(env, kind, local) {
  if (!["morning", "closing"].includes(kind)) throw Error("Invalid edition type");
  const exists = await latestEdition(env, local.day, kind);
  if (exists) return { already_published: true, edition_id: exists.id, items: exists.qualifying_count };
  const at = nowISO();
  const previous = await latestEdition(env);
  const cutoff = selectEditionCutoff(previous, new Date(at));
  const health = await sourceCoverage(env, at);
  const selected = (await env.DB.prepare(`SELECT * FROM candidates WHERE status='verified'
   AND (first_seen_at > ? OR approved_at > ?)
   ORDER BY COALESCE(approved_at,first_seen_at) DESC,id ASC LIMIT 150`).bind(cutoff, cutoff).all()).results || [];
  const qualified = selected.filter(verifyPublicStory);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO editions(local_date,kind,published_at,status,scan_status,qualifying_count,notes) VALUES(?,?,?,?,?,?,?)").bind(
    local.day,
    kind,
    at,
    qualified.length ? "published" : "no_new_verified_items",
    health,
    qualified.length,
    "Immutable point-in-time snapshot of directly verified public-company developments newly discovered since previous edition. Not a trading recommendation. Source publication can lag."
  ).run();
  const edition = await latestEdition(env, local.day, kind);
  if (!r.meta?.changes) return { already_published: true, edition_id: edition.id };
  for (let i = 0; i < qualified.length; i += 30) {
    await env.DB.batch(qualified.slice(i, i + 30).map((x) => env.DB.prepare(`INSERT OR IGNORE INTO edition_items
   (edition_id,candidate_id,title,ticker,issuer,source,source_url,action_date,agency,event_type,impact_note,company_evidence_url,impact_evidence_url)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(edition.id, x.id, x.title, x.ticker, x.issuer, x.source, x.source_url, x.action_date, x.agency, x.event_type, x.impact_note, x.company_evidence_url, x.impact_evidence_url)));
  }
  if (kind === "morning") await queueMorning(env, edition.id);
  return { edition_id: edition.id, day: local.day, kind, items: qualified.length, scan_status: health, cutoff };
}
__name(publish, "publish");
async function status(env) {
  const last = (await env.DB.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 8").all()).results || [];
  const edition = await latestEdition(env);
  const subscribers = await env.DB.prepare("SELECT COUNT(*) count FROM subscribers WHERE status='active'").first();
  const queued = await env.DB.prepare("SELECT COUNT(*) count FROM email_queue WHERE status IN ('queued','failed')").first();
  const lastSuccess = await env.DB.prepare("SELECT MAX(ended_at) at FROM sync_runs WHERE status='ok'").first();
  const at = edition?.published_at ? new Date(edition.published_at).getTime() : null;
  const ageHours = at == null ? null : Math.round((Date.now() - at) / 36e4) / 10;
  const local = localTime();
  const expected = expectedEdition(local);
  const editionKey = edition ? edition.local_date + (edition.kind === "closing" ? "2" : "1") : null;
  const expectedKey = expected ? expected.date + (expected.kind === "closing" ? "2" : "1") : null;
  const late = Boolean(expectedKey && (!editionKey || editionKey < expectedKey));
  return {
    version: "1.3-half-hour-automation",
    now: nowISO(),
    central: local,
    expected_edition: expected,
    latest_edition: edition ? { date: edition.local_date, kind: edition.kind, published_at: edition.published_at, count: edition.qualifying_count, scan_status: edition.scan_status } : null,
    age_hours: ageHours,
    stale: late,
    last_runs: last,
    last_successful_source_check: lastSuccess?.at || null,
    schedule: {
      time_zone: "America/Chicago",
      standard_updates: "06:00\u201321:00 every 30 minutes, daily",
      premarket: "08:00",
      closing: "16:30",
      edition_days: "NYSE/Nasdaq market days",
      prebrief_checks: ["07:45", "07:55", "16:25"]
    },
    mail_configured: emailReady(env),
    active_subscribers: subscribers?.count || 0,
    pending_emails: queued?.count || 0
  };
}
__name(status, "status");
async function feed(req, env) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day"), kind = url.searchParams.get("kind");
  if (day && !dateOK(day)) return message(400, "Invalid date");
  if (kind && !["morning", "closing"].includes(kind)) return message(400, "Invalid edition");
  let edition;
  if (day && kind) edition = await latestEdition(env, day, kind);
  else if (day) edition = await env.DB.prepare("SELECT * FROM editions WHERE local_date=? ORDER BY id DESC LIMIT 1").bind(day).first();
  else if (kind) edition = await env.DB.prepare("SELECT * FROM editions WHERE kind=? ORDER BY id DESC LIMIT 1").bind(kind).first();
  else edition = await latestEdition(env);
  if (!edition) return j({ edition: null, items: [], latest: await status(env), note: "No scheduled edition has been published yet. Consult /api/activity for verified research findings and source checks." });
  const rows = await editionItems(env, edition.id);
  return j({ edition, items: rows, latest: await status(env) });
}
__name(feed, "feed");
async function article(req, env) {
  const id = decodeURIComponent(new URL(req.url).pathname.slice("/story/".length));
  if (!/^[A-Za-z0-9:_\-]{3,100}$/.test(id)) return new Response("Not found", { status: 404 });
  const item = await env.DB.prepare("SELECT i.* FROM edition_items i JOIN editions e ON e.id=i.edition_id WHERE i.candidate_id=? ORDER BY e.id DESC LIMIT 1").bind(id).first();
  if (!item) return new Response("This regulatory report has not passed publication verification.", { status: 404 });
  const news = (await env.DB.prepare("SELECT * FROM related_news WHERE candidate_id=? ORDER BY published_at DESC LIMIT 15").bind(id).all()).results || [];
  const title = html(item.title), canonical = base(env) + "/story/" + encodeURIComponent(id);
  const section = news.map((x) => `<li><a href="${html(x.url)}" rel="nofollow noopener noreferrer" target="_blank">${html(x.headline)}</a><small> ${html(x.publisher || "")} \xB7 ${html(x.relation)}${x.published_at ? " \xB7 " + html(x.published_at) : ""}</small></li>`).join("");
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "NewsArticle", headline: item.title, datePublished: item.action_date || void 0, mainEntityOfPage: canonical, publisher: { "@type": "Organization", name: "TickerDocket" }, isAccessibleForFree: true }).replace(/</g, "\\u003c");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | TickerDocket</title><meta name="description" content="Verified primary-source regulatory research for ${html(item.issuer)} (${html(item.ticker)})."><link rel="canonical" href="${html(canonical)}"><link rel="stylesheet" href="/styles.css"><script type="application/ld+json">${ld}<\/script></head><body><header class="top"><a class="brand" href="/"><span class="mark">TD</span>TICKER<strong>DOCKET</strong></a><nav><a href="/">Intelligence terminal</a></nav></header><main class="article-wrap"><p class="eyebrow">${html(item.agency || item.source)} \xB7 ${html(item.event_type || "regulatory action")}</p><h1>${title}</h1><p class="lede">Documented direct regulatory exposure: <b>${html(item.issuer)} (${html(item.ticker)})</b></p><div class="story article"><h2>What the official record establishes</h2><p>${html(item.impact_note)}</p><p><b>Agency action date:</b> ${html(item.action_date || "Not provided by source")}</p><h2>Primary evidence</h2><p><a target="_blank" rel="noreferrer noopener" href="${html(item.source_url)}">Official agency document \u2197</a></p><p><a target="_blank" rel="noreferrer noopener" href="${html(item.company_evidence_url)}">Public-company / ticker evidence \u2197</a></p><p><a target="_blank" rel="noreferrer noopener" href="${html(item.impact_evidence_url)}">Direct exposure evidence \u2197</a></p><h2>Related reporting</h2>${news.length ? `<ul>${section}</ul>` : "<p>No independently verified related news is currently attached.</p>"}<p class="muted">This story reports a documented company relationship\u2014not a prediction that the stock will rise or fall. Regulatory action dates can precede the date the public dataset becomes available.</p></div><p><a href="/">\u2190 Back to TickerDocket</a></p></main><footer><span>\xA9 TickerDocket</span><span>Driftless Digital Ventures</span></footer></body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", "X-Content-Type-Options": "nosniff", ...new URL(req.url).hostname.startsWith("tickerdocket-engine-v13-preview.") ? { "X-Robots-Tag": "noindex, nofollow" } : {} } });
}
__name(article, "article");
async function sitemap(env) {
  const items = (await env.DB.prepare("SELECT DISTINCT candidate_id FROM edition_items ORDER BY candidate_id LIMIT 3000").all()).results || [];
  const urls = [base(env), ...items.map((x) => base(env) + "/story/" + encodeURIComponent(x.candidate_id))];
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map((x) => `<url><loc>${html(x)}</loc></url>`).join("") + "</urlset>", { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
__name(sitemap, "sitemap");
async function admin(request, env) {
  if (!authorized(request, env.ADMIN_TOKEN)) return message(401, "Authorization required (ADMIN_TOKEN).");
  const u = new URL(request.url), path = u.pathname;
  if (request.method === "GET") {
    if (path === "/api/admin/status") return j(await status(env));
    if (path === "/api/admin/queue") {
      const state = u.searchParams.get("status") || "pending";
      if (!["pending", "verified", "rejected"].includes(state)) return message(400, "Bad status");
      const rows = (await env.DB.prepare("SELECT * FROM candidates WHERE status=? ORDER BY first_seen_at DESC LIMIT 250").bind(state).all()).results || [];
      return j({ candidates: rows });
    }
    if (path === "/api/admin/mappings") return j({ mappings: (await env.DB.prepare("SELECT * FROM company_mappings ORDER BY applicant_name LIMIT 300").all()).results || [] });
    if (path === "/api/admin/news") {
      const id = u.searchParams.get("id");
      if (!id) return message(400, "Missing id");
      return j({ news: (await env.DB.prepare("SELECT * FROM related_news WHERE candidate_id=? ORDER BY published_at DESC").bind(id).all()).results || [] });
    }
    if (path === "/api/admin/news-suggestions") {
      const id = u.searchParams.get("id");
      const candidate = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(id).first();
      if (!candidate || !candidate.issuer) return message(400, "This candidate requires a verified issuer before news discovery.");
      const term = '"' + candidate.issuer.replace(/["\\]/g, "").slice(0, 80) + '" ' + (candidate.agency === "FDA" ? "FDA" : "regulation");
      const target = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(term) + "&mode=artlist&format=json&maxrecords=25&sort=datedesc";
      try {
        const r = await fetch(target, { signal: AbortSignal.timeout(12e3) }), data = await r.json();
        return j({ automatically_verified: false, warning: "Suggestions must be reviewed for direct relevance, date and publication provenance before attaching.", articles: (data.articles || []).map((x) => ({ headline: x.title, url: x.url, published_at: x.seendate, publisher: x.domain })).filter((x) => validHttps(x.url)) });
      } catch (e) {
        return message(502, "News-discovery source unavailable: " + err(e));
      }
    }
    return message(404, "Unknown admin endpoint");
  }
  if (request.method !== "POST") return message(405, "Method not allowed");
  const b = await request.json().catch(() => ({}));
  if (path === "/api/admin/scan") {
    const source = ["federal", "fda", "all"].includes(b.source) ? b.source : "all";
    return j({ results: await scanSource(env, source) });
  }
  if (path === "/api/admin/publish") return j(await publish(env, b.kind, localTime()));
  if (path === "/api/admin/mappings") {
    const applicant = String(b.applicant || "").trim(), issuer = String(b.issuer || "").trim(), ticker = String(b.ticker || "").toUpperCase().trim();
    if (applicant.length < 3 || issuer.length < 3 || !/^([A-Z]{1,7}[.\-]?[A-Z]{0,3})$/.test(ticker) || !validHttps(b.issuer_evidence_url) || b.ownership_evidence_url && !validHttps(b.ownership_evidence_url)) return message(400, "Supply a valid exact FDA applicant, ticker, issuer and HTTPS issuer evidence; ownership evidence required for subsidiaries.");
    const applicantNorm = applicant.normalize("NFKD").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    await env.DB.prepare(`INSERT INTO company_mappings(applicant_norm,applicant_name,issuer,ticker,issuer_evidence_url,ownership_evidence_url,approved_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(applicant_norm) DO UPDATE SET issuer=excluded.issuer,ticker=excluded.ticker,issuer_evidence_url=excluded.issuer_evidence_url,ownership_evidence_url=excluded.ownership_evidence_url,approved_at=excluded.approved_at`).bind(applicantNorm, applicant, issuer, ticker, b.issuer_evidence_url, b.ownership_evidence_url || null, nowISO()).run();
    return j({ ok: true, applicant, ticker });
  }
  if (path === "/api/admin/review") {
    const id = String(b.id || ""), candidate = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(id).first();
    if (!candidate) return message(404, "Unknown candidate");
    if (b.action === "reject") {
      await env.DB.prepare("UPDATE candidates SET status='rejected',ticker=NULL,issuer=NULL,approval_method=?,approved_at=? WHERE id=?").bind("editor-rejected", nowISO(), id).run();
      return j({ ok: true });
    }
    if (b.action !== "approve") return message(400, "Action must be approve/reject");
    if (!/^[A-Z]{1,7}[.\-]?[A-Z]{0,3}$/.test(b.ticker || "") || !String(b.issuer || "").trim() || !validHttps(b.company_evidence_url) || !validHttps(b.impact_evidence_url) || String(b.impact_note || "").trim().length < 55) return message(400, "Approval requires verified ticker, issuer, HTTPS issuer evidence, HTTPS direct-impact evidence, and a substantive written exposure explanation (55+ characters).");
    await env.DB.prepare(`UPDATE candidates SET status='verified',ticker=?,issuer=?,company_evidence_url=?,impact_evidence_url=?,impact_note=?,approval_method='admin-reviewed',approved_at=? WHERE id=?`).bind(b.ticker, b.issuer, b.company_evidence_url, b.impact_evidence_url, b.impact_note, nowISO(), id).run();
    return j({ ok: true });
  }
  if (path === "/api/admin/news") {
    const candidate = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(b.id).first();
    if (!candidate || candidate.status !== "verified") return message(400, "Attach news only to a verified regulatory item.");
    if (!validHttps(b.url) || String(b.headline || "").length < 15 || !["direct", "background", "company_statement", "contrary_view"].includes(b.relation)) return message(400, "Headline, article HTTPS URL, and relationship classification required.");
    await env.DB.prepare("INSERT OR IGNORE INTO related_news(candidate_id,headline,publisher,url,published_at,relation,verified_at) VALUES(?,?,?,?,?,?,?)").bind(b.id, b.headline, b.publisher || null, b.url, b.published_at || null, b.relation, nowISO()).run();
    return j({ ok: true });
  }
  if (path === "/api/admin/test-email") {
    if (!emailReady(env)) return message(503, "Configure Resend, DNS, Turnstile and address settings first.");
    return j({ ready: true, message: "Test through the public double-opt-in flow, then use the morning edition. No test message was sent." });
  }
  if (path === "/api/admin/send-queue") return j(await flushMail(env, 10));
  return message(404, "Unknown admin endpoint");
}
__name(admin, "admin");
async function corporate(request, env) {
  if (env.CORPORATE_METRICS_ENABLED !== "true") return message(503, "Corporate dashboard pull endpoint not enabled.");
  if (!authorized(request, env.CORPORATE_METRICS_TOKEN)) return message(401, "Unauthorized.");
  const last = await latestEdition(env), subs = await env.DB.prepare("SELECT COUNT(*) n FROM subscribers WHERE status='active'").first();
  const delivered = await env.DB.prepare("SELECT COUNT(*) n FROM email_queue WHERE status='sent'").first();
  const issues = (await env.DB.prepare("SELECT source,started_at,status,error FROM sync_runs ORDER BY id DESC LIMIT 8").all()).results || [];
  return j({
    website: "tickerdocket.com",
    source: "tickerdocket-engine",
    as_of: nowISO(),
    latest_edition: last ? { date: last.local_date, kind: last.kind, published_at: last.published_at, count: last.qualifying_count } : null,
    subscribers: subs?.n || 0,
    emails_sent: delivered?.n || 0,
    run_health: issues,
    ga4_property_id: null,
    adsense_revenue: null,
    sponsorship_revenue: null,
    notice: "Analytics/revenue fields are intentionally null until connected to verified Google and billing APIs. This is a read-only private endpoint."
  });
}
__name(corporate, "corporate");
var worker_default = {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    try {
      if (p === "/api/status" && request.method === "GET") return j(await status(env));
      if (p === "/api/feed" && request.method === "GET") return feed(request, env);
      if (p === "/api/activity" && request.method === "GET") return j(await activity(env));
      if (p === "/api/public-config") return j({ turnstile_site_key: env.TURNSTILE_SITE_KEY || null, email_ready: emailReady(env) });
      if (p === "/api/subscribe" && request.method === "POST") return subscribe(request, env);
      if (p === "/api/confirm" && request.method === "GET") return confirm(request, env);
      if (p === "/api/unsubscribe" && ["GET", "POST"].includes(request.method)) return unsubscribe(request, env);
      if (p === "/api/unsubscribe-signed" && ["GET", "POST"].includes(request.method)) return unsubscribeSigned(request, env);
      if (p === "/api/corporate/metrics" && request.method === "GET") return corporate(request, env);
      if (p.startsWith("/api/admin/")) return admin(request, env);
      if (p.startsWith("/api/")) return message(404, "Unknown API endpoint");
      if (p.startsWith("/story/")) return article(request, env);
      if (p === "/sitemap.xml") return sitemap(env);
      const asset = await env.ASSETS.fetch(request);
      if (new URL(request.url).hostname.startsWith("tickerdocket-engine-v13-preview.")) {
        const headers = new Headers(asset.headers);
        headers.set("X-Robots-Tag", "noindex, nofollow");
        return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
      }
      return asset;
    } catch (e) {
      console.error("TickerDocket request error", err(e));
      return message(500, "Request failed. Please check Worker logs.");
    }
  },
  async scheduled(trigger, env, ctx) {
    const local = localTime(new Date(trigger.scheduledTime));
    const plan = schedulePlan(local);
    if (plan.publish) {
      ctx.waitUntil((async () => {
        try {
          await publish(env, plan.publish, local);
        } catch (e) {
          console.error("Scheduled edition failed", err(e));
        }
        try {
          await scanSource(env, "all", new Date(trigger.scheduledTime));
        } catch (e) {
          console.error("Post-edition refresh failed", err(e));
        }
      })());
    } else if (plan.scan) {
      ctx.waitUntil(scanSource(env, "all", new Date(trigger.scheduledTime)).catch((e) => console.error("Source refresh failed", err(e))));
    }
    if (plan.email) ctx.waitUntil(flushMail(env, 25).catch((e) => console.error("Morning email queue failed", err(e))));
  }
};
export {
  worker_default as default,
  publish,
  selectEditionCutoff,
  status
};
//# sourceMappingURL=worker.js.map
