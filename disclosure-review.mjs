import { clean, DISCLOSURE_FEEDS } from './regulatory-discovery.mjs';

const directoryURL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const tidyName = text => clean(text).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\b(CORPORATION|CORP|INCORPORATED|INC|LIMITED|LTD|PLC|AG|CO|COMPANY)\b/g,' ').replace(/\s+/g,' ').trim();
const reviewHeaders = {'User-Agent':'TickerDocket public filings monitor newsletter@tickerdocket.com'};
const textOnly = s => clean(s.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' '));
const currentAction = /\b(?:FDA|Food and Drug Administration)(?:\s*\(\s*[“"']?FDA[”"']?\s*\))?\s+(?:has\s+)?(approved|accepted|cleared|authorized|granted (?:traditional \(full\) |accelerated )?approval|issued (?:a |an? )?complete response letter)\b/i;
const ordinaryTitle = /\b(?:FDA|Food and Drug Administration)\s+(?:(?:grants?|has granted)\s+)?(?:approv(?:es|al|ed)|accept(?:s|ance|ed)|clear(?:ance|s|ed)|authoriz(?:es|ation)|complete response letter)\b/i;
const prospective = /\b(?:seeks?|seeking|expects?|anticipates?|targets?|potential|upon|pending|if|projected|hopes?|plans? to (?:seek|obtain)|files for|applies for|submits? (?:an? )?(?:application|request) for)\b[^.;:]{0,60}\b(?:FDA|approval|clearance|acceptance)\b/i;

export async function issuerDirectory(fetcher) {
  const r = await fetcher(directoryURL,{headers:reviewHeaders,signal:AbortSignal.timeout(10000)});
  if (!r.ok) throw Error('SEC issuer directory HTTP ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data.fields) || !Array.isArray(data.data) || !['ticker','exchange','name','cik'].every(k=>data.fields.includes(k))) throw Error('Invalid SEC issuer directory');
  const names = new Map(), tickers = new Map(), ciks = new Map();
  for (const cells of data.data) {
    const row = Object.fromEntries(data.fields.map((k,i)=>[k,cells[i]]));
    if (!/^(Nasdaq|NYSE|NYSE American|AMEX|CBOE)$/i.test(row.exchange) || !/^[A-Z][A-Z0-9.-]{0,10}$/.test(row.ticker)) continue;
    const key = tidyName(row.name);
    if (!key) continue;
    tickers.set(row.ticker,row);
    names.set(key,names.has(key) ? null : row);
    const cik=String(Number(row.cik));
    ciks.set(cik,[...(ciks.get(cik)||[]),row]);
  }
  if (!tickers.size) throw Error('Empty SEC listed-issuer directory');
  return {names,tickers,ciks};
}
function allowedArticle(raw) {
  try {
    const u=new URL(raw);
    const hosts=new Set(['www.fda.gov','www.sec.gov','www.businesswire.com',...DISCLOSURE_FEEDS.map(f=>new URL(f.url).hostname)]);
    return u.protocol==='https:' && !u.username && !u.password && !u.port && hosts.has(u.hostname) ? u : null;
  } catch { return null; }
}
async function downloadDoc(url,fetcher) {
  const response = await fetcher(url,{headers:reviewHeaders,signal:AbortSignal.timeout(8500)});
  if (!response.ok) throw Error('Primary document HTTP ' + response.status);
  const landed = response.url || String(url);
  if (!allowedArticle(landed) || new URL(landed).hostname!==new URL(url).hostname) throw Error('Document left the approved source');
  const body=await response.text();
  if (body.length>2200000) throw Error('Document exceeds the bounded reading window');
  return {url:landed,body};
}
function exhibitLinks(html,index) {
  const base=new URL('.',index);
  const matches=[];
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>x[1]);
    const type=textOnly(cells[3]||'');
    if (!/^EX-99(?:\.\d+)?$|^(?:6|8)-K(?:\/A)?$/i.test(type)) continue;
    const raw=cells[2]?.match(/href=["']([^"']+)["']/i)?.[1]; if (!raw) continue;
    const u=new URL(raw,index);
    if (u.origin!==base.origin || !u.pathname.startsWith(base.pathname) || !/\.html?$/i.test(u.pathname)) continue;
    matches.push({url:u.href,exhibit:type.startsWith('EX-99')});
  }
  return matches.sort((a,b)=>Number(b.exhibit)-Number(a.exhibit)).map(x=>x.url);
}
function actionLabel(verb) {
  if (/accept/i.test(verb)) return 'FDA application acceptance';
  if (/clear/i.test(verb)) return 'FDA clearance';
  if (/response letter/i.test(verb)) return 'Complete Response Letter';
  if (/authoriz/i.test(verb)) return 'FDA authorization';
  return 'FDA approval';
}
function reviewDecision(row,issuer,verb,headline,url,excerpt) {
  const label=actionLabel(verb);
  const explanation=label==='FDA application acceptance' ? 'The FDA accepted the application for review. An approval decision is still pending.'
    : label==='Complete Response Letter' ? 'The FDA issued a complete response letter. The application requires further action by the issuer.'
    : 'The primary record documents a regulatory decision involving the listed company’s product.';
  return {outcome:'verified',ticker:issuer.ticker,issuer:issuer.name,agency:'FDA',event_type:actionLabel(verb),
    title:headline,company_evidence_url:'https://www.sec.gov/edgar/browse/?CIK='+Number(issuer.cik),
    impact_evidence_url:url,impact_note:issuer.name+' ('+issuer.ticker+'). '+explanation,detail:{primary:url,excerpt:excerpt.slice(0,800)}};
}
function documentDecision(row,doc,directory,filingCIK) {
  const body = doc.body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const host = new URL(doc.url).hostname;
  const paragraphs = [...body.matchAll(/<(?:p|div)\b[^>]*>((?:(?!<(?:p|div)\b)[\s\S])*?)<\/(?:p|div)>/gi)].map(m=>textOnly(m[1]));
  // EDGAR documents frequently use nested font elements or tables for the press-release lead.
  const text = textOnly(body);
  const headline = !filingCIK && row.title;
  if (host==='www.fda.gov' && ordinaryTitle.test(row.title)) {
    for (const p of paragraphs) {
      const verb = p.match(currentAction);
      if (!verb || !/^On [A-Z][a-z]+ \d{1,2}, \d{4},/i.test(p)) continue;
      const match = p.slice(verb.index+verb[0].length).match(/^\s+[^().]{1,100}\s*\(([^()]{2,160})\)/);
      const pieces=match?.[1].split(',') || [];
      if (pieces.length<2) continue;
      const issuer=directory.names.get(tidyName(pieces.slice(1).join(',')));
      if (issuer) return reviewDecision(row,issuer,verb[1],row.title,doc.url,p.split(/(?<=[a-z)])\.\s+(?=[A-Z])/)[0]);
    }
    return null;
  }
  if (headline && (!ordinaryTitle.test(headline) || prospective.test(headline))) return null;
  const tags=[...text.matchAll(/\(\s*(NASDAQ(?:\s+(?:GLOBAL SELECT MARKET|GLOBAL MARKET|CAPITAL MARKET))?|NYSE(?:\s+AMERICAN)?|AMEX)\s*:\s*([A-Z][A-Z0-9.-]{0,10})\s*\)/gi)];
  for (const tag of tags) {
    const issuer=directory.tickers.get(tag[2].toUpperCase());
    if (!issuer || filingCIK && Number(filingCIK)!==Number(issuer.cik)) continue;
    const name=tidyName(issuer.name), before=tidyName(text.slice(Math.max(0,tag.index-150),tag.index));
    if (headline && !tidyName(headline).includes(name) && host!=='www.sec.gov') continue;
    if (name.length<3 || !(before===name || before.endsWith(' '+name))) continue;
    const after=text.slice(tag.index+tag[0].length,tag.index+tag[0].length+900);
    const announce=after.match(/^[^;!?]{0,360}?\b(?:today\s+)?(?:announce[ds]|report(?:s|ed)|disclose[ds]|confirm(?:s|ed))\b/i);
    if (!announce) continue;
    const statement=after.slice(announce[0].length).trim();
    const verb=statement.match(currentAction);
    if (!verb || verb.index>100 || /[.;!?]/.test(statement.slice(0,verb.index).replace(/U\.S\./gi,'US')) || /\b(?:previously|last year|in 20\d\d|if|whether|expect\w*|anticipat\w*|believ\w*|partner|competitor|another company)\b/i.test(statement.slice(0,verb.index))) continue;
    // Exact applicant language or a named product is required after the FDA verb.
    const object=statement.slice(verb.index+verb[0].length).trim();
    if (!object || /^(?:a competitor|an unrelated|another company|its competitor|their partner)/i.test(object)) continue;
    const sentence=statement.slice(verb.index).split(/(?<=[a-z)®™])\.\s+(?=[A-Z“"])/)[0].slice(0,520).replace(/[.;, ]+$/,'');
    if (sentence.length<35 || /\b(?:before|since) the (?:acquisition|merger)\b/i.test(sentence)) continue;
    if (headline && actionLabel(verb[1])==='FDA approval' && /acceptance|clearance|complete response letter/i.test(headline)) continue;
    const note=issuer.name+' disclosed the following FDA action: '+sentence+'.';
    const shortObject=object.split(/\s+/).slice(0,13).join(' ').replace(/[.,;:]+$/,'');
    const title=headline || issuer.name+' reports '+actionLabel(verb[1])+' — '+shortObject;
    return reviewDecision(row,issuer,verb[1],title,doc.url,note);
  }
  return null;
}
export async function verifyDisclosure(row,directory,fetcher=fetch) {
  const u=allowedArticle(row.source_url);
  if (!u) return {outcome:'editor_review',detail:{reason:'Primary document requires editorial review'}};
  if (u.hostname==='www.fda.gov' && !ordinaryTitle.test(row.title) && /^(?:\d{4} First Generic Drug Approvals|Accelerated Approval|Oncology \(Cancer\)\/Hematologic Malignancies Approval Notifications)$/i.test(row.title)) {
    return {outcome:'excluded',detail:{reason:'FDA reference index, without an individual regulatory decision',primary:row.source_url}};
  }
  const cik=u.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/\d+\/[\w-]+-index\.html?$/i)?.[1];
  if (u.hostname==='www.sec.gov' && !cik) return {outcome:'editor_review',detail:{reason:'Filing identity needs review'}};
  if (cik && !directory.ciks.has(String(Number(cik)))) return {outcome:'editor_review',detail:{reason:'Filer has no matched US exchange listing. Check parent or indirect exposure.'}};
  const doc=await downloadDoc(u.href,fetcher);
  const links=cik ? exhibitLinks(doc.body,u.href) : [];
  const read=[];
  if (!cik) {
    const result=documentDecision(row,doc,directory,null);
    if (result) return result;
  } else {
    for (const link of links.slice(0,2)) {
      const exhibit=await downloadDoc(link,fetcher);
      read.push(exhibit.url);
      const result=documentDecision(row,exhibit,directory,cik);
      if (result) return result;
    }
  }
  return {outcome:'editor_review',detail:{reason:'Public-company impact requires additional evidence',primary:doc.url,documents_read:read,documents_remaining:Math.max(0,links.length-read.length)}};
}
