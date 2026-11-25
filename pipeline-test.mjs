import assert from 'node:assert/strict';
import {DISCLOSURE_FEEDS,readDiscoverySource} from './regulatory-discovery.mjs';
import {issuerDirectory,verifyDisclosure} from './disclosure-review.mjs';
import {ensurePipeline} from './pipeline-store.mjs';
import {reviewPending} from './review-queue.mjs';
import local from './test-d1.cjs';

const end=Date.parse('2026-11-25T06:32:00Z'), at=new Date(end);
const sec=DISCLOSURE_FEEDS.find(f=>f.name==='SEC 6-K');
const atom=(offset,n)=>'<feed>'+Array.from({length:n},(_,i)=>{
  const id=offset+i; return '<entry><title>6-K - Company '+id+'</title><link href="https://www.sec.gov/Archives/'+id+'"/><updated>'+
    new Date(end-id*60000).toISOString()+'</updated></entry>';}).join('')+'</feed>';
const pages=async url=>{const start=Number(new URL(url).searchParams.get('start'));return new Response(atom(start,Math.min(100,Math.max(0,242-start))));};
const first=await readDiscoverySource(sec,end,pages,{},2);
assert.equal(first.records.length,200);assert(first.coverage_error);assert(first.next.anchor);
const resumed=await readDiscoverySource(sec,end,pages,first.next,4);
assert.equal(resumed.coverage_error,null);assert.equal(resumed.next.complete,end);
const interrupted=await readDiscoverySource(sec,end,async url=>new URL(url).searchParams.get('start')==='100'?new Response('busy',{status:503}):pages(url));
assert.equal(interrupted.records.length,100);assert(interrupted.coverage_error);assert(interrupted.next.anchor);
const globe=DISCLOSURE_FEEDS.find(f=>f.name==='Company releases');
const fallback=await readDiscoverySource(globe,end,async url=>url===globe.url?new Response('unavailable',{status:403}):new Response('<feed></feed>'));
assert.equal(fallback.error,undefined);assert.deepEqual(fallback.attempts.map(x=>x.ok||false),[false,true]);

const {db,DB}=local.localD1();
db.exec(`CREATE TABLE candidates(id TEXT PRIMARY KEY,source TEXT,source_url TEXT,title TEXT,agency TEXT,event_type TEXT,action_date TEXT,
  first_seen_at TEXT,status TEXT,ticker TEXT,issuer TEXT,impact_note TEXT,impact_evidence_url TEXT,company_evidence_url TEXT,approval_method TEXT,approved_at TEXT);
  CREATE TABLE sync_runs(id INTEGER PRIMARY KEY,source TEXT,ended_at TEXT);
  CREATE TABLE edition_items(candidate_id TEXT,edition_id INTEGER);`);
await ensurePipeline(DB);
const directoryJSON={fields:['cik','name','ticker','exchange'],data:[[55,'Example Research Inc.','EXRP','Nasdaq']]};
const candidate={id:'lead:example',source:'Business Wire Health',source_url:'https://www.businesswire.com/news/home/11/en/',
  title:'Example Research Announces FDA Acceptance of Supplemental Biologics License Application',action_date:'2026-11-24'};
const release='<p>Example Research Inc. (NASDAQ: EXRP), today announced the U.S. Food and Drug Administration ( FDA ) has accepted its supplemental application for review.</p>';
let payload=release,requests=0;
const fetcher=async url=>{
  if (String(url).endsWith('company_tickers_exchange.json')) return Response.json(directoryJSON);
  requests++;return new Response(payload);
};
const directory=await issuerDirectory(fetcher);
assert.equal((await verifyDisclosure(candidate,directory,fetcher)).event_type,'FDA application acceptance');
for (const [title,body] of [
  ['Example Research Expects FDA Approval','<p>'+release+'</p>'],
  [candidate.title,release.replace('Example Research Inc.','Another Issuer')],
  [candidate.title,release.replace('has accepted','might accept')],
  [candidate.title,release.replace('the U.S.','its partner previously announced the U.S.')],
]) {payload=body;assert.equal((await verifyDisclosure({...candidate,title},directory,fetcher)).outcome,'editor_review');}
payload=release;
const add=(id,url)=>db.prepare("INSERT INTO candidates(id,source,source_url,title,action_date,first_seen_at,status) VALUES(?,?,?,?,?,?,'pending')")
  .run(id,candidate.source,url,candidate.title,candidate.action_date,'2026-11-24T14:00:00Z');
add(candidate.id,candidate.source_url);add('lead:duplicate','https://www.businesswire.com/news/home/12/en/');
const result=await reviewPending(DB,at,fetcher);
assert.equal(result.verified,1);assert.equal(result.duplicate,1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM candidates WHERE status='verified'").get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM candidate_history').get().n,4);
assert.throws(()=>db.exec('DELETE FROM candidate_history'),/append-only/);
assert.equal((await reviewPending(DB,at,fetcher)).examined,0);
console.log('Passed paginated catch-up, partial-failure recovery, alternate feed, primary-source verification, false-positive, deduplication and append-only history tests.');
