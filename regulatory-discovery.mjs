const FDA_FEEDS = ['biologics', 'drugs', 'press-releases', 'recalls'].map((name) => ({
  name: 'FDA ' + name,
  url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/' + name + '/rss.xml',
}));
const CMS_URL = 'https://www.cms.gov/about-cms/contact/newsroom';
const WIRE_URL = 'https://www.globenewswire.com/RssFeed/industry/4573-Biotechnology/feedTitle/GlobeNewswire%20Biotechnology';
const FEEDS = [
  ...FDA_FEEDS,
  { name: 'CMS newsroom', url: CMS_URL, kind: 'cms' },
  { name: 'Company releases', url: WIRE_URL },
  ...['8-K', '6-K'].map((form) => ({
    name: 'SEC ' + form,
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&owner=exclude&count=100&output=atom&type=' + form,
    kind: 'sec',
  })),
];

const REGULATORY = /\b(fda|cms|medicare|medicaid|recalls?|complete response letter|drug application|bla|nda|clearance|regulatory|antitrust|reimbursement|proposed rule|final rule|safety alert|consent decree|warning letter)\b/i;
const ACTION = /\b(approv\w*|accept\w*|propos\w*|statement|clear\w*|authoriz\w*|reject\w*|declin\w*|recall\w*|rules?|guidance|delay\w*|extend\w*|extension|compliance|coverage|enforcement|investigat\w*|decision|response letter|warning letter|regulatory update)\b/i;

function clean(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, entity) => (
      { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }[entity]
    )).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function field(xml, tag) {
  return clean(xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1]);
}

function makeLead(feed, title, link, timestamp, at) {
  const date = Date.parse(timestamp);
  if (!title || !link || !Number.isFinite(date) || date > at || date < at - 7 * 86400000) return null;
  let url;
  try {
    url = new URL(link, feed.url);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' && url.hostname === 'www.fda.gov') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.hostname !== new URL(feed.url).hostname || url.username || url.password) return null;
  return {
    source: feed.name, title, source_url: url.href,
    agency: feed.name.startsWith('FDA ') ? 'FDA' : feed.name.startsWith('SEC ') ? 'SEC' : feed.kind === 'cms' ? 'CMS' : 'Issuer disclosure',
    action_date: new Date(date).toISOString().slice(0, 10),
  };
}

export function parseDiscoveryFeed(feed, xml, at) {
  if (feed.kind === 'cms') {
    if (!xml.includes('newsroom-main-view-link')) throw new Error('CMS listing could not be read');
    return xml.split('<div class="views-row">').slice(1).map((row) => {
      const date = row.match(/<time datetime="([^"]+)"/)?.[1];
      const title = clean(row.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
      const link = row.match(/<a href="([^"]+)" class="[^"]*newsroom-main-view-link/)?.[1];
      return REGULATORY.test(title) && ACTION.test(title) ? makeLead(feed, title, link, date, at) : null;
    }).filter(Boolean);
  }
  if (!/<(?:rss|feed)(?:\s|>)/i.test(xml)) throw new Error('Expected an RSS or Atom feed');
  return Array.from(xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi), ([, , entry]) => {
    const title = field(entry, 'title');
    const link = field(entry, 'link') || clean(entry.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1]);
    const summary = field(entry, 'description') || field(entry, 'summary');
    const date = field(entry, 'pubDate') || field(entry, 'updated');
    if (feed.kind === 'sec') {
      if (!/Item (?:1\.01|1\.02|2\.06|3\.01|8\.01)\b/i.test(summary) && !feed.name.endsWith('6-K')) return null;
    } else if (!ACTION.test(title) || (!REGULATORY.test(title + ' ' + summary) && !feed.name.startsWith('FDA '))) {
      return null;
    }
    return makeLead(feed, title, link, date, at);
  }).filter(Boolean);
}

export async function discoverRegulatoryLeads(at, fetcher = fetch) {
  return Promise.all(FEEDS.map(async (feed) => {
    try {
      const response = await fetcher(feed.url, {
        headers: { 'User-Agent': 'TickerDocket public filings monitor newsletter@tickerdocket.com' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const body = await response.text();
      const saturated = feed.kind === 'sec' && (body.match(/<entry(?:\s|>)/gi) || []).length >= 100;
      return { source: feed.name, records: parseDiscoveryFeed(feed, body, at),
        coverage_error: saturated ? 'SEC current-filings page reached 100 entries; earlier filings may be omitted' : null };
    } catch (error) {
      return { source: feed.name, records: [], error: String(error.message || error) };
    }
  }));
}

export const reviewedLaunchItems = [
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
