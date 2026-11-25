import { validWireDocument } from './wire-syndication.mjs';
import { DISCLOSURE_FEEDS } from './regulatory-discovery.mjs';

const wireSources=DISCLOSURE_FEEDS.filter(f=>new URL(f.url).hostname==='www.globenewswire.com');
const collectorAudience='https://tickerdocket.com/api/collector/wires';
const githubIssuer='https://token.actions.githubusercontent.com';
const collectorWorkflow='jrushlo-ui/tickerdocket/.github/workflows/wire-feeds.yml@refs/heads/main';
const collectorKeys=new Map();
const decodeJWTPart=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));

export async function trustedCollector(jwt,when=Date.now(),fetcher=fetch) {
  try {
    if (!jwt || jwt.length>20000) return false;
    const pieces=jwt.split('.');
    if (pieces.length!==3) return false;
    const [head,claims]=pieces.slice(0,2).map(x=>JSON.parse(new TextDecoder().decode(decodeJWTPart(x))));
    if (head.alg!=='RS256' || typeof head.kid!=='string' || claims.iss!==githubIssuer || claims.aud!==collectorAudience ||
        String(claims.repository_id)!=='1443532654' || String(claims.repository_owner_id)!=='330234919' ||
        claims.repository!=='jrushlo-ui/tickerdocket' || claims.ref!=='refs/heads/main' ||
        claims.workflow_ref!==collectorWorkflow || !['push','workflow_dispatch','schedule'].includes(claims.event_name) ||
        !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) ||
        claims.exp*1000<=when || claims.iat*1000>when+30000 || claims.iat*1000<when-10*60000 ||
        claims.nbf!=null && (!Number.isFinite(claims.nbf)||claims.nbf*1000>when+30000)) return false;
    let cached=collectorKeys.get(head.kid);
    if (!cached || cached.until<=when) {
      const response=await fetcher(githubIssuer+'/.well-known/jwks',{signal:AbortSignal.timeout(6000)});
      if (!response.ok) return false;
      const jwk=(await response.json()).keys.find(k=>k.kty==='RSA' && k.kid===head.kid && (!k.alg || k.alg==='RS256'));
      if (!jwk) return false;
      cached={until:when+3600000,key:await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])};
      collectorKeys.set(head.kid,cached);
    }
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',cached.key,decodeJWTPart(pieces[2]),new TextEncoder().encode(pieces[0]+'.'+pieces[1]));
  } catch { return false; }
}
export async function saveWireSnapshots(DB,payload,at) {
  if (!Array.isArray(payload.feeds) || payload.feeds.length<1 || payload.feeds.length>wireSources.length) throw Error('Invalid feed set');
  const seen=new Set(),writes=[],names=[];
  for (const input of payload.feeds) {
    const via=input.via || 'publisher RSS collector';
    const atom=via==='publisher Atom collector';
    const feed=wireSources.find(f=>f.name===input.source && (atom?f.alternate:f.url)===input.url);
    const fetched=Date.parse(input.fetched_at);
    if (!feed || seen.has(feed.name) || !Number.isFinite(fetched) || fetched>at+30000 || fetched<at-15*60000 ||
        !validWireDocument(input.body,atom)) throw Error('Invalid or stale publisher feed');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.body))),x=>x.toString(16).padStart(2,'0')).join('');
    if (hash!==input.sha256) throw Error('Publisher feed digest mismatch');
    const origin=input.origin_updated_at || input.fetched_at;
    if(!['syndicated index','publisher RSS collector','publisher Atom collector'].includes(via) || !Number.isFinite(Date.parse(origin)) || Date.parse(origin)>at+30000) throw Error('Invalid feed provenance');
    seen.add(feed.name);names.push(feed.name);
    writes.push(DB.prepare('INSERT OR IGNORE INTO wire_content(sha256,body) VALUES(?,?)').bind(hash,input.body),
      DB.prepare('INSERT OR IGNORE INTO wire_receipts(source,url,fetched_at,received_at,sha256) VALUES(?,?,?,?,?)')
      .bind(feed.name,input.url,new Date(fetched).toISOString(),new Date(at).toISOString(),hash),
      DB.prepare('INSERT OR IGNORE INTO wire_provenance(source,fetched_at,sha256,via,origin_updated_at) VALUES(?,?,?,?,?)')
        .bind(feed.name,new Date(fetched).toISOString(),hash,via,new Date(origin).toISOString()));
  }
  await DB.batch(writes);
  return names;
}
export async function currentWireSnapshot(DB,feed,at) {
  if (!wireSources.some(x=>x.name===feed.name)) return null;
  return DB.prepare(`SELECT r.url,r.fetched_at,r.received_at,r.sha256,c.body,p.via,p.origin_updated_at FROM wire_receipts r JOIN wire_content c ON c.sha256=r.sha256 LEFT JOIN wire_provenance p ON p.source=r.source AND p.fetched_at=r.fetched_at AND p.sha256=r.sha256
    WHERE r.source=? AND r.fetched_at>=? AND r.fetched_at<=? AND r.received_at<=? ORDER BY r.fetched_at DESC LIMIT 1`)
    .bind(feed.name,new Date(at-45*60000).toISOString(),new Date(at).toISOString(),new Date(at).toISOString()).first();
}
