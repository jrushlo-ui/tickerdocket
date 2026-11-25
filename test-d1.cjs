// SQLite-backed subset of the D1 binding for deterministic publication and recovery tests.
const {DatabaseSync}=require('node:sqlite');
function localD1() {
  const db=new DatabaseSync(':memory:');
  const bindable=v=>v instanceof ArrayBuffer ? new Uint8Array(v) : v;
  function statement(sql,args=[]) {
    return {
      bind(...values) {return statement(sql,values.map(bindable));},
      async first() {return db.prepare(sql).get(...args)||null;},
      async all() {return {results:db.prepare(sql).all(...args)};},
      async run() {
        const stmt=db.prepare(sql);
        if (stmt.columns().length) return {results:stmt.all(...args),meta:{changes:0}};
        const r=stmt.run(...args);
        return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)},results:[]};
      },
    };
  }
  const DB={prepare:statement,async batch(statements){
    db.exec('BEGIN');
    try {
      const results=[];
      for(const s of statements) results.push(await s.run());
      db.exec('COMMIT');return results;
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }};
  return {db,DB};
}
function editorialD1() {
  const {DB,db}=localD1();
  db.exec(`CREATE TABLE editions(id INTEGER PRIMARY KEY,local_date TEXT,kind TEXT,published_at TEXT,status TEXT,scan_status TEXT,qualifying_count INTEGER,notes TEXT,UNIQUE(local_date,kind));
CREATE TABLE sync_runs(id INTEGER PRIMARY KEY,source TEXT,started_at TEXT,ended_at TEXT,status TEXT,seen_count INTEGER,inserted_count INTEGER,error TEXT);
CREATE TABLE candidates(id TEXT PRIMARY KEY,source TEXT,source_url TEXT,title TEXT,agency TEXT,event_type TEXT,action_date TEXT,applicant TEXT,device_code TEXT,first_seen_local TEXT,first_seen_at TEXT,last_seen_at TEXT,status TEXT,ticker TEXT,issuer TEXT,company_evidence_url TEXT,impact_evidence_url TEXT,impact_note TEXT,approval_method TEXT,approved_at TEXT);
CREATE TABLE edition_items(edition_id INTEGER,candidate_id TEXT,title TEXT,ticker TEXT,issuer TEXT,source TEXT,source_url TEXT,action_date TEXT,agency TEXT,event_type TEXT,impact_note TEXT,company_evidence_url TEXT,impact_evidence_url TEXT,PRIMARY KEY(edition_id,candidate_id));`);
  return {DB,db};
}
module.exports={localD1,editorialD1};
