import assert from 'node:assert/strict';
import local from './test-d1.cjs';
import { ensurePipeline } from './pipeline-store.mjs';
import { selectReviewBatch,ensureReviewWork } from './review-work.mjs';

const {db,DB}=local.editorialD1();
const cutoff='2026-11-27T15:00:00Z';
const before='2026-11-26T15:00:00Z', after='2026-11-28T15:00:00Z';
const insert=db.prepare('INSERT INTO candidates(id,source,title,first_seen_at,action_date,status) VALUES(?,?,?,?,?,?)');
const add=(id,source='SEC 8-K',title=id,seen=before,status='pending')=>insert.run(id,source,title,seen,before.slice(0,10),status);
for(let i=0;i<60;i++) add('lead:'+i,['SEC 8-K','CMS newsroom','FDA drugs','Company releases','EPA newsroom'][i%5],i%3?'FDA approval':'Study update',i%9?before:after);
add('510k:unmatched'); add('fr-unmatched'); add('pma:unmatched'); add('other:id');
await ensurePipeline(DB);
const tryRow=db.prepare("INSERT INTO review_attempts(candidate_id,attempted_at,outcome,detail,next_at) VALUES(?,?,?,'{}',?)");
for(let i=0;i<60;i+=3)tryRow.run('lead:'+i,before,i%2?'editor_review':'retry',i%2?null:(i%4?before:after));
tryRow.run('lead:11',before,'manual',before);
tryRow.run('pma:unmatched',before,'ownership_review',null);
const priority=`CASE WHEN c.source LIKE '%newsroom' AND c.source!='CMS newsroom' THEN 0
 WHEN c.source IN ('FDA drugs','FDA biologics','FDA press-releases') AND (c.title LIKE 'FDA approv%' OR c.title LIKE '%response letter%') THEN 1
 WHEN c.source IN ('Company releases','Business Wire Health','PR Newswire Health') THEN 2 WHEN c.source LIKE 'SEC %' THEN 4 ELSE 3 END`;
function original(stamp,limit) {
 const select=`SELECT c.*,a.attempts FROM candidates c LEFT JOIN review_attempts a ON c.id=a.candidate_id
 WHERE c.status='pending' AND c.id LIKE 'lead:%' AND c.first_seen_at<=? AND (a.candidate_id IS NULL OR a.next_at<=?)`;
 const read=(filter,order,n)=>db.prepare(select+' '+filter+' ORDER BY '+order+' LIMIT ?').all(stamp,stamp,n);
 const rows=[...read("AND a.outcome='retry'",'a.next_at,c.id',1),...read('',priority+',c.action_date DESC,c.first_seen_at DESC,c.id',Math.max(1,limit-2)),
 ...read("AND c.source LIKE 'SEC %'",'c.first_seen_at,c.id',2)];
 return [...new Map(rows.map(r=>[r.id,r])).values()].slice(0,limit);
}
async function verify() {
 for(const stamp of [before,cutoff,after])for(const limit of [1,2,5,7,40]){
   assert.deepEqual(await selectReviewBatch(DB,stamp,limit),original(stamp,limit));
 }
 const federal=db.prepare("SELECT id FROM candidates c WHERE c.status='pending' AND (id LIKE '510k:%' OR id LIKE 'pma:%' OR id LIKE 'fr-%') AND NOT EXISTS(SELECT 1 FROM review_attempts a WHERE a.candidate_id=c.id) ORDER BY id").all();
 assert.deepEqual(db.prepare("SELECT id FROM docket_review_work WHERE kind='federal' ORDER BY id").all(),federal);
}
await verify();
db.prepare("UPDATE candidates SET status='verified',title='Reviewed' WHERE id='lead:1'").run();
db.prepare("UPDATE candidates SET id='lead:moved',source='EPA newsroom',action_date='2026-11-27' WHERE id='lead:3'").run();
db.prepare("UPDATE review_attempts SET candidate_id='lead:moved',outcome='retry',next_at=? WHERE candidate_id='lead:3'").run(before);
db.prepare("DELETE FROM review_attempts WHERE candidate_id='pma:unmatched'").run();
db.prepare("DELETE FROM candidates WHERE id='lead:2'").run();
tryRow.run('lead:late',before,'editor_review',null);add('lead:late');
db.prepare("UPDATE candidates SET status='pending' WHERE id='lead:1'").run();
await verify();
db.prepare("DELETE FROM pipeline_state WHERE key='review-work-v1'").run();
db.prepare('DELETE FROM docket_review_work').run();
await ensureReviewWork(DB);
await ensureReviewWork(DB);
await verify();
console.log('Passed ordered review-batch parity, federal classification, retries, record changes and migration replay.');
