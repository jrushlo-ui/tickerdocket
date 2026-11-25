import { trustedCollector,saveWireSnapshots,currentWireSnapshot } from "./wire-collector.mjs";
import homeTemplate from "./dist/index.html";
import adminTemplate from "./dist/admin.html";
import { ensurePipeline,recordDiscovery } from "./pipeline-store.mjs";
import { reviewPending } from "./review-queue.mjs";
import { EXPECTED_SOURCES,describeCoverage, editionOutcome, editionNotice } from "./edition-health.mjs";
import { evidenceFetcher } from "./source-evidence.mjs";
import { discoverRegulatoryLeads, reviewedLaunchItems } from "./regulatory-discovery.mjs";
import { impactCategory, morningSubject, renderMorningBrief, selectMorningItems } from "./morning-brief.mjs";
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
function expectsFreshSourceCheck(local) {
  return local.hour >= 6 && (local.hour < 22 || local.hour === 22 && local.minute < 15);
}
__name(expectsFreshSourceCheck, "expectsFreshSourceCheck");
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
  ["MASIMO CORPORATION", "MASI", "Masimo Corporation", "direct"],
  ["B R A H M S GMBH PART OF THERMO FISHER SCIENTIFIC", "TMO", "Thermo Fisher Scientific Inc.", "parent-in-name"],
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
  const start = fdaRangeStart(now, 60), end = fdaRangeEnd(now);
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
  return { kind, count: results.length, updated_at: metaDate, decisions: results.map((r) => normalizeFDADecision(r, kind)).filter(Boolean),
    dispositions: results.map(r=>[r.k_number || r.pma_number || null,r.supplement_number || null,r.decision_code || null,
      normalizeFDADecision(r,kind) ? 'qualifying decision' : 'decision code, applicant, date or identifier did not qualify']) };
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
var FEDERAL_MARKET_AGENCIES = [
  "SECURITIES AND EXCHANGE COMMISSION",
  "FEDERAL TRADE COMMISSION",
  "FOOD AND DRUG ADMINISTRATION",
  "DEPARTMENT OF JUSTICE",
  "ENVIRONMENTAL PROTECTION AGENCY",
  "FEDERAL COMMUNICATIONS COMMISSION",
  "FEDERAL ENERGY REGULATORY COMMISSION",
  "NATIONAL HIGHWAY TRAFFIC SAFETY ADMINISTRATION"
];
var FEDERAL_COMPANY_ALIASES = [
  { terms: ["CONOCOPHILLIPS CO", "CONOCOPHILLIPS COMPANY"], ticker: "COP", issuer: "ConocoPhillips", cik: "1163165" },
  { terms: ["CBOE BYX EXCHANGE", "CBOE BZX EXCHANGE", "CBOE EDGA EXCHANGE", "CBOE EDGX EXCHANGE", "CBOE EXCHANGE", "C2 OPTIONS EXCHANGE"], ticker: "CBOE", issuer: "Cboe Global Markets, Inc.", cik: "1374310" },
  { terms: ["ICE CLEAR CREDIT", "ICE CLEAR EUROPE", "ICE FUTURES US", "ICE FUTURES EUROPE"], ticker: "ICE", issuer: "Intercontinental Exchange, Inc.", cik: "1571949" },
  { terms: ["GULFSTREAM AEROSPACE CORPORATION", "GULFSTREAM AEROSPACE CORP"], ticker: "GD", issuer: "General Dynamics Corporation", cik: "40533" },
  { terms: ["NASDAQ ISE", "NASDAQ PHLX", "NASDAQ TEXAS", "THE NASDAQ STOCK MARKET"], ticker: "NDAQ", issuer: "Nasdaq, Inc.", cik: "1120193" },
  { terms: ["UBS ASSET MANAGEMENT"], ticker: "UBS", issuer: "UBS Group AG", cik: "1610520" }
];
function matchFederalIssuer(item) {
  const title = norm(item?.title);
  const agency = norm(item?.agency);
  if (agency.includes("SECURITIES AND EXCHANGE COMMISSION") && /SELF REGULATORY ORGANIZATIONS|PROPOSED RULE CHANGES|DEREGISTRATION UNDER THE INVESTMENT COMPANY ACT|EXEMPTION APPLICATION|^APPLICATION /.test(title)) return null;
  if (agency.includes("FEDERAL AVIATION ADMINISTRATION") && /^SPECIAL CONDITIONS\b/.test(title)) return null;
  const match = FEDERAL_COMPANY_ALIASES.find((entry) => entry.terms.some((term) => title.includes(norm(term))));
  return match ? {
    ticker: match.ticker,
    issuer: match.issuer,
    issuer_evidence_url: `https://www.sec.gov/edgar/browse/?CIK=${match.cik}`,
    method: "federal-title-sec-issuer"
  } : null;
}
__name(matchFederalIssuer, "matchFederalIssuer");
function federalNeedsReview(item) {
  const title = norm(item?.title);
  const agency = norm(item?.agency);
  const namesPublicCompany = COMPANY_ALIASES.some(([alias, , issuer]) => title.includes(norm(alias)) || title.includes(norm(issuer)));
  const namesBusiness = /\b(CORPORATION|CORP|INCORPORATED|INC|LIMITED|LTD|PLC|LLC|COMPANY|HOLDINGS)\b/.test(title);
  const marketAgency = FEDERAL_MARKET_AGENCIES.some((name) => agency.includes(name));
  return namesPublicCompany || marketAgency && namesBusiness;
}
__name(federalNeedsReview, "federalNeedsReview");
function legalName(s) {
  return norm(s).replace(/^THE\s+/, "").replace(/\b(CORPORATION|CORP|INCORPORATED|INC|LIMITED|LTD|PLC|CO|COMPANY)\b/g, "").replace(/\s+/g, " ").trim();
}
__name(legalName, "legalName");
async function exactSECApplicants(applicants, fetchFn = fetch) {
  if (!applicants.length) return /* @__PURE__ */ new Map();
  try {
    const r = await fetchFn(SEC, { headers: { "Accept": "application/json", "User-Agent": "TickerDocket research editorial research@tickerdocket.com" }, signal: AbortSignal.timeout(12e3) });
    if (!r.ok) throw Error("SEC issuer reference unavailable");
    const rows = await r.json(), m = /* @__PURE__ */ new Map(), headers = rows.fields || ["cik", "name", "ticker", "exchange"];
    const byTicker = /* @__PURE__ */ new Map(), byLegalName = /* @__PURE__ */ new Map();
    for (const raw of rows.data || []) {
      const row = Object.fromEntries(headers.map((h, i) => [h, raw[i]]));
      const name = norm(row.name);
      const ticker = String(row.ticker || "").trim().toUpperCase();
      if (!name || !/^[A-Z.\-]{1,12}$/.test(ticker)) continue;
      const exchange = String(row.exchange || "").toUpperCase();
      if (!/NASDAQ|NYSE|AMEX|CBOE/.test(exchange)) continue;
      byTicker.set(ticker, row);
      const legal = legalName(name);
      if (legal) byLegalName.set(legal, byLegalName.has(legal) ? null : row);
      if (applicants.includes(name)) m.set(name, { ticker, issuer: row.name, issuer_evidence_url: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(row.cik)}`, method: "sec-exact" });
    }
    for (const name of applicants) {
      if (m.has(name)) continue;
      const legalRow = byLegalName.get(legalName(name));
      if (legalRow) {
        m.set(name, { ticker: String(legalRow.ticker).toUpperCase(), issuer: legalRow.name, issuer_evidence_url: "https://www.sec.gov/edgar/browse/?CIK=" + encodeURIComponent(legalRow.cik), method: "sec-legal-name" });
        continue;
      }
      const alias = matchPublicIssuer(name);
      if (!alias || !["direct", "parent-in-name"].includes(alias.method)) continue;
      const row = byTicker.get(alias.ticker);
      if (!row || alias.method === "direct" && legalName(name) !== legalName(row.name)) continue;
      m.set(name, { ticker: alias.ticker, issuer: row.name, issuer_evidence_url: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(row.cik)}`, method: alias.method === "parent-in-name" ? "sec-parent-named-by-applicant" : "sec-direct-legal-alias" });
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
  const usable = records.filter((item) => item && validHttps(item.source_url));
  if (!usable.length) return 0;
  const lookups = [];
  for (let i = 0; i < usable.length; i += 90) {
    const ids = usable.slice(i, i + 90).map((item) => item.id);
    lookups.push(env.DB.prepare(`SELECT id,status,approval_method,title,source_url,action_date FROM candidates WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids));
  }
  const found = await env.DB.batch(lookups);
  const existing = new Map(found.flatMap(result=>(result.results||[]).map(row=>[row.id,row])));
  for (let i = 0; i < usable.length; i += 120) {
    const b = [];
    const chunk = usable.slice(i, i + 120);
    for (const item of chunk) {
      const federalMapped = String(item.source).startsWith("Federal Register") ? matchFederalIssuer(item) : null;
      const mapped = manualMap.get(norm(item.applicant)) || secMap.get(norm(item.applicant)) || federalMapped;
      const approvedFDA = !!mapped && String(item.source).startsWith("FDA") && // Subsidiary mappings need a documented issuer-to-applicant ownership link.
      (!manualMap.has(norm(item.applicant)) || norm(item.applicant) === norm(mapped.issuer) || validHttps(mapped.ownership_evidence_url));
      const approvedFederal = !!federalMapped;
      const approved = approvedFDA || approvedFederal;
      const possibleFederal = /proposed rule|notice of proposed rulemaking/i.test(item.event_type || "") &&
        /medicare|medicaid|reimbursement|tariff|spectrum|emission|permit|antitrust/i.test(item.title);
      if (!approved && String(item.source).startsWith("Federal Register") && !possibleFederal && !federalNeedsReview(item)) continue;
      const autoExcluded = String(item.source).startsWith("Federal Register") && !possibleFederal && !federalNeedsReview(item);
      const prior = existing.get(item.id);
      const canPromote = prior && (prior.status==='pending' && (approved || autoExcluded) ||
        prior.status==='rejected' && prior.approval_method?.startsWith('auto-excluded-') && approved);
      if (prior && !canPromote && prior.title===item.title && prior.source_url===item.source_url && prior.action_date===item.action_date) continue;
      const relation = mapped?.ownership_evidence_url || mapped?.issuer_evidence_url || null;
      const statement = approvedFDA ? `FDA record names ${item.applicant} as applicant. ${mapped.issuer} (${mapped.ticker}) is linked through the documented applicant/issuer identity or ownership evidence. This is direct device-regulatory exposure; commercial materiality is unknown.` : approvedFederal ? `Federal Register public-inspection title explicitly names an entity mapped to ${mapped.issuer} (${mapped.ticker}); the SEC issuer record supports the listed-company identity. The regulatory notice is direct company exposure, but financial materiality is not established.` : null;
      b.push(env.DB.prepare(`INSERT INTO candidates (id,source,source_url,title,agency,event_type,action_date,applicant,device_code,first_seen_local,first_seen_at,last_seen_at,status,ticker,issuer,company_evidence_url,impact_evidence_url,impact_note,approval_method,approved_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,source_url=excluded.source_url,
   title=excluded.title,action_date=excluded.action_date,
   status=CASE WHEN candidates.status='pending' AND excluded.status IN ('verified','rejected') THEN excluded.status WHEN candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%' AND excluded.status='verified' THEN 'verified' ELSE candidates.status END,
   ticker=CASE WHEN (candidates.status='pending' OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%')) AND excluded.status='verified' THEN excluded.ticker ELSE candidates.ticker END,
   issuer=CASE WHEN (candidates.status='pending' OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%')) AND excluded.status='verified' THEN excluded.issuer ELSE candidates.issuer END,
   company_evidence_url=CASE WHEN (candidates.status='pending' OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%')) AND excluded.status='verified' THEN excluded.company_evidence_url ELSE candidates.company_evidence_url END,
   impact_evidence_url=CASE WHEN (candidates.status='pending' OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%')) AND excluded.status='verified' THEN excluded.impact_evidence_url ELSE candidates.impact_evidence_url END,
   impact_note=CASE WHEN (candidates.status='pending' OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%')) AND excluded.status='verified' THEN excluded.impact_note ELSE candidates.impact_note END,
   approval_method=CASE WHEN candidates.status='pending' AND excluded.status IN ('verified','rejected') THEN excluded.approval_method WHEN candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%' AND excluded.status='verified' THEN excluded.approval_method ELSE candidates.approval_method END,
   approved_at=CASE WHEN candidates.status='pending' AND excluded.status IN ('verified','rejected') THEN excluded.approved_at WHEN candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%' AND excluded.status='verified' THEN excluded.approved_at ELSE candidates.approved_at END
   WHERE candidates.source_url IS NOT excluded.source_url
      OR candidates.title IS NOT excluded.title
      OR candidates.action_date IS NOT excluded.action_date
      OR (candidates.status='pending' AND excluded.status IN ('verified','rejected'))
      OR (candidates.status='rejected' AND candidates.approval_method LIKE 'auto-excluded-%' AND excluded.status='verified')`).bind(item.id, item.source, item.source_url, item.title, item.agency, item.event_type, item.action_date, item.applicant, item.device_code, day, nowISO(), nowISO(), approved ? "verified" : autoExcluded ? "rejected" : "pending", approved ? mapped.ticker : null, approved ? mapped.issuer : null, approved ? relation : null, approved ? item.source_url : null, statement, approved ? mapped.method || "admin-verified-mapping" : autoExcluded ? "auto-excluded-no-public-company" : null, approved || autoExcluded ? nowISO() : null));
      if (!prior) {
        existing.set(item.id,item);
        inserted++;
      }
    }
    if (b.length) await env.DB.batch(b);
  }
  return inserted;
}
__name(saveBatch, "saveBatch");
async function triagePendingFederal(env) {
  const rows = (await env.DB.prepare("SELECT id,title,agency,event_type FROM candidates WHERE status='pending' AND source='Federal Register public inspection' LIMIT 1000").all()).results || [];
  const reject = rows.filter((row) => !federalNeedsReview(row) &&
    !(/proposed rule|notice of proposed rulemaking/i.test(row.event_type || "") &&
      /medicare|medicaid|reimbursement|tariff|spectrum|emission|permit|antitrust/i.test(row.title)));
  for (let i = 0; i < reject.length; i += 50) {
    await env.DB.batch(reject.slice(i, i + 50).map((row) => env.DB.prepare("UPDATE candidates SET status='rejected',approval_method='auto-excluded-no-public-company',approved_at=? WHERE id=? AND status='pending'").bind(nowISO(), row.id)));
  }
  return { reviewed: rows.length, excluded: reject.length, retained_for_review: rows.length - reject.length };
}
__name(triagePendingFederal, "triagePendingFederal");
async function scanDisclosures(env, at, day, fetcher = fetch, options = {}) {
  await ensurePipeline(env.DB);
  const start = nowISO();
  const reviewedInsert = env.DB.prepare(`INSERT INTO candidates
    (id,source,source_url,title,agency,event_type,action_date,first_seen_local,first_seen_at,last_seen_at,status,
     ticker,issuer,company_evidence_url,impact_evidence_url,impact_note,approval_method,approved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,event_type=excluded.event_type,
      agency=excluded.agency,status=excluded.status,ticker=excluded.ticker,issuer=excluded.issuer,
      company_evidence_url=excluded.company_evidence_url,impact_evidence_url=excluded.impact_evidence_url,
      impact_note=excluded.impact_note,approval_method=excluded.approval_method,approved_at=excluded.approved_at
    WHERE candidates.status='pending'`);
  const reviewedStatements = [];
  for (const item of reviewedLaunchItems) {
    const age = Date.parse(day) - Date.parse(item.action_date);
    if (age < 0 || age > 7 * 86400000 || item.reviewed_at && Date.parse(item.reviewed_at) > at.getTime()) continue;
    reviewedStatements.push(reviewedInsert.bind(item.id, item.source, item.source_url, item.title, item.agency, item.event_type,
      item.action_date, day, start, start, "verified", item.ticker, item.issuer, item.company_evidence_url,
      item.impact_evidence_url || item.source_url, item.impact_note, "editor-reviewed", start));
  }
  if (reviewedStatements.length) await env.DB.batch(reviewedStatements);
  const stored = (await env.DB.prepare("SELECT key,value FROM pipeline_state WHERE key LIKE 'SEC %'").all()).results || [];
  const states = Object.fromEntries(stored.map(row => [row.key,JSON.parse(row.value)]));
  const feeds = await discoverRegulatoryLeads(at.getTime(),fetcher,states,{...options,snapshotReader:(feed,time)=>currentWireSnapshot(env.DB,feed,time)});
  let completed=0;
  for (const feed of feeds) {
    let added = 0;
    try {
      const writes = [];
      const rows = await Promise.all(feed.records.map(async item => ({
        ...item,id:'lead:'+await digest(item.source_url),
      })));
      for (let i=0;i<rows.length;i+=150) {
        const saved = await env.DB.prepare(`INSERT OR IGNORE INTO candidates
          (id,source,source_url,title,agency,event_type,action_date,first_seen_local,first_seen_at,last_seen_at,status)
          SELECT value->>'id',value->>'source',value->>'source_url',value->>'title',value->>'agency','Discovered lead',
          value->>'action_date',?,?,?,'pending' FROM json_each(?)`)
          .bind(day,start,start,JSON.stringify(rows.slice(i,i+150).filter(item=>!reviewedLaunchItems.some(r=>r.source_url===item.source_url)))).run();
        added += saved.meta?.changes || 0;
      }
      const dispositions = {};
      for (const [, ,reason] of feed.decisions) dispositions[reason]=(dispositions[reason]||0)+1;
      writes.push(recordDiscovery(env.DB,feed.source,start,{endpoints:feed.attempts,pages:feed.pages,
        raw_entries:feed.decisions.length,accepted:rows.length,dispositions,entries:feed.decisions,
        coverage_error:feed.error || feed.coverage_error || null}));
      if (feed.next) {
        const previous=stored.find(row=>row.key===feed.source)?.value || null;
        writes.push(env.DB.prepare(`INSERT INTO pipeline_state(key,value) VALUES(?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE pipeline_state.value IS ?`)
          .bind(feed.source,JSON.stringify(feed.next),previous));
      }
      writes.push(env.DB.prepare("INSERT INTO sync_runs(source,started_at,ended_at,status,seen_count,inserted_count,error) VALUES(?,?,?,?,?,?,?)")
        .bind(feed.source,start,nowISO(),feed.error ? "error" : feed.coverage_error ? "partial" : "ok",rows.length,added,feed.error || feed.coverage_error || null));
      await env.DB.batch(writes);
      if (!feed.error) completed++;
    } catch (error) {
      await logRun(env, feed.source, start, "error", feed.records.length, added, err(error));
    }
  }
  return { sources: feeds.length, available: completed };
}
async function scanSource(env, source = "all", at = /* @__PURE__ */ new Date(), capture = false) {
  await ensurePipeline(env.DB);
  const evidence = capture ? evidenceFetcher(at) : null;
  const upstream = evidence?.fetch || fetch;
  let reference;
  const fetcher = async (url,options) => {
    if (String(url) !== SEC) return upstream(url,options);
    reference ||= upstream(url,options).then(async r=>({body:await r.text(),status:r.status}));
    const result=await reference;
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json'}});
  };
  const day = localTime(at).day, results = {};
  const manualMap = await mappings(env);
  const disclosures = source === "all" ? scanDisclosures(env, at, day, fetcher).catch((error) => ({ error: err(error) })) : null;
  if (source === "all" || source === "federal") {
    const start = nowISO();
    let count = 0;
    try {
      const r = await fetcher(REGISTER, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(23e3) });
      const data = await readJSON(r);
      if (!Array.isArray(data.results)) throw Error("Invalid Federal Register schema");
      const rows = data.results.map(fdDoc).filter(Boolean);
      count = rows.length;
      const added = await saveBatch(env, rows, day, manualMap, /* @__PURE__ */ new Map());
      const triage = await triagePendingFederal(env);
      const invalid = data.results.length-count;
      await recordDiscovery(env.DB,'federal',start,{raw_entries:data.results.length,invalid,entries:data.results.map(doc=>{
        const row=fdDoc(doc);
        return [doc.document_number || null,!row ? 'invalid document number' : matchFederalIssuer(row) ? 'named issuer' :
          federalNeedsReview(row) || /proposed rule/i.test(row.event_type) && /medicare|medicaid|reimbursement|tariff|spectrum|emission|permit|antitrust/i.test(row.title) ? 'candidate' : 'no identified issuer or relevant proposal'];
      })}).run();
      await logRun(env, "federal", start, invalid ? "partial" : "ok", count, added,invalid ? invalid+' malformed records' : null);
      results.federal = { ok: true, count, inserted: added, triage };
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
        const feed2 = await fetchFDAFeed(kind, at, fetcher);
        count = feed2.decisions.length;
        const sec = await exactSECApplicants([...new Set(feed2.decisions.map((d) => norm(d.applicant)).filter(Boolean))], fetcher);
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
        await recordDiscovery(env.DB,kind,start,{raw_entries:feed2.count,accepted:count,entries:feed2.dispositions}).run();
        const secError = sec.verification_error || null;
        await logRun(env, kind, start, secError ? "partial" : "ok", count, added, secError);
        results[kind] = { ok: !secError, count, saved: added, fda_data_updated_at: feed2.updated_at, issuer_verified: !secError, error: secError };
      } catch (e) {
        await logRun(env, kind, start, "error", count, 0, err(e));
        results[kind] = { ok: false, error: err(e) };
      }
    }
  }
  if (disclosures) results.disclosures = await disclosures;
  if (source==='all') {
    await classifyUnmatched(env);
    try { results.review=await reviewPending(env.DB,new Date(),fetcher,5); }
    catch(error) { results.review={error:err(error)}; await logRun(env,'document review',nowISO(),'error',0,0,err(error)); }
  }
  if (evidence) {
    try { results.evidence = await evidence.save(env.DB); }
    catch (error) { results.evidence = {error:err(error)}; await logRun(env, "source evidence", nowISO(), "error", 0, 0, err(error)); }
  }
  return results;
}
__name(scanSource, "scanSource");

// src/activity.js
async function collectionHealth(env) {
  const at=nowISO(),DB=env.DB;
  const coverage=await sourceCoverageDetails(env,at,liveFreshnessFrom(at));
  const table=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_attempts'").first();
  let operations=[],review=[],capture=null,logs=[];
  if (table) {
    const result=await DB.batch([
      DB.prepare(`SELECT source,started_at,json_extract(details,'$.raw_entries') raw_entries,
        json_extract(details,'$.pages') pages,json_extract(details,'$.accepted') accepted,
        json_extract(details,'$.coverage_error') error,json_extract(details,'$.endpoints') endpoints FROM discovery_checks
        WHERE id IN (SELECT MAX(id) FROM discovery_checks GROUP BY source)`),
      DB.prepare(`SELECT CASE WHEN c.status='pending' THEN COALESCE(a.outcome,'awaiting_review') WHEN a.outcome IN ('verified','duplicate','excluded') THEN a.outcome ELSE 'resolved' END outcome,
        COUNT(*) count FROM candidates c LEFT JOIN review_attempts a ON a.candidate_id=c.id
        WHERE c.status='pending' OR a.outcome IS NOT NULL GROUP BY 1`),
      DB.prepare("SELECT source,status,ended_at,error FROM sync_runs WHERE source IN ('document review','source evidence','pipeline service','edition publication') ORDER BY id DESC LIMIT 6"),
      DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_snapshots'"),
    ]);
    operations=result[0].results||[];review=result[1].results||[];logs=result[2].results||[];
    if (result[3].results?.length) capture=await DB.prepare(`SELECT scan_id,MAX(scheduled_at) scheduled_at,COUNT(*) requests,
      SUM(CASE WHEN capture_error IS NOT NULL THEN 1 ELSE 0 END) capture_gaps FROM source_snapshots
      WHERE scan_id=(SELECT scan_id FROM source_snapshots ORDER BY id DESC LIMIT 1) GROUP BY scan_id`).first();
  }
  return {as_of:at,expected:EXPECTED_SOURCES.length,coverage:coverage.status,checks:coverage.checks.map(check=>{
    const op=operations.find(x=>x.source===check.source);
    return {...check,raw_entries:op?.raw_entries??null,pages:op?.pages??null,accepted:op?.accepted??null,
      endpoint_attempts:op?.endpoints ? JSON.parse(op.endpoints) : []};
  }),reviews:review,latest_evidence:capture,operations:logs,within_monitoring_hours:expectsFreshSourceCheck(localTime())};
}
async function coveragePage(env) {
  const data=await collectionHealth(env);
  const ct=v=> v ? new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v)) : 'Awaiting first check';
  const names=x=>x==='Company releases'?'GlobeNewswire Biotechnology':x==='federal'?'Federal Register public inspection':x==='510k'?'FDA 510(k)':x==='pma'?'FDA PMA':x;
  const rows=data.checks.map(c=>'<tr><th scope="row">'+html(names(c.source))+'</th><td>'+html(c.status)+'</td><td>'+html(ct(c.ended_at))+'</td><td>'+html(c.error || (c.endpoint_attempts||[]).find(x=>x.via)?.via || '—')+'</td></tr>').join('');
  const pending=data.reviews.filter(x=>['awaiting_review','editor_review','retry','ownership_review','policy_review'].includes(x.outcome));
  const labels={awaiting_review:'Awaiting review',editor_review:'Needs an editor',retry:'Scheduled for another attempt',ownership_review:'Needs issuer or ownership evidence',policy_review:'Needs company exposure evidence'};
  const counts=pending.map(x=>'<li>'+html(labels[x.outcome])+': '+Number(x.count)+'</li>').join('');
  return editorialPage('Source coverage','Collection results and review status for the monitored sources.',
    '<h2>Latest checks</h2><p>'+data.expected+' monitored sources. Times are Central. Scheduled collection runs every half hour from 6:00 a.m. to 9:00 p.m., with additional checks before editions.</p>'+
    '<div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>Result</th><th>Last check</th><th>Detail</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    (counts?'<h2>Review queue</h2><ul>'+counts+'</ul>':'')+
    (data.latest_evidence?'<p>Last saved source evidence: '+html(ct(data.latest_evidence.scheduled_at))+' · '+Number(data.latest_evidence.requests)+' requests · '+Number(data.latest_evidence.capture_gaps)+' capture gaps.</p>':''),'coverage');
}
async function activity(env) {
  const runs = (await env.DB.prepare(`SELECT source,started_at,ended_at,status,seen_count,inserted_count,error
    FROM sync_runs WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY source) ORDER BY source`).all()).results || [];
  const edition = await env.DB.prepare("SELECT published_at,kind,local_date FROM editions ORDER BY id DESC LIMIT 1").first();
  const totals = await env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS excluded
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
  const refreshWindowActive = expectsFreshSourceCheck(localTime());
  const checkedAt=nowISO();
  const checks=describeCoverage(runs,checkedAt,liveFreshnessFrom(checkedAt)).checks;
  const healthy=checks.every(x=>x.status==='ok');
  return {
    as_of: nowISO(),
    last_scan_at: lastScan,
    collection_started: runs.length > 0,
    refresh_schedule: { from: "06:00", to: "21:00", every_minutes: 30, time_zone: "America/Chicago" },
    last_published_edition: edition,
    source_healthy: healthy,
    refresh_window_active: refreshWindowActive,
    new_since_edition: newFindings,
    pending_by_source: pendingBySource,
    source_checks: runs,
    expected_source_count: EXPECTED_SOURCES.length,
    coverage: checks,
    counts: { collected: totals?.total || 0, verified: totals?.verified || 0, pending_review: totals?.pending || 0, automatically_excluded: totals?.excluded || 0 },
    verified_findings: items,
    note: "New verified records appear between half-hour scans without rewriting immutable editions. Verified research records are not an edition. FDA data publication may lag its underlying decision date; stock-price effects are not established."
  };
}
__name(activity, "activity");

// src/email.js
var MAIL = "https://api.resend.com/emails";
var emailReady = /* @__PURE__ */ __name((env) => Boolean((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.EMAIL_POSTAL_ADDRESS && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && env.EMAIL_LINK_SECRET), "emailReady");
async function mail(env, to, subject, body, headers = {}) {
  const useBrevo = Boolean(env.BREVO_API_KEY);
  const response = await fetch(useBrevo ? "https://api.brevo.com/v3/smtp/email" : MAIL, { method: "POST", headers: useBrevo ? { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" } : { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(useBrevo ? { sender: { name: env.SENDER_NAME || "TickerDocket", email: env.EMAIL_FROM || "newsletter@brief.tickerdocket.com" }, to: [{ email: to }], subject, htmlContent: body, ...(Object.keys(headers).length ? { headers } : {}), replyTo: { email: "newsletter@tickerdocket.com" } } : { from: `${env.SENDER_NAME || "TickerDocket"} <${env.EMAIL_FROM || "briefing@tickerdocket.com"}`, to: [to], subject, html: body, headers }) });
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
async function morningItems(env, editionId) {
  const rows = (await env.DB.prepare(
    "SELECT title,ticker,issuer,source,source_url,candidate_id,action_date,agency,event_type,impact_note,company_evidence_url,impact_evidence_url FROM edition_items WHERE edition_id=? ORDER BY action_date DESC,candidate_id"
  ).bind(editionId).all()).results || [];
  return selectMorningItems(rows);
}
async function deliverMorningBrief(env, subscriber, edition, items, test = false) {
  const unsubscribe = await makeUnsubscribeLink(env, subscriber.subscriber_id);
  const body = renderMorningBrief({ edition, items, unsubscribe, postalAddress: env.EMAIL_POSTAL_ADDRESS, test });
  const headers = test ? {} : { "List-Unsubscribe": "<" + unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  return mail(env, subscriber.email, morningSubject(edition.local_date, test), body, headers);
}
const morningQueueJoins = 'FROM email_queue q JOIN subscribers s ON s.id=q.subscriber_id JOIN editions e ON e.id=q.edition_id';
const deliverableMorningMail = "q.status IN ('queued','failed') AND q.attempts<3 AND s.status='active' AND e.kind='morning' AND e.local_date=?";
async function flushMail(env, limit = 20, day = localTime().day) {
  if (!emailReady(env)) return { sent: 0, skipped: true, reason: "Email not configured" };
  const rows = (await env.DB.prepare(
    'SELECT q.id,q.edition_id,q.subscriber_id,s.email,e.local_date,e.scan_status '+morningQueueJoins+' WHERE '+deliverableMorningMail+' ORDER BY q.id ASC LIMIT ?'
  ).bind(day, limit).all()).results || [];
  const editions = new Map();
  let sent = 0, failed = 0, cancelled = 0;
  for (const q of rows) {
    try {
      if (!editions.has(q.edition_id)) editions.set(q.edition_id, await morningItems(env, q.edition_id));
      const items = editions.get(q.edition_id);
      if (!items.length) {
        await env.DB.prepare("UPDATE email_queue SET status='cancelled',error=? WHERE id=?").bind("No qualifying developments", q.id).run();
        cancelled++;
        continue;
      }
      const provider = await deliverMorningBrief(env, q, q, items);
      await env.DB.prepare("UPDATE email_queue SET status=?,attempts=attempts+1,last_attempt_at=?,sent_at=?,provider_id=?,error=NULL WHERE id=?").bind("sent", nowISO(), nowISO(), provider, q.id).run();
      sent++;
    } catch (error) {
      await env.DB.prepare("UPDATE email_queue SET status=?,attempts=attempts+1,last_attempt_at=?,error=? WHERE id=?").bind("failed", nowISO(), err(error), q.id).run();
      failed++;
    }
  }
  return { sent, failed, cancelled, processed: rows.length };
}
async function mac(env, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.EMAIL_LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  const rows = (await env.DB.prepare("SELECT * FROM edition_items WHERE edition_id=? ORDER BY action_date DESC,ticker ASC,candidate_id").bind(id).all()).results || [];
  return rows.map((item) => ({ ...item, impact_category: impactCategory(item) }));
}
__name(editionItems, "editionItems");
function selectEditionCutoff(previous, now = /* @__PURE__ */ new Date()) {
  return previous?.published_at || new Date(now.getTime() - 72 * 3600 * 1e3).toISOString();
}
__name(selectEditionCutoff, "selectEditionCutoff");
function liveFreshnessFrom(at) {
  const time=new Date(at),local=localTime(time);
  if (expectsFreshSourceCheck(local)) return time.getTime()-75*60000;
  // Resolve the previous closing scan in Chicago, including overnight DST changes.
  const clock=new Date(time); clock.setUTCMinutes(0,0,0);
  for(let i=0;i<14;i++) {
    if(localTime(clock).hour===21) return clock.getTime()-75*60000;
    clock.setUTCHours(clock.getUTCHours()-1);
  }
  return time.getTime()-75*60000;
}
async function sourceCoverageDetails(env, at = nowISO(), freshnessFrom) {
  const rows = (await env.DB.prepare(`SELECT s.* FROM sync_runs s
    WHERE s.id IN (SELECT MAX(id) FROM sync_runs WHERE ended_at <= ? GROUP BY source)`)
    .bind(at).all()).results || [];
  return describeCoverage(rows, at, freshnessFrom);
}
async function sourceCoverage(env, at = nowISO()) {
  return (await sourceCoverageDetails(env, at)).status;
}
__name(sourceCoverage, "sourceCoverage");
async function publish(env, kind, local, scanResult = null) {
  if (!["morning", "closing"].includes(kind)) throw Error("Invalid edition type");
  const exists = await latestEdition(env, local.day, kind);
  if (exists) return { already_published: true, edition_id: exists.id, items: exists.qualifying_count };
  const at = nowISO();
  const previous = kind === "morning"
    ? await env.DB.prepare("SELECT * FROM editions WHERE kind='morning' AND local_date<? ORDER BY local_date DESC LIMIT 1").bind(local.day).first()
    : await latestEdition(env);
  const cutoff = selectEditionCutoff(previous, new Date(at));
  const coverage = await sourceCoverageDetails(env, at);
  const health = coverage.status;
  const pending = await env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(first_seen_at>?),0) recent FROM candidates WHERE status='pending' AND first_seen_at <= ?").bind(cutoff,at).first();
  const pendingCount = pending?.n || 0;
  const selected = (await env.DB.prepare(`SELECT * FROM candidates WHERE status='verified'
   AND first_seen_at <= ? AND (approved_at IS NULL OR approved_at <= ?)
   AND (first_seen_at > ? OR approved_at > ?)
   ORDER BY COALESCE(approved_at,first_seen_at) DESC,id ASC`).bind(at, at, cutoff, cutoff).all()).results || [];
  const qualified = selected.filter(verifyPublicStory);
  const publicationId=crypto.randomUUID();
  const notes=JSON.stringify({summary:"Verified regulatory developments and documented public-company exposure.",cutoff,
    source_coverage:coverage,pending_review_count:pendingCount,window_pending_count:pending?.recent || 0,source_evidence:scanResult?.evidence || {status:"not_captured"},
    review:scanResult?.review || null,publication_id:publicationId});
  const writes=[env.DB.prepare("INSERT OR IGNORE INTO editions(local_date,kind,published_at,status,scan_status,qualifying_count,notes) VALUES(?,?,?,?,?,?,?)")
    .bind(local.day,kind,at,editionOutcome(qualified.length,health,pending?.recent || 0),health,qualified.length,notes)];
  for (let i=0;i<qualified.length;i+=40) {
    writes.push(env.DB.prepare(`INSERT INTO edition_items
      (edition_id,candidate_id,title,ticker,issuer,source,source_url,action_date,agency,event_type,impact_note,company_evidence_url,impact_evidence_url)
      SELECT e.id,j.value->>'id',j.value->>'title',j.value->>'ticker',j.value->>'issuer',j.value->>'source',j.value->>'source_url',
        j.value->>'action_date',j.value->>'agency',j.value->>'event_type',j.value->>'impact_note',j.value->>'company_evidence_url',j.value->>'impact_evidence_url'
      FROM editions e,json_each(?) j WHERE e.local_date=? AND e.kind=? AND json_extract(e.notes,'$.publication_id')=?`)
      .bind(JSON.stringify(qualified.slice(i,i+40)),local.day,kind,publicationId));
  }
  if (kind==="morning" && selectMorningItems(qualified).length) {
    writes.push(env.DB.prepare(`INSERT OR IGNORE INTO email_queue(edition_id,subscriber_id)
      SELECT e.id,s.id FROM editions e,subscribers s WHERE e.local_date=? AND e.kind=? AND s.status='active'
      AND json_extract(e.notes,'$.publication_id')=?`).bind(local.day,kind,publicationId));
  }
  const saved=await env.DB.batch(writes);
  const edition=await latestEdition(env,local.day,kind);
  if (!saved[0].meta?.changes) return {already_published:true,edition_id:edition.id,items:edition.qualifying_count};
  return { edition_id: edition.id, day: local.day, kind, items: qualified.length, scan_status: health, cutoff };
}
__name(publish, "publish");
function editionTiming(edition) {
  const at = edition?.published_at ? new Date(edition.published_at).getTime() : null;
  const ageHours = at == null ? null : Math.round((Date.now() - at) / 36e4) / 10;
  const local = localTime();
  const expected = expectedEdition(local);
  const editionKey = edition ? edition.local_date + (edition.kind === "closing" ? "2" : "1") : null;
  const expectedKey = expected ? expected.date + (expected.kind === "closing" ? "2" : "1") : null;
  const late = Boolean(expectedKey && (!editionKey || editionKey < expectedKey));
  return {local,expected,ageHours,late};
}
async function status(env, knownEdition) {
  const last = (await env.DB.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 8").all()).results || [];
  const edition = knownEdition === undefined ? await latestEdition(env) : knownEdition;
  const subscribers = await env.DB.prepare("SELECT COUNT(*) count FROM subscribers WHERE status='active'").first();
  const {local,expected,ageHours,late}=editionTiming(edition);
  const mailQueue = await env.DB.prepare(`SELECT COUNT(*) FILTER (WHERE ${deliverableMorningMail}) AS pending,
    COUNT(*) FILTER (WHERE q.status='failed' AND q.attempts>=3) AS exhausted
    ${morningQueueJoins} WHERE q.status IN ('queued','failed')`).bind(local.day).first();
  const lastSuccess = await env.DB.prepare("SELECT MAX(ended_at) at FROM sync_runs WHERE status='ok'").first();
  return {
    version: "1.5.4-editorial-review",
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
    pending_emails: isMarketDay(local) && local.hour<12 ? mailQueue?.pending || 0 : 0,
    exhausted_emails: mailQueue?.exhausted || 0
  };
}
__name(status, "status");
async function feed(req, env, forHomepage=false) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day"), kind = url.searchParams.get("kind");
  if (day && !dateOK(day)) return message(400, "Invalid date");
  if (kind && !["morning", "closing"].includes(kind)) return message(400, "Invalid edition");
  let edition;
  if (day && kind) edition = await latestEdition(env, day, kind);
  else if (day) edition = await env.DB.prepare("SELECT * FROM editions WHERE local_date=? ORDER BY id DESC LIMIT 1").bind(day).first();
  else if (kind) edition = await env.DB.prepare("SELECT * FROM editions WHERE kind=? ORDER BY id DESC LIMIT 1").bind(kind).first();
  else edition = await latestEdition(env);
  if (!edition) return j({ edition: null, items: [], latest: forHomepage ? {stale:editionTiming(null).late} : await status(env), note: "No scheduled edition has been published yet. Consult /api/activity for verified research findings and source checks." });
  const rows = await editionItems(env, edition.id);
  let previous = null;
  if (!day && !kind && rows.length === 0) {
    const earlier = await env.DB.prepare(`SELECT e.id,e.local_date,e.kind FROM editions e
      WHERE e.id < ? AND EXISTS (SELECT 1 FROM edition_items i WHERE i.edition_id=e.id)
      ORDER BY e.id DESC LIMIT 1`).bind(edition.id).first();
    if (earlier) {
      previous = { edition: earlier, items: await editionItems(env, earlier.id) };
    }
  }
  return j({ edition, items: rows, latest: forHomepage ? {stale:editionTiming(edition).late} : await status(env, day || kind ? undefined : edition), ...(previous ? { previous } : {}) });
}
__name(feed, "feed");
async function article(req, env) {
  const id = decodeURIComponent(new URL(req.url).pathname.slice("/story/".length));
  if (!/^[A-Za-z0-9:_\-]{3,100}$/.test(id)) return new Response("Not found", { status: 404 });
  let item = await env.DB.prepare("SELECT i.*,e.published_at FROM edition_items i JOIN editions e ON e.id=i.edition_id WHERE i.candidate_id=? ORDER BY e.id DESC LIMIT 1").bind(id).first();
  if (!item) {
    const current=await env.DB.prepare("SELECT * FROM candidates WHERE id=? AND status='verified'").bind(id).first();
    if (verifyPublicStory(current)) item={...current,published_at:current.approved_at || current.first_seen_at};
  }
  if (!item) return new Response("This regulatory report has not passed publication verification.", { status: 404 });
  const news = (await env.DB.prepare("SELECT * FROM related_news WHERE candidate_id=? ORDER BY published_at DESC LIMIT 15").bind(id).all()).results || [];
  const title = html(item.title), canonical = base(env) + "/story/" + encodeURIComponent(id);
  const section = news.map((x) => `<li><a href="${html(x.url)}" rel="nofollow noopener noreferrer" target="_blank">${html(x.headline)}</a><small> ${html(x.publisher || "")} \xB7 ${html(x.relation)}${x.published_at ? " \xB7 " + html(x.published_at) : ""}</small></li>`).join("");
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "NewsArticle", headline: item.title, datePublished: item.published_at || void 0, mainEntityOfPage: canonical, publisher: { "@type": "Organization", name: "TickerDocket" }, isAccessibleForFree: true }).replace(/</g, "\\u003c");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | TickerDocket</title><meta name="description" content="Verified primary-source regulatory research for ${html(item.issuer)} (${html(item.ticker)})."><link rel="canonical" href="${html(canonical)}"><link rel="stylesheet" href="/styles.css"><script type="application/ld+json">${ld}<\/script></head><body><header class="top"><a class="brand" href="/"><span class="mark">TD</span>TICKER<strong>DOCKET</strong></a><nav><a href="/">Intelligence terminal</a></nav></header><main class="article-wrap"><p class="eyebrow">${html(item.agency || item.source)} \xB7 ${html(item.event_type || "regulatory action")}</p><h1>${title}</h1><p class="lede">Documented company exposure · <b>${html(item.issuer)} (${html(item.ticker)})</b></p><div class="story article"><h2>What the official record establishes</h2><p>${html(item.impact_note)}</p><p><b>Record date:</b> ${html(item.action_date || "Not provided by source")}</p><h2>Primary evidence</h2><p><a target="_blank" rel="noreferrer noopener" href="${html(item.source_url)}">Primary source document \u2197</a></p><p><a target="_blank" rel="noreferrer noopener" href="${html(item.company_evidence_url)}">Public-company / ticker evidence \u2197</a></p><p><a target="_blank" rel="noreferrer noopener" href="${html(item.impact_evidence_url)}">Direct exposure evidence \u2197</a></p><h2>Related reporting</h2>${news.length ? `<ul>${section}</ul>` : "<p>No independently verified related news is currently attached.</p>"}<p class="muted">This story reports a documented company relationship\u2014not a prediction that the stock will rise or fall. Regulatory action dates can precede the date the public dataset becomes available.</p></div><p><a href="/">\u2190 Back to TickerDocket</a></p></main><footer><span>\xA9 TickerDocket</span><span>Driftless Digital Ventures</span></footer></body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", "X-Content-Type-Options": "nosniff", ...new URL(req.url).hostname.startsWith("tickerdocket-engine-v13-preview.") ? { "X-Robots-Tag": "noindex, nofollow" } : {} } });
}
__name(article, "article");
async function sitemap(env) {
  const items=(await env.DB.prepare(`WITH stories AS (
    SELECT i.candidate_id AS id, e.published_at AS changed FROM edition_items i JOIN editions e ON e.id=i.edition_id
    UNION ALL SELECT id,COALESCE(approved_at,first_seen_at) FROM candidates WHERE status='verified'
      AND ticker IS NOT NULL AND issuer IS NOT NULL AND LENGTH(TRIM(impact_note))>0
      AND source_url LIKE 'https://%' AND company_evidence_url LIKE 'https://%' AND impact_evidence_url LIKE 'https://%')
    SELECT s.id AS candidate_id,MAX(s.changed) AS edition_changed,(SELECT MAX(n.verified_at) FROM related_news n WHERE n.candidate_id=s.id) AS news_changed
    FROM stories s GROUP BY s.id ORDER BY MAX(s.changed) DESC LIMIT 3000`).all()).results || [];
  const entries = [{loc:base(env),lastmod:items[0]?.edition_changed || null}, {loc:base(env)+"/coverage"}, {loc:base(env)+"/about"}, {loc:base(env)+"/method"},
    ...items.filter(x => /^[A-Za-z0-9:_-]{3,100}$/.test(x.candidate_id || "")).map(x => {
      const dates = [x.edition_changed, x.news_changed].map(v => Date.parse(v || "")).filter(v => Number.isFinite(v) && v <= Date.now());
      return {loc:base(env)+"/story/"+encodeURIComponent(x.candidate_id), lastmod:dates.length ? new Date(Math.max(...dates)).toISOString() : null};
    })];
  const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    entries.map(x => `<url><loc>${html(x.loc)}</loc>${x.lastmod ? "<lastmod>"+html(x.lastmod)+"</lastmod>" : ""}</url>`).join("") + "</urlset>";
  return new Response(xml, {headers:{"Content-Type":"application/xml; charset=utf-8","Cache-Control":"public, max-age=120"}});
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
      await ensurePipeline(env.DB);
      const offset=Number(u.searchParams.get('offset')||0);
      if (!Number.isSafeInteger(offset) || offset<0) return message(400,'Invalid offset');
      const rows=(await env.DB.prepare(`SELECT c.*,a.outcome AS review_outcome,a.detail AS review_detail
        FROM candidates c LEFT JOIN review_attempts a ON a.candidate_id=c.id WHERE c.status=?
        ORDER BY CASE WHEN a.outcome='editor_review' THEN 0 WHEN c.id LIKE 'lead:%' AND c.source NOT LIKE 'SEC %' THEN 1 ELSE 2 END,
        c.action_date DESC,c.first_seen_at DESC,c.id LIMIT 51 OFFSET ?`).bind(state,offset).all()).results||[];
      return j({candidates:rows.slice(0,50),next_offset:rows.length>50?offset+50:null});
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
  if (path === "/api/admin/publish") {
    const local = localTime();
    const scan = await scanSource(env, "all");
    return j({ scan, edition: await publish(env, b.kind, local) });
  }
  if (path === "/api/admin/mappings") {
    const applicant = String(b.applicant || "").trim(), issuer = String(b.issuer || "").trim(), ticker = String(b.ticker || "").toUpperCase().trim();
    if (applicant.length < 3 || issuer.length < 3 || !/^([A-Z]{1,7}[.\-]?[A-Z]{0,3})$/.test(ticker) || !validHttps(b.issuer_evidence_url) || b.ownership_evidence_url && !validHttps(b.ownership_evidence_url)) return message(400, "Supply a valid exact FDA applicant, ticker, issuer and HTTPS issuer evidence; ownership evidence required for subsidiaries.");
    const applicantNorm = applicant.normalize("NFKD").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    await env.DB.prepare(`INSERT INTO company_mappings(applicant_norm,applicant_name,issuer,ticker,issuer_evidence_url,ownership_evidence_url,approved_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(applicant_norm) DO UPDATE SET issuer=excluded.issuer,ticker=excluded.ticker,issuer_evidence_url=excluded.issuer_evidence_url,ownership_evidence_url=excluded.ownership_evidence_url,approved_at=excluded.approved_at`).bind(applicantNorm, applicant, issuer, ticker, b.issuer_evidence_url, b.ownership_evidence_url || null, nowISO()).run();
    return j({ ok: true, applicant, ticker });
  }
  if (path === "/api/admin/review") {
    await ensurePipeline(env.DB);
    const id = String(b.id || ""), candidate = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(id).first();
    if (!candidate) return message(404, "Unknown candidate");
    if (b.action === "reject") {
      await env.DB.prepare("UPDATE candidates SET status='rejected',ticker=NULL,issuer=NULL,approval_method=?,approved_at=? WHERE id=?").bind("editor-rejected", nowISO(), id).run();
      return j({ ok: true });
    }
    if (b.action !== "approve") return message(400, "Action must be approve/reject");
    if (!/^[A-Z]{1,7}[.\-]?[A-Z]{0,3}$/.test(b.ticker || "") || !String(b.issuer || "").trim() || !validHttps(b.company_evidence_url) || !validHttps(b.impact_evidence_url) || String(b.impact_note || "").trim().length < 55) return message(400, "Approval requires verified ticker, issuer, HTTPS issuer evidence, HTTPS direct-impact evidence, and a substantive written exposure explanation (55+ characters).");
    if (b.impact_category != null && !["direct", "possible"].includes(b.impact_category)) return message(400, "Choose direct or possible impact.");
    const eventType = b.impact_category === "direct" ? "Direct action" : b.impact_category === "possible" ? "Possible exposure" : candidate.event_type;
    if (!impactCategory({ ...candidate, event_type: eventType })) return message(400, "Choose the impact category for this lead.");
    await env.DB.prepare(`UPDATE candidates SET status='verified',ticker=?,issuer=?,company_evidence_url=?,impact_evidence_url=?,impact_note=?,event_type=?,approval_method='admin-reviewed',approved_at=? WHERE id=?`).bind(b.ticker, b.issuer, b.company_evidence_url, b.impact_evidence_url, b.impact_note, eventType, nowISO(), id).run();
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
function editorialPage(title, description, body, slug=title.toLowerCase()) {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' | TickerDocket</title><meta name="description" content="' + description + '"><link rel="canonical" href="https://tickerdocket.com/' + slug + '"><link rel="stylesheet" href="/styles.css"></head><body><header class="top"><a class="brand" href="/"><span class="mark">TD</span><span>TICKER<strong>DOCKET</strong></span></a><nav><a href="/">Live feed</a><a href="/about">About</a><a href="/method">Method</a></nav></header><main class="section"><p class="eyebrow">TICKERDOCKET / ' + title.toUpperCase() + '</p><h1>' + title + '</h1><div class="story" style="max-width:780px;margin-top:28px">' + body + '</div></main><footer><span>© 2026 TickerDocket</span><span>Driftless Digital Ventures</span><span><a href="/about">About</a> · <a href="/method">Method</a></span></footer></body></html>', { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
function informationPage(path) {
  if (path === "/about" || path === "/about/") return editorialPage("About", "Who operates TickerDocket and what the site covers.", '<h2>Independent regulatory reporting</h2><p>TickerDocket is operated by <a href="https://driftlessdigitalventures.com/">Driftless Digital Ventures</a>, founded by Joshua Rushlo. It tracks federal regulatory actions with documented connections to publicly traded companies.</p><p>The site publishes a morning and closing docket on U.S. market days and checks its sources throughout the day. An empty edition means no new item met the publication criteria in that window; it does not mean the agencies issued no actions.</p><p>Each record links to the government action and supporting company or ticker evidence. TickerDocket is independent of the agencies it monitors and is not an investment adviser. Its coverage is informational, and regulatory exposure alone does not establish a stock price effect.</p><p>For how records are selected and updated, see <a href="/method">the method</a>.</p>');
  return editorialPage("Method", "How TickerDocket gathers, checks, and publishes regulatory records.", '<h2>How the docket is produced</h2><p>TickerDocket checks Federal Register public inspection, FDA drugs, biologics, recalls, press releases, device decisions, the CMS newsroom, SEC 8-K and 6-K filings, GlobeNewswire biotechnology and public companies, Business Wire Health, PR Newswire Health and Policy, and selected issuer newsrooms. Source availability and publication times vary. The site checks these feeds during the day, generally every 30 minutes from 6:00 AM to 9:00 PM Central.</p><p>Candidate actions are matched to a publicly traded issuer using documented company, ownership, or ticker evidence, including company filings where applicable. A record requires an official source URL, a documented company connection, and an evidence note before it can appear in a public edition. Ambiguous matches are held for review rather than published as confirmed exposure.</p><p>Newly qualified records are captured in a morning edition at 8:00 AM Central and a closing edition at 4:30 PM Central on U.S. market days. Editions are snapshots. Later source checks can identify new candidates for a later edition, and a quiet edition may display an earlier edition with findings while clearly labeling its date.</p><p>Device approval, clearance, or a federal rule does not by itself establish financial materiality or predict a stock move. Read the linked primary record and company evidence before drawing a conclusion. See <a href="/about">who runs the site</a>.</p>');
}
async function adminPage(request, env) {
  if (!env.ADMIN_TOKEN) return message(503, "Admin authentication is not configured.");
  let credentials = "";
  try { credentials = atob((request.headers.get("Authorization") || "").replace(/^Basic\s+/i, "")); } catch {}
  if (credentials !== "admin:" + env.ADMIN_TOKEN) {
    return new Response("Authentication required.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="TickerDocket admin", charset="UTF-8"', "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  const headers = new Headers({"Content-Type":"text/html; charset=utf-8"});
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Vary", "Authorization");
  return new Response(adminTemplate, { status: 200, headers });
}
async function renderHome(request, env) {
  let rendered=false;
  let page = homeTemplate.replace('id="bot-check"',()=> 'id="bot-check" data-sitekey="'+html(emailReady(env) ? env.TURNSTILE_SITE_KEY : '')+'"');
  try {
    const data = await (await feed(new Request(new URL('/api/feed', request.url), request), env, true)).json();
    const edition = data.edition, items = data.items || [], previous = data.previous;
    const showingPrevious = !items.length && previous && previous.items && previous.items.length > 0;
    const displayed = showingPrevious ? previous.items : items;
    const editionLabel = e => e ? String(e.local_date || "") + " · " + String(e.kind || "").toUpperCase() : "CURRENT EDITION";
    const latest = data.latest || {};
    let status = !edition ? "Awaiting the first published edition." : latest.stale ? "The next edition is delayed." : !items.length ? (editionNotice(edition)) : "";
    const tag = showingPrevious ? editionLabel(previous.edition) + ' · ' + displayed.length + ' ITEMS' : edition ? editionLabel(edition) + ' · ' + items.length + ' ITEMS' : 'AWAITING NEXT EDITION';
    let coverageHTML='';
    let editionAudit={}; try {editionAudit=JSON.parse(edition?.notes || '{}');} catch {}
    if (edition) {
      const checks=editionAudit.source_coverage?.checks || [];
      const issues=checks.filter(x=>x.status!=='ok');
      const label=checks.length ? (checks.length-issues.length)+' of '+checks.length+' sources checked' :
        edition.scan_status==='checked' ? 'Source coverage complete' : 'Partial source coverage';
      coverageHTML='<details class="coverage-summary"><summary>'+html(label)+'</summary>'+
        (checks.length ? '<ul>'+checks.map(x=>'<li>'+html(x.source==='Company releases'?'GlobeNewswire Biotechnology':x.source)+' · '+html(x.status)+'</li>').join('')+'</ul>' :
          '<p>This edition predates detailed source-by-source coverage records.</p>')+'<p><a href="/coverage">View current source checks ↗</a></p></details>';
    }
    let updates='';
    let verified=[];
    if (edition) {
      const delta=(await env.DB.prepare(`SELECT * FROM candidates WHERE status='verified' AND
        (first_seen_at>? OR approved_at>?) ORDER BY COALESCE(approved_at,first_seen_at) DESC,id LIMIT 18`).bind(edition.published_at,edition.published_at).all()).results||[];
      verified=delta.filter(verifyPublicStory);
      if (verified.length) {
        const format=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
        updates='<section class="section" id="since-edition"><h2>Verified since the last edition</h2><ul class="since-list">'+verified.map(x=>{
          const time=x.approved_at||x.first_seen_at;
          return '<li><a href="/story/'+encodeURIComponent(x.id)+'"><b>'+html(x.ticker)+'</b> '+html(x.title)+'</a><time datetime="'+html(time)+'">Verified '+html(format.format(new Date(time)))+'</time></li>';
        }).join('')+'</ul></section>';
      }
    }
    const rankedUpdates=selectMorningItems(verified,3);
    const boardRows=verified.length ? [...rankedUpdates,...verified.filter(x=>!rankedUpdates.some(r=>r.id===x.id))] : displayed;
    const board = '<aside class="docket-board" data-server-rendered="true"><div class="docket-board-head"><span>' + html(verified.length ? 'VERIFIED SINCE LAST EDITION' : editionLabel(edition)) + '</span><span><i class="live-dot"></i> LIVE</span></div>' +
      (!verified.length && status ? '<div class="docket-empty">' + html(status) + '</div>' : '') +
      (!verified.length && showingPrevious ? '<div class="docket-empty">PREVIOUS EDITION · ' + html(editionLabel(previous.edition)) + '</div>' : '') +
      boardRows.slice(0,3).map(x => '<a href="/story/' + encodeURIComponent(x.candidate_id || x.id || "") + '" class="docket-line"><span class="field-label">TICKER:</span><b>' + html(x.ticker) + '</b><span class="field-label">DOCKET:</span><strong>' + html(x.title) + '</strong></a>').join("") +
      '<div class="docket-board-foot">' + (edition && edition.kind === "morning" ? 'NEXT DOCKET / 16:30 CT' : 'NEXT DOCKET / 08:00 CT') + '</div></aside>';
    const feedSection = '<section id="feed" class="section" data-server-rendered="true"><div class="section-intro"><div><p class="eyebrow">01 / ' + html(showingPrevious ? "PREVIOUS DOCKET" : edition ? String(edition.kind).toUpperCase() + " DOCKET" : "CURRENT DOCKET") + '</p><h2>' + (showingPrevious ? 'Previous edition findings' : displayed.length ? 'Edition findings' : 'Edition status') + '</h2></div><span class="tag">' + html(tag) + '</span></div>' +
      coverageHTML + (status ? '<p class="market-note"><strong>' + html(edition ? editionLabel(edition) + ' · ' : '') + html(status) + '</strong></p>' : '') +
      (showingPrevious ? '<p class="market-note">Showing the most recent edition with verified findings.</p>' : items.length ? '<p class="market-note">Primary-source regulatory actions verified for this edition.</p>' : '') +
      (displayed.length ? '<div class="feed-grid">' + displayed.map(x => {
        const category = x.impact_category === "direct" ? "Directly affects" : x.impact_category === "possible" ? "Could possibly affect" : "";
        return '<article class="story">' + (category ? '<p class="eyebrow">' + html(category) + '</p>' : '') + '<div class="docket-fields"><span>TICKER:</span><b>' + html(x.ticker) + '</b><span>DOCKET:</span><h3>' + html(x.title) + '</h3><span>AGENCY:</span><b>' + html(x.agency || x.source) + '</b><span>FILED:</span><time>' + html(x.action_date || '') + '</time></div><p>' + html(x.impact_note || '') + '</p><a href="/story/' + encodeURIComponent(x.candidate_id || '') + '">Open verified record ↗</a></article>';
      }).join("") + '</div>' : '') + '</section>';
    page = page.replace('<!-- VERIFIED_ACTIVITY -->',()=>updates).replace(/<aside class="docket-board">[\s\S]*?<\/aside>/, () => board)
      .replace(/<section id="feed" class="section">[\s\S]*?<\/section>/, () => feedSection);
    rendered=true;
  } catch (e) {
    console.error("Homepage server rendering failed:", err(e));
  }
  const headers = new Headers({"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff"});
  headers.set("Cache-Control", rendered ? "public, max-age=0, s-maxage=20" : "no-store");
  if (!rendered) headers.set("Retry-After","30");
  return new Response(page, {status:rendered ? 200 : 503, headers});
}
async function classifyUnmatched(env) {
    await env.DB.prepare(`INSERT OR IGNORE INTO review_attempts(candidate_id,attempted_at,outcome,detail,next_at)
      SELECT id,?,CASE WHEN source LIKE 'FDA %' THEN 'ownership_review' ELSE 'policy_review' END,
        CASE WHEN source LIKE 'FDA %' THEN json_object('reason','Applicant requires verified issuer identity or parent ownership','applicant',applicant)
          ELSE json_object('reason','Federal action requires documented public-company exposure') END,NULL
      FROM candidates WHERE status='pending' AND (id LIKE '510k:%' OR id LIKE 'pma:%' OR id LIKE 'fr-%')
      AND NOT EXISTS(SELECT 1 FROM review_attempts a WHERE a.candidate_id=candidates.id)`).bind(nowISO()).run();
}
async function serviceReviewQueue(env,date) {
  await ensurePipeline(env.DB);
  // New source sets receive a current scan even when deployed outside the regular scan window.
  const key='source-set:'+EXPECTED_SOURCES.join('|');
  const lease=await env.DB.prepare(`INSERT INTO pipeline_state(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE pipeline_state.value!='ready' AND pipeline_state.value<?`)
    .bind(key,new Date(Date.now()+20*60000).toISOString(),nowISO()).run();
  if (lease.meta?.changes) {
    const result=await scanSource(env,'all',date,true);
    if (result.disclosures?.available) await env.DB.prepare("UPDATE pipeline_state SET value='ready' WHERE key=?").bind(key).run();
    return;
  }
  const debts=(await env.DB.prepare(`SELECT s.source FROM sync_runs s WHERE s.id IN
    (SELECT MAX(id) FROM sync_runs WHERE source IN ('SEC 8-K','SEC 6-K') GROUP BY source)
    AND s.status!='ok' AND s.ended_at<?`).bind(new Date(date.getTime()-3*60000).toISOString()).all()).results||[];
  if(debts.length) await scanDisclosures(env,date,localTime(date).day,fetch,{names:debts.map(x=>x.source)});
  await classifyUnmatched(env);
  const reviewed=await reviewPending(env.DB,date);
  if (reviewed.examined) await logRun(env,'document review',date.toISOString(),'ok',reviewed.examined,reviewed.verified);
}
async function runScheduledSlot(trigger,env) {
  const date=new Date(trigger.scheduledTime),local=localTime(date),plan=schedulePlan(local);
  await ensurePipeline(env.DB);
  const slot=new Date(Math.floor(date.getTime()/300000)*300000).toISOString();
  const claimed=await env.DB.prepare(`INSERT INTO pipeline_state(key,value) VALUES('scheduled-slot',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE pipeline_state.value<excluded.value`).bind(slot).run();
  if(!claimed.meta?.changes) return;
  if(!plan.publish && isMarketDay(local)) {
    const retryKind=local.hour===8 && [5,10,15].includes(local.minute) ? 'morning' :
      local.hour===16 && [35,40,45].includes(local.minute) ? 'closing' : null;
    if(retryKind && !await latestEdition(env,local.day,retryKind)) plan.publish=retryKind;
  }
  const cycle=async()=>{
    if(plan.publish) {
      let result;
      try {result=await scanSource(env,'all',date,true);}
      catch(e) {await logRun(env,'pipeline service',nowISO(),'error',0,0,err(e));}
      await publish(env,plan.publish,local,result);
    } else if(plan.scan) await scanSource(env,'all',date);
    else await serviceReviewQueue(env,date);
  };
  try {await cycle();}
  catch(e) {await logRun(env,plan.publish?'edition publication':'pipeline service',nowISO(),'error',0,0,err(e));}
  if(plan.email) await flushMail(env,25,local.day);
}
var worker_default = {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    try {
      if (p === "/admin" || p === "/admin/" || p === "/admin.html") return adminPage(request, env);
      if (p === "/about" || p === "/about/" || p === "/method" || p === "/method/") return informationPage(p);
      if (p === "/robots.txt") return new Response("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n\nSitemap: https://tickerdocket.com/sitemap.xml\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
      if ((p === "/" || p === "/index.html") && request.method === "GET") {
        const cache=globalThis.caches?.default;
        if (!cache) return renderHome(request,env);
        const key=new Request(new URL('/_public-cache/v1.5.3/home',request.url).href);
        const cached=await cache.match(key);
        const response=cached || await renderHome(request,env);
        if (!cached && response.ok) {
          const copy=new Response(response.clone().body,response);
          copy.headers.set('Cache-Control','public, max-age=20');
          ctx.waitUntil(cache.put(key,copy));
        }
        const client=new Response(response.body,response);
        client.headers.set('Cache-Control','no-store');
        return client;
      }
      if(p==='/api/collector/wires' && request.method==='POST') {
        if (!await trustedCollector((request.headers.get('Authorization')||'').replace(/^Bearer /,''))) return message(401,'Workflow identity required');
        if (Number(request.headers.get('content-length')||0)>1200000) return message(413,'Feed payload too large');
        await ensurePipeline(env.DB);
        const now=new Date(); let names;
        try { names=await saveWireSnapshots(env.DB,await request.json(),now.getTime()); }
        catch(e) {return message(400,err(e));}
        const tick=new Date();
        ctx.waitUntil(scanDisclosures(env,tick,localTime(tick).day,fetch,{names,preferSnapshot:true}).catch(e=>logRun(env,'pipeline service',nowISO(),'error',0,0,err(e))));
        return j({accepted:names,received_at:now.toISOString()});
      }
      if (p==='/coverage' && request.method==='GET') return coveragePage(env);
      if (p==='/api/coverage' && request.method==='GET') return j(await collectionHealth(env));
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
  async scheduled(trigger,env,ctx) {
    ctx.waitUntil(runScheduledSlot(trigger,env));

  }
};
export {
  worker_default as default,
  publish,
  selectEditionCutoff,
  status
};


