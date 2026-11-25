// Read the two published wire streams, preserving the transport in each receipt.
import {syndicatedIndex,validWireDocument} from './wire-syndication.mjs';
import {createHash} from 'node:crypto';
import {DISCLOSURE_FEEDS} from './regulatory-discovery.mjs';
const endpoint='https://tickerdocket.com/api/collector/wires';
const feeds=[],failures=[];
for (const feed of DISCLOSURE_FEEDS.filter(f=>new URL(f.url).hostname==='www.globenewswire.com')) {
  let observation;
  for (const url of [feed.url,feed.alternate]) {
    try {
      const response=await fetch(url,{headers:{'User-Agent':'TickerDocket public filings monitor newsletter@tickerdocket.com'},signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('HTTP '+response.status);
      const body=await response.text();
      const atom=url===feed.alternate;
      if (!validWireDocument(body,atom)) throw Error('Invalid publisher document');
      observation={source:feed.name,url,via:atom?'publisher Atom collector':'publisher RSS collector',fetched_at:new Date().toISOString(),body};
      break;
    } catch(error) {console.log(feed.name+' '+new URL(url).pathname.split('/')[1]+': '+error.message);}
  }
  if (!observation) {
    try {
      const snapshot=await syndicatedIndex(feed,Date.now());
      observation={source:feed.name,url:feed.url,via:snapshot.via,origin_updated_at:snapshot.origin_updated_at,
        fetched_at:snapshot.fetched_at,body:snapshot.body};
    } catch(error) {failures.push(feed.name+' — '+error.message);continue;}
  }
  observation.sha256=createHash('sha256').update(observation.body).digest('hex');
  feeds.push(observation);
  console.log(feed.name+' via '+observation.via);
}
if (feeds.length) {
  const idURL=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  idURL.searchParams.set('audience',endpoint);
  const id=await fetch(idURL,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(10000)});
  if(!id.ok) throw Error('Workflow identity unavailable: HTTP '+id.status);
  const token=(await id.json()).value;
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({feeds}),signal:AbortSignal.timeout(35000)});
  if (!response.ok) throw Error('TickerDocket receipt HTTP '+response.status+': '+(await response.text()).slice(0,160));
  console.log('TickerDocket accepted '+feeds.length+' publisher snapshots.');
}
if (failures.length) {console.error(failures.join('\n'));process.exitCode=1;}
