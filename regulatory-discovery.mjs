import { syndicatedIndex } from './wire-syndication.mjs';
const FDA_FEEDS = ['biologics', 'drugs', 'press-releases', 'recalls'].map(name => ({
  name: 'FDA ' + name, url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/' + name + '/rss.xml',
}));
const newsroom = (name, host) => ({name, url: 'https://' + host + '/rss/news-releases.xml'});
export const DISCLOSURE_FEEDS = [
  ...FDA_FEEDS,
  {name: 'CMS newsroom', kind: 'cms', url: 'https://www.cms.gov/about-cms/contact/newsroom'},
  {name: 'Company releases', url: 'https://www.globenewswire.com/RssFeed/industry/4573-Biotechnology/feedTitle/GlobeNewswire%20-%20Industry%20News%20on%20Biotechnology',
    alternate: 'https://www.globenewswire.com/AtomFeed/industry/4573-Biotechnology'},
  {name: 'GlobeNewswire Public Companies',url:'https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies',alternate:'https://www.globenewswire.com/AtomFeed/orgclass/1'},
  {name: 'PR Newswire Policy',url:'https://www.prnewswire.com/rss/policy-public-interest-latest-news/policy-public-interest-latest-news-list.rss'},
  {name: 'Business Wire Health', url: 'https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEVlZWA==', hosts: ['www.businesswire.com']},
  {name: 'PR Newswire Health', url: 'https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss'},
  newsroom('Cogent newsroom', 'investors.cogentbio.com'),
  newsroom('PolyPid newsroom', 'investors.polypid.com'),
  newsroom('TG Therapeutics newsroom', 'ir.tgtherapeutics.com'),
  ...['8-K', '6-K'].map(form => ({name: 'SEC ' + form, kind: 'sec',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&owner=exclude&count=100&output=atom&type=' + form})),
];

const REGULATORY = /\b(fda|cms|sec|ftc|doj|epa|fcc|ferc|faa|nhtsa|department of justice|federal trade commission|securities and exchange commission|medicare|medicaid|recalls?|complete response letter|drug application|s?bla|s?nda|clearance|regulatory|antitrust|reimbursement|proposed rule|final rule|safety alert|consent decree|warning letter)\b/i;
const ACTION = /\b(approv\w*|accept\w*|propos\w*|settl\w*|penalt\w*|suspend\w*|revok\w*|consent decree|statement|clear\w*|authoriz\w*|reject\w*|declin\w*|recall\w*|rules?|guidance|delay\w*|extend\w*|extension|compliance|coverage|enforcement|investigat\w*|decision|response letter|warning letter|regulatory update)\b/i;
const FEED_WEEK = 7 * 86400000;
const EDGAR_OVERLAP = 10 * 60000;

export function clean(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&').replace(/&(ldquo|rdquo|lsquo|rsquo|trade|reg|ndash|mdash);/gi,(_,e)=>({ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',trade:'™',reg:'®',ndash:'–',mdash:'—'})[e.toLowerCase()]).replace(/&(lt|gt|quot|apos|nbsp|#39|#160);/gi, (_, e) =>
      ({lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#160':' '})[e.toLowerCase()])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (all, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function field(xml, tag) {
  return clean(xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1]);
}
function sourceLink(feed, raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, feed.url);
    const allowed = feed.hosts || [new URL(feed.url).hostname];
    if (!allowed.includes(url.hostname) || url.username || url.password || url.port) return null;
    if (url.protocol === 'http:' && ['www.fda.gov','www.businesswire.com'].includes(url.hostname)) url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    url.searchParams.delete('feedref');
    url.hash = '';
    return url.href;
  } catch { return null; }
}
function inspectFeed(feed, xml, at) {
  let items;
  if (feed.kind === 'cms') {
    if (!xml.includes('newsroom-main-view-link')) throw new Error('CMS listing could not be read');
    items = xml.split('<div class="views-row">').slice(1).map(row => ({
      title:clean(row.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]), summary:'',
      link:row.match(/<a href="([^"]+)" class="[^"]*newsroom-main-view-link/)?.[1], date:row.match(/<time datetime="([^"]+)"/)?.[1],
    }));
  } else {
    if (!/<(?:rss|feed)(?:\s|>)/i.test(xml) || !/<\/(?:rss|feed)>/i.test(xml)) throw new Error('Incomplete RSS or Atom document');
    items = Array.from(xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi), ([,,entry]) => ({
      title:field(entry,'title'), summary:field(entry,'description') || field(entry,'summary'),
      link:field(entry,'link') || clean(entry.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1]),
      date:field(entry,'pubDate') || field(entry,'updated') || field(entry,'published') || field(entry,'dc:date'),
    }));
  }
  const records = [], decisions = [], pages = [];
  let malformed = 0;
  for (const item of items) {
    const time = Date.parse(item.date), url = sourceLink(feed,item.link);
    pages.push({url,time});
    let reason;
    if (!item.title || !url || !Number.isFinite(time)) { reason = 'invalid date, title or source URL'; malformed++; }
    else if (time > at) reason = 'future timestamp';
    else if (time < at - FEED_WEEK) reason = 'outside seven-day discovery window';
    else if (feed.kind !== 'sec' && (!ACTION.test(item.title) || !REGULATORY.test(item.title + ' ' + item.summary) && !feed.name.startsWith('FDA '))) reason = 'no qualifying action in headline';
    else if (feed.kind === 'sec' && !new RegExp('^' + feed.name.slice(4) + '(?:/A)?\\s+-','i').test(item.title)) reason = 'different filing form';
    else {
      reason = 'candidate';
      records.push({source:feed.name, source_url:url, title:item.title, action_date:(url.match(/^https:\/\/www\.globenewswire\.com\/(?:[a-z]{2}\/)?news-release\/(\d{4}\/\d{2}\/\d{2})\//i)?.[1] || new Date(time).toISOString().slice(0,10)).replaceAll('/','-'),
        agency:feed.name.startsWith('FDA ') ? 'FDA' : feed.kind === 'sec' ? 'SEC' : feed.kind === 'cms' ? 'CMS' : 'Issuer disclosure'});
    }
    decisions.push([url || String(item.link || '').slice(0,400), item.date || '', reason]);
  }
  return {records,decisions,pages,malformed};
}
export function parseDiscoveryFeed(feed, body, at) { return inspectFeed(feed,body,at).records; }

async function readDiscoveryPage(url, fetcher) {
  const response = await fetcher(url,{headers:{'User-Agent':'TickerDocket public filings monitor newsletter@tickerdocket.com'},signal:AbortSignal.timeout(url.includes('browse-edgar') ? 16000 : 10000)});
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.text();
}

// Freeze the upper bound while catching up. Only advance it after reaching the prior
// completed window. Re-read the overlap accession before accepting an offset on resume.
export async function readDiscoverySource(feed, at, fetcher, state = {}, pageBudget = 6, snapshotReader, preferSnapshot=false) {
  const records = new Map(), decisions = [], attempts = [];
  let pagesRead = 0, malformed = 0, coverage_error = null, next = null;
  const collect = page => {
    pagesRead++; malformed += page.malformed; decisions.push(...page.decisions);
    for (const item of page.records) records.set(item.source_url,item);
  };
  async function pageAt(url) {
    try {
      const parsed = inspectFeed(feed,await readDiscoveryPage(url,fetcher),at);
      attempts.push({url,ok:true}); return parsed;
    } catch (e) { attempts.push({url,error:String(e.message || e)}); throw e; }
  }
  try {
    if (feed.kind !== 'sec') {
      let page;
      const fromSnapshot=async()=>{
        let cached=await snapshotReader?.(feed,at);
        if(!cached && feed.alternate && !preferSnapshot) {
          try { cached=await syndicatedIndex(feed,at,fetcher); }
          catch (e) {attempts.push({url:'https://cloud.feedly.com/v3/streams/contents',error:String(e.message||e)});}
        }
        if (!cached) return null;
        const via=cached.via || 'publisher RSS collector';
        if(via==='syndicated index') coverage_error='Syndicated releases available. Direct publisher coverage and exact release times are unconfirmed.';
        attempts.push({url:cached.endpoint||cached.url,ok:true,via,observed_at:cached.fetched_at,origin_updated_at:cached.origin_updated_at||null,sha256:cached.sha256||null});
        return inspectFeed(feed,cached.body,at);
      };
      if(preferSnapshot) page=await fromSnapshot();
      if(!page) {
        try { page=await pageAt(feed.url); }
        catch (error) {
          if (!feed.alternate) throw error;
          try { page=await pageAt(feed.alternate); }
          catch (other) { page=await fromSnapshot(); if(!page) throw other; }
        }
      }
      collect(page);
    } else {
      const complete = state.complete || 0, through = state.through || at;
      const target = Math.max(through - FEED_WEEK, complete ? complete - EDGAR_OVERLAP : through - FEED_WEEK);
      let offset = state.anchor ? state.offset : 0, anchor = state.anchor || null;
      let lastAnchor = anchor, lastOffset = offset;
      const readOffset = async index => {
        const url = new URL(feed.url); url.searchParams.set('start',String(index));
        const page = await pageAt(url.href); collect(page); return page.pages;
      };
      // Fresh discoveries still enter the queue while a past window is being drained.
      if (offset > 0) await readOffset(0);
      while (pagesRead < pageBudget) {
        const entries = await readOffset(offset);
        if (entries.some((x,i)=>!x.url || !Number.isFinite(x.time) || i > 0 && x.time > entries[i-1].time)) {
          coverage_error = 'SEC page had invalid or out-of-order filing metadata'; break;
        }
        if (anchor && !entries.some(x=>x.url === anchor)) {
          if (entries.length < 100 || entries.at(-1).time < state.anchorTime) {
            coverage_error = 'SEC overlap could not be reconciled. Restarting the open window.';
            next = {complete,through}; break;
          }
          offset += 100;
          next = {...state,offset}; continue;
        }
        if (entries.length < 100 || entries.at(-1).time < target) {
          next = {complete:through}; break;
        }
        const tail = entries.at(-1);
        if (!anchor && lastAnchor === tail.url) { coverage_error = 'SEC repeated a full page'; break; }
        anchor = null; lastAnchor = tail.url; lastOffset = offset;
        next = {complete,through,offset:lastOffset,anchor:lastAnchor,anchorTime:tail.time};
        offset += 100;
      }
      if (!next?.complete || next.through) coverage_error ||= 'SEC pagination continues from a saved overlap';
    }
    if (malformed) coverage_error ||= malformed + ' entries had invalid identity or time';
    return {source:feed.name,records:[...records.values()],decisions,attempts,pages:pagesRead,next,coverage_error};
  } catch(error) {
    return {source:feed.name,records:[...records.values()],decisions,attempts,pages:pagesRead,next,
      ...(pagesRead ? {coverage_error:String(error.message || error)} : {error:String(error.message || error)})};
  }
}
export async function discoverRegulatoryLeads(at, fetcher=fetch, states={}, options={}) {
  const feeds=options.names ? DISCLOSURE_FEEDS.filter(feed=>options.names.includes(feed.name)) : DISCLOSURE_FEEDS;
  return Promise.all(feeds.map(feed=>readDiscoverySource(feed,at,fetcher,states[feed.name],6,options.snapshotReader,options.preferSnapshot)));
}

export const reviewedLaunchItems = [
{
  "id": "lead:4691caae87a3e62ebd607ce8b033d86f05f00e335b531a063eb19e5cbe014806",
  "action_date": "2026-11-24",
  "ticker": "TGTX",
  "issuer": "TG Therapeutics, Inc.",
  "source": "TG Therapeutics newsroom",
  "title": "FDA accepts TG Therapeutics’ application for a single-dose BRIUMVI initiation schedule",
  "event_type": "FDA application acceptance",
  "source_url": "https://ir.tgtherapeutics.com/news-releases/news-release-details/tg-therapeutics-announces-fda-acceptance-supplemental-biologics",
  "company_evidence_url": "https://www.sec.gov/edgar/browse/?CIK=1001316",
  "impact_note": "The FDA accepted TG Therapeutics’ supplemental application for review. The company reported a July 10, 2027 target action date. The proposed dosing change still awaits a decision.",
  "agency": "FDA",
  "reviewed_at": "2026-11-25T06:25:04.526Z"
},
{
  "ticker": "BBIO",
  "issuer": "BridgeBio Pharma, Inc.",
  "title": "FDA approves Welgemda for limb-girdle muscular dystrophy type 2I/R9",
  "company_evidence_url": "https://investor.bridgebio.com/news/news-details/2026/Welgemda-BBP-418-Ribitol-Receives-Traditional-Approval-as-the-First-and-Only-Treatment-for-Individuals-Living-with-LGMD2IR9/default.aspx",
  "impact_note": "The FDA identifies ML Bio Solutions as manufacturer and BridgeBio Pharma as distributor. BridgeBio announced traditional FDA approval for Welgemda for eligible adult and pediatric patients.",
  "id": "lead:90bafe5ac66c1c4c62bc5b8bef76cbae1bfca9116a7640dade104a111ce22a6e",
  "action_date": "2026-11-23",
  "source": "FDA drugs",
  "source_url": "https://www.fda.gov/news-events/press-announcements/fda-approves-first-treatment-limb-girdle-muscular-dystrophy-type-2ir9",
  "event_type": "FDA approval",
  "agency": "FDA",
  "reviewed_at": "2026-11-25T06:25:04.526Z"
},
{
  "ticker": "RHHBY",
  "issuer": "Roche Holding AG",
  "title": "FDA approves Roche’s Wilserdly for adjuvant treatment of early-stage breast cancer",
  "company_evidence_url": "https://www.roche.com/investors/updates/inv-update-2026-11-23",
  "impact_note": "Roche confirmed the early-stage breast cancer indication for its Genentech therapy Wilserdly. Roche identifies its U.S. OTCQX ADR as RHHBY. This is a separate decision from the November 16 advanced-disease indication.",
  "id": "lead:d1826cc7c7c92382e21e1a47f71920c57f5b27bc716d604c416b6be6f9acea16",
  "action_date": "2026-11-23",
  "source": "FDA drugs",
  "source_url": "https://www.fda.gov/drugs/cancer-approvals/fda-approves-giredestrant-adjuvant-treatment-er-positive-her2-negative-stage-i-ii-and-iii-breast",
  "event_type": "FDA approval",
  "agency": "FDA",
  "reviewed_at": "2026-11-25T06:25:04.526Z"
},
  {
    id: 'lead:069030d98421306f6e4e863bc225858c17982509820d9dd8794c2576787d9118',
    action_date: '2026-11-24', reviewed_at: '2026-11-25T05:57:44.153Z',
    ticker: 'COGT', issuer: 'Cogent Biosciences, Inc.', agency: 'FDA', source: 'FDA drugs',
    title: 'FDA approves bezuclastinib with sunitinib for advanced gastrointestinal stromal tumors',
    event_type: 'FDA approval',
    source_url: 'https://www.fda.gov/drugs/cancer-approvals/fda-approves-bezuclastinib-combination-sunitinib-advanced-gastrointestinal-stromal-tumors',
    company_evidence_url: 'https://investors.cogentbio.com/news-releases/news-release-details/cogent-biosciences-announces-fda-approval-and-launch-ekitnatm',
    impact_note: 'FDA approved Cogent’s Ekitna (bezuclastinib) with sunitinib for previously treated advanced GIST. Cogent (Nasdaq: COGT) announced the approval and U.S. launch. This lead was discovered on November 24 and verified during the subsequent audit; it was absent from that closing edition.',
  },
  {
    id: 'lead:63d93b52c26b1755f4e237aec7e4506727e165d4148ed1319e546ef1eb8f1eb8',
    action_date: '2026-11-24', reviewed_at: '2026-11-25T05:57:44.153Z',
    ticker: 'PYPD', issuer: 'PolyPid Ltd.', agency: 'FDA', source: 'SEC 6-K',
    title: 'PolyPid discloses FDA approval of BACFENSSI for colorectal surgical-site infection prevention',
    event_type: 'FDA approval',
    source_url: 'https://www.sec.gov/Archives/edgar/data/1611842/000121390026123719/0001213900-26-123719-index.htm',
    company_evidence_url: 'https://investors.polypid.com/news-releases/news-release-details/polypid-announces-fda-approval-bacfenssir-d-plex100-reduce',
    impact_evidence_url: 'https://investors.polypid.com/news-releases/news-release-details/polypid-announces-fda-approval-bacfenssir-d-plex100-reduce',
    impact_note: 'PolyPid (Nasdaq: PYPD) disclosed FDA approval of its BACFENSSI NDA. Its U.S. commercialization partner Azurity expects launch in early 2027. The filing was discovered before the November 24 close and verified during the subsequent audit; it was absent from that closing edition.',
  },
  {
    id: 'reviewed:capr-deramiocel-crl-2026-11-20', action_date: '2026-11-20',
    ticker: 'CAPR', issuer: 'Capricor Therapeutics', agency: 'FDA', source: 'FDA biologics',
    title: 'FDA declines to approve Capricor’s deramiocel application',
    event_type: 'Complete Response Letter',
    source_url: 'https://www.fda.gov/vaccines-blood-biologics/whats-new-biologics/statement-deramiocel-bla-duchenne-muscular-dystrophy',
    company_evidence_url: 'https://www.capricor.com/investors/news-events/press-releases/detail/360/capricor-therapeutics-provides-regulatory-update-on',
    impact_note: 'Capricor disclosed a Complete Response Letter for its Duchenne muscular dystrophy therapy. The application cannot be approved in its current form. The company scheduled an update call for November 23 at 7:30 a.m. Central.',
  },
  {
    id: 'reviewed:blte-tinlarebant-extension-2026-11-20', action_date: '2026-11-20',
    ticker: 'BLTE', issuer: 'Belite Bio', agency: 'FDA', source: 'Issuer disclosure',
    title: 'Belite Bio reports a three-month FDA review extension for tinlarebant',
    event_type: 'Regulatory review extension',
    source_url: 'https://investors.belitebio.com/node/9906/pdf',
    company_evidence_url: 'https://investors.belitebio.com/node/9906/pdf',
    impact_note: 'Belite Bio said the FDA moved the action date for its Stargardt disease application to May 12, 2027. The review extension is confirmed by the company. The approval decision remains pending.',
  },
  {
    id: 'reviewed:hum-cms-4214-p2-2026-11-20', action_date: '2026-11-20',
    ticker: 'HUM', issuer: 'Humana', agency: 'CMS', source: 'CMS newsroom',
    title: 'CMS proposes 2028 Medicare Advantage changes with potential exposure for Humana',
    event_type: 'Proposed rule',
    source_url: 'https://www.cms.gov/newsroom/fact-sheets/contract-year-2028-policy-technical-changes-medicare-advantage-program-medicare-prescription-drug',
    company_evidence_url: 'https://www.sec.gov/Archives/edgar/data/49071/000004907126000066/hum-20260930.htm',
    impact_note: 'Humana reports a Medicare Advantage insurance business. If finalized, the CMS proposal could change how those plans are marketed and how members enroll. Watch for the final rule and Humana’s assessment of the changes.',
  },
];
