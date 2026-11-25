// Only the two public publisher RSS feeds are read. No repository writes or persistent secrets.
import {createHash} from 'node:crypto';
import {DISCLOSURE_FEEDS} from './regulatory-discovery.mjs';
const endpoint='https://tickerdocket.com/api/collector/wires';
const feeds=[],failures=[];
for (const feed of DISCLOSURE_FEEDS.filter(f=>new URL(f.url).hostname==='www.globenewswire.com')) {
  try {
    const response=await fetch(feed.url,{headers:{'User-Agent':'TickerDocket public filings monitor newsletter@tickerdocket.com'},signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('publisher HTTP '+response.status);
    const body=await response.text();
    if (!/<rss\b/i.test(body) || !/<item[\s>]/i.test(body) || !/<\/rss>/i.test(body)) throw Error('invalid publisher XML');
    feeds.push({source:feed.name,url:feed.url,fetched_at:new Date().toISOString(),sha256:createHash('sha256').update(body).digest('hex'),body});
  } catch(error) {failures.push(feed.name+' — '+error.message);}
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
