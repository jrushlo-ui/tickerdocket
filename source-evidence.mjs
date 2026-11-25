// Capture only scheduled edition scans. Never store request headers or credentials.
export function evidenceFetcher(at, fetcher = fetch) {
  const records = [];
  const scanId = crypto.randomUUID();
  const wrapped = async (url, options) => {
    const started = new Date().toISOString();
    try {
      const response = await fetcher(url, options);
      const body = await response.clone().text();
      const bytes = new TextEncoder().encode(body);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
      const omitted = bytes.byteLength > 1000000;
      records.push([scanId, at.toISOString(), String(url), response.url || String(url), started,
        new Date().toISOString(), response.status, sha256, omitted ? null : body,
        omitted ? 'Body exceeded 1,000,000 bytes; hash retained, replay gap remains' : null]);
      return response;
    } catch (error) {
      records.push([scanId, at.toISOString(), String(url), null, started, new Date().toISOString(),
        null, null, null, String(error.message || error).slice(0, 300)]);
      throw error;
    }
  };
  const save = async DB => {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS source_snapshots (
      id INTEGER PRIMARY KEY,scan_id TEXT NOT NULL,scheduled_at TEXT NOT NULL,request_url TEXT NOT NULL,
      response_url TEXT,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,http_status INTEGER,
      body_sha256 TEXT,body TEXT,capture_error TEXT)`).run();
    for (let i = 0; i < records.length; i += 10) {
      await DB.batch(records.slice(i, i + 10).map(row => DB.prepare(`INSERT INTO source_snapshots
        (scan_id,scheduled_at,request_url,response_url,started_at,ended_at,http_status,body_sha256,body,capture_error)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(...row)));
    }
    return {scan_id:scanId, captured_requests:records.length};
  };
  return {fetch:wrapped,save};
}
