// Only pending work belongs here. Candidate and attempt history remain authoritative.
const workSchema = [
  `CREATE TABLE IF NOT EXISTS docket_review_work (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, first_seen_at TEXT, action_date TEXT,
    priority INTEGER NOT NULL, is_sec INTEGER, next_at TEXT, is_retry INTEGER)`,
  `CREATE VIEW IF NOT EXISTS docket_eligible_work AS
    SELECT c.id, CASE WHEN c.id LIKE 'lead:%' THEN 'lead' ELSE 'federal' END AS kind,
      c.first_seen_at,c.action_date,
      CASE WHEN c.source LIKE '%newsroom' AND c.source!='CMS newsroom' THEN 0
        WHEN c.source IN ('FDA drugs','FDA biologics','FDA press-releases')
          AND (c.title LIKE 'FDA approv%' OR c.title LIKE '%response letter%') THEN 1
        WHEN c.source IN ('Company releases','Business Wire Health','PR Newswire Health') THEN 2
        WHEN c.source LIKE 'SEC %' THEN 4 ELSE 3 END AS priority,
      c.source LIKE 'SEC %' AS is_sec,a.next_at,a.outcome='retry' AS is_retry
    FROM candidates c LEFT JOIN review_attempts a ON a.candidate_id=c.id
    WHERE c.status='pending' AND (
      (c.id LIKE 'lead:%' AND (a.candidate_id IS NULL OR a.next_at IS NOT NULL)) OR
      ((c.id LIKE '510k:%' OR c.id LIKE 'pma:%' OR c.id LIKE 'fr-%') AND a.candidate_id IS NULL))`,
  "CREATE INDEX IF NOT EXISTS docket_work_priority ON docket_review_work(priority,action_date DESC,first_seen_at DESC,id) WHERE kind='lead'",
  "CREATE INDEX IF NOT EXISTS docket_work_sec ON docket_review_work(first_seen_at,id) WHERE kind='lead' AND is_sec=1",
  "CREATE INDEX IF NOT EXISTS docket_work_retry ON docket_review_work(next_at,id) WHERE kind='lead' AND is_retry=1",
  "CREATE INDEX IF NOT EXISTS docket_work_federal ON docket_review_work(id) WHERE kind='federal'",
];

function workTriggers(table,key,columns) {
  const changes = columns.map(column=>'OLD.'+column+' IS NOT NEW.'+column).join(' OR ');
  const refresh = ids => `DELETE FROM docket_review_work WHERE id IN (${ids});
    INSERT INTO docket_review_work SELECT * FROM docket_eligible_work WHERE id IN (${ids});`;
  return [
    `CREATE TRIGGER IF NOT EXISTS docket_work_${table}_insert AFTER INSERT ON ${table}
      BEGIN ${refresh('NEW.'+key)} END`,
    `CREATE TRIGGER IF NOT EXISTS docket_work_${table}_change AFTER UPDATE OF ${columns.join(',')} ON ${table}
      WHEN ${changes} BEGIN ${refresh('OLD.'+key+',NEW.'+key)} END`,
    `CREATE TRIGGER IF NOT EXISTS docket_work_${table}_delete AFTER DELETE ON ${table}
      BEGIN ${refresh('OLD.'+key)} END`,
  ];
}

// D1 batches are transactional. Install the triggers, backfill existing candidates,
// and mark the migration complete together. Two simultaneous installers are safe.
export async function ensureReviewWork(DB) {
  const marker='review-work-v1';
  if (await DB.prepare('SELECT 1 AS ready FROM pipeline_state WHERE key=?').bind(marker).first()) return;
  const migration=[
    ...workSchema,
    ...workTriggers('candidates','id',['id','status','source','title','first_seen_at','action_date']),
    ...workTriggers('review_attempts','candidate_id',['candidate_id','outcome','next_at']),
  ].map(sql=>DB.prepare(sql));
  migration.push(DB.prepare('INSERT OR IGNORE INTO docket_review_work SELECT * FROM docket_eligible_work'),
    DB.prepare("INSERT OR IGNORE INTO pipeline_state(key,value) VALUES(?,'ready')").bind(marker));
  await DB.batch(migration);
}

export async function selectReviewBatch(DB,stamp,limit) {
  const select = `SELECT c.*,a.attempts FROM docket_review_work w
    CROSS JOIN candidates c ON c.id=w.id LEFT JOIN review_attempts a ON a.candidate_id=c.id
    WHERE w.kind='lead' AND w.first_seen_at<=?`;
  const due = DB.prepare(select+" AND w.is_retry=1 AND w.next_at<=? ORDER BY w.next_at,w.id LIMIT 1").bind(stamp,stamp);
  const available = select+' AND (w.next_at IS NULL OR w.next_at<=?)';
  const priority = DB.prepare(available+' ORDER BY w.priority,w.action_date DESC,w.first_seen_at DESC,w.id LIMIT ?')
    .bind(stamp,stamp,Math.max(1,limit-2));
  const oldestSEC = DB.prepare(available+' AND w.is_sec=1 ORDER BY w.first_seen_at,w.id LIMIT 2').bind(stamp,stamp);
  const groups=await DB.batch([due,priority,oldestSEC]);
  const rows=groups.flatMap(group=>group.results || []);
  return [...new Map(rows.map(row=>[row.id,row])).values()].slice(0,limit);
}
