// Existing rows have an inline text body. New content is stored once by raw-byte SHA-256.
export async function readCapturedBody(DB,row) {
  if (row.body!=null) return new TextEncoder().encode(row.body);
  const meta=await DB.prepare('SELECT * FROM source_content WHERE sha256=?').bind(row.body_sha256).first();
  if (!meta) return null;
  const chunks=(await DB.prepare('SELECT payload FROM source_content_chunks WHERE sha256=? ORDER BY part').bind(row.body_sha256).all()).results;
  if (chunks.length!==meta.parts) throw Error('Incomplete archived content');
  const blob=new Blob(chunks.map(x=>new Uint8Array(x.payload)));
  const bytes=new Uint8Array(await new Response(meta.codec==='gzip'?blob.stream().pipeThrough(new DecompressionStream('gzip')):blob.stream()).arrayBuffer());
  if (await evidenceHash(bytes)!==row.body_sha256) throw Error('Source evidence hash mismatch');
  return bytes;
}
async function evidenceHash(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
export function evidenceFetcher(at, fetcher = fetch) {
  const records=[], bodies=new Map(), scanId=crypto.randomUUID();
  const wrapped=async (url,options)=>{
    const started=new Date().toISOString();
    let response;
    try {
      response=await fetcher(url,options);
    } catch(error) {
      records.push([scanId,at.toISOString(),String(url),null,started,new Date().toISOString(),null,null,null,String(error.message||error).slice(0,300)]);
      throw error;
    }
    let hash=null, problem=null;
    try {
      const bytes=await response.clone().arrayBuffer();
      hash=await evidenceHash(bytes);
      if (bytes.byteLength>8*1024*1024) problem='Body exceeds eight MiB capture limit; SHA-256 retained';
      else if (!bodies.has(hash)) bodies.set(hash,bytes);
    } catch(error) {problem='Archive read failed: '+String(error.message||error).slice(0,230);}
    records.push([scanId,at.toISOString(),String(url),response.url||String(url),started,new Date().toISOString(),response.status,hash,null,problem]);
    return response;
  };
  const save=async DB=>{
    await DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS source_snapshots (id INTEGER PRIMARY KEY,scan_id TEXT NOT NULL,scheduled_at TEXT NOT NULL,
        request_url TEXT NOT NULL,response_url TEXT,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,http_status INTEGER,body_sha256 TEXT,body TEXT,capture_error TEXT)`),
      DB.prepare('CREATE TABLE IF NOT EXISTS source_content(sha256 TEXT PRIMARY KEY,codec TEXT NOT NULL,raw_size INTEGER NOT NULL,parts INTEGER NOT NULL)'),
      DB.prepare('CREATE TABLE IF NOT EXISTS source_content_chunks(sha256 TEXT NOT NULL,part INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(sha256,part))'),
      DB.prepare('CREATE INDEX IF NOT EXISTS docket_snapshot_scan ON source_snapshots(scan_id)'),
    ]);
    const known=new Set();
    if (bodies.size) {
      const result=await DB.prepare("SELECT sha256 FROM source_content WHERE sha256 IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...bodies.keys()])).all();
      for (const row of result.results||[]) known.add(row.sha256);
    }
    for (const [hash,raw] of bodies) {
      if (known.has(hash)) continue;
      const codec=typeof CompressionStream==='function' && raw.byteLength>=1024?'gzip':'raw';
      const stored=codec==='gzip' ? await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer() : raw;
      const size=100000,parts=Math.max(1,Math.ceil(stored.byteLength/size)),writes=[];
      for(let i=0;i<parts;i++) writes.push(DB.prepare('INSERT OR IGNORE INTO source_content_chunks VALUES(?,?,?)').bind(hash,i,stored.slice(i*size,(i+1)*size)));
      writes.push(DB.prepare('INSERT OR IGNORE INTO source_content VALUES(?,?,?,?)').bind(hash,codec,raw.byteLength,parts));
      await DB.batch(writes);
    }
    for (let i=0;i<records.length;i+=30) {
      await DB.batch(records.slice(i,i+30).map(row=>DB.prepare(`INSERT INTO source_snapshots
        (scan_id,scheduled_at,request_url,response_url,started_at,ended_at,http_status,body_sha256,body,capture_error)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(...row)));
    }
    return {scan_id:scanId,captured_requests:records.length,unique_bodies:bodies.size,capture_gaps:records.filter(x=>x[9]).length};
  };
  return {fetch:wrapped,save};
}
