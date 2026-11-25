// Persist collection checkpoints, per-scan dispositions and candidate decisions independently of edition snapshots.
const pipelineReady = new WeakMap();
export async function ensurePipeline(DB) {
  if (!pipelineReady.has(DB)) {
    const statements = [
      'CREATE TABLE IF NOT EXISTS wire_provenance(source TEXT NOT NULL,fetched_at TEXT NOT NULL,sha256 TEXT NOT NULL,via TEXT NOT NULL,origin_updated_at TEXT NOT NULL,PRIMARY KEY(source,fetched_at,sha256))',
      'CREATE TABLE IF NOT EXISTS wire_content(sha256 TEXT PRIMARY KEY,body TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS wire_receipts(source TEXT NOT NULL,url TEXT NOT NULL,fetched_at TEXT NOT NULL,received_at TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(source,fetched_at,sha256))',
      'CREATE TABLE IF NOT EXISTS pipeline_state (key TEXT PRIMARY KEY,value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS discovery_checks (id INTEGER PRIMARY KEY,source TEXT NOT NULL,started_at TEXT NOT NULL,details TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS discovery_source_time ON discovery_checks(source,started_at)',
      'CREATE TABLE IF NOT EXISTS review_attempts (candidate_id TEXT PRIMARY KEY,attempted_at TEXT NOT NULL,outcome TEXT NOT NULL,detail TEXT NOT NULL,next_at TEXT,attempts INTEGER NOT NULL DEFAULT 1)',
      'CREATE TABLE IF NOT EXISTS candidate_history (id INTEGER PRIMARY KEY,candidate_id TEXT NOT NULL,at TEXT NOT NULL,previous_status TEXT,status TEXT NOT NULL,method TEXT,details TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS history_candidate ON candidate_history(candidate_id,id)',
      'CREATE INDEX IF NOT EXISTS docket_candidate_queue ON candidates(status,action_date,first_seen_at)',
      "CREATE INDEX IF NOT EXISTS docket_verified_at ON candidates(approved_at) WHERE status='verified'",
      "CREATE INDEX IF NOT EXISTS docket_pending_seen ON candidates(first_seen_at) WHERE status='pending'",
      'CREATE INDEX IF NOT EXISTS docket_run_time ON sync_runs(source,ended_at,id)',
      "CREATE INDEX IF NOT EXISTS docket_success_time ON sync_runs(ended_at) WHERE status='ok'",
      'CREATE INDEX IF NOT EXISTS docket_item_lookup ON edition_items(candidate_id,edition_id)',
    ];
    const detail = "json_object('ticker',NEW.ticker,'issuer',NEW.issuer,'title',NEW.title,'event_type',NEW.event_type,'source',NEW.source_url,'company',NEW.company_evidence_url,'impact',NEW.impact_evidence_url,'note',NEW.impact_note,'approved_at',NEW.approved_at)";
    const insert = prev => "INSERT INTO candidate_history(candidate_id,at,previous_status,status,method,details) VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')," + prev + ",NEW.status,NEW.approval_method," + detail + ");";
    statements.push(
      "CREATE TRIGGER IF NOT EXISTS docket_history_new AFTER INSERT ON candidates BEGIN " + insert('NULL') + " END",
      "CREATE TRIGGER IF NOT EXISTS docket_history_change AFTER UPDATE ON candidates WHEN OLD.status IS NOT NEW.status OR OLD.approved_at IS NOT NEW.approved_at OR OLD.company_evidence_url IS NOT NEW.company_evidence_url OR OLD.impact_evidence_url IS NOT NEW.impact_evidence_url OR OLD.impact_note IS NOT NEW.impact_note OR OLD.ticker IS NOT NEW.ticker BEGIN " + insert('OLD.status') + " END",
      "CREATE TRIGGER IF NOT EXISTS docket_history_no_update BEFORE UPDATE ON candidate_history BEGIN SELECT RAISE(ABORT,'Candidate history is append-only'); END",
      "CREATE TRIGGER IF NOT EXISTS docket_history_no_delete BEFORE DELETE ON candidate_history BEGIN SELECT RAISE(ABORT,'Candidate history is append-only'); END"
    );
    pipelineReady.set(DB, DB.batch(statements.map(sql => DB.prepare(sql))).catch(error=>{pipelineReady.delete(DB);throw error;}));
  }
  return pipelineReady.get(DB);
}
export function recordDiscovery(DB,source,at,details) {
  return DB.prepare('INSERT INTO discovery_checks(source,started_at,details) VALUES(?,?,?)').bind(source,at,JSON.stringify(details));
}
