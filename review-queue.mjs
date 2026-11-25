import { issuerDirectory,verifyDisclosure } from './disclosure-review.mjs';
import { ensurePipeline } from './pipeline-store.mjs';

const reviewPriority = `CASE WHEN c.source LIKE '%newsroom' AND c.source!='CMS newsroom' THEN 0
  WHEN c.source IN ('FDA drugs','FDA biologics','FDA press-releases') AND (c.title LIKE 'FDA approv%' OR c.title LIKE '%response letter%') THEN 1
  WHEN c.source IN ('Company releases','Business Wire Health','PR Newswire Health') THEN 2
  WHEN c.source LIKE 'SEC %' THEN 4 ELSE 3 END`;
function attemptRow(DB,row,result,stamp,next) {
  return DB.prepare(`INSERT INTO review_attempts(candidate_id,attempted_at,outcome,detail,next_at)
    VALUES(?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET attempted_at=excluded.attempted_at,
    outcome=excluded.outcome,detail=excluded.detail,next_at=excluded.next_at,attempts=review_attempts.attempts+1`)
    .bind(row.id,stamp,result.outcome,JSON.stringify(result.detail),next);
}
function coverageDuplicate(result,existing,row) {
  const related=existing.filter(x=>x.ticker===result.ticker && x.id!==row.id && x.action_date===row.action_date);
  const urls=[row.source_url,result.impact_evidence_url];
  const literal=related.find(x=>[x.source_url,x.impact_evidence_url,x.company_evidence_url].some(u=>urls.includes(u)) ||
    x.title.toLowerCase()===result.title.toLowerCase());
  if (literal) return {outcome:'duplicate',detail:{reason:'Same primary release or headline already verified',candidate:literal.id}};
  const comparable=related.find(x=>x.event_type===result.event_type);
  if (comparable) return {outcome:'editor_review',detail:{reason:'Another record for the same issuer, action type and date needs comparison',candidate:comparable.id}};
  return result;
}
export async function reviewPending(DB,at=new Date(),fetcher=fetch,limit=7) {
  await ensurePipeline(DB);
  const stamp=at.toISOString(),lease=new Date(at.getTime()+150000).toISOString();
  const lock = await DB.prepare(`INSERT INTO pipeline_state(key,value) VALUES('review-lease',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE pipeline_state.value<=?`).bind(lease,stamp).run();
  if (!lock.meta?.changes) return {busy:true};
  try {
    const select = `SELECT c.*,a.attempts FROM candidates c LEFT JOIN review_attempts a ON c.id=a.candidate_id
      WHERE c.status='pending' AND c.id LIKE 'lead:%' AND c.first_seen_at<=?
      AND (a.candidate_id IS NULL OR a.next_at<=?)`;
    const read = (where,order,n) => DB.prepare(select+' '+where+' ORDER BY '+order+' LIMIT ?').bind(stamp,stamp,n).all();
    const priority=await read('',reviewPriority+',c.action_date DESC,c.first_seen_at DESC,c.id',Math.max(1,limit-2));
    const older=await read("AND c.source LIKE 'SEC %'",'c.first_seen_at,c.id',2);
    const rows=[...new Map([...(priority.results||[]),...(older.results||[])].map(x=>[x.id,x])).values()].slice(0,limit);
    if (!rows.length) return {examined:0};
    const directory=await issuerDirectory(fetcher);
    const since=rows.map(x=>x.action_date).filter(Boolean).sort()[0] || stamp.slice(0,10);
    const existing=(await DB.prepare("SELECT id,title,source_url,impact_evidence_url,company_evidence_url,ticker,event_type,action_date FROM candidates WHERE status='verified' AND action_date>=?").bind(since).all()).results || [];
    const counts={examined:0,verified:0,duplicate:0,excluded:0,editor_review:0,retry:0};
    for (const row of rows) {
      let result,next=null;
      try {
        result=await verifyDisclosure(row,directory,fetcher);
        if (result.outcome==='verified') result=coverageDuplicate(result,existing,row);
      } catch (error) {
        result={outcome:'retry',detail:{reason:String(error.message || error).slice(0,350)}};
        next=new Date(at.getTime()+Math.min(24*60,15*2**Math.min(7,row.attempts||0))*60000).toISOString();
      }
      const writes=[];
      if (result.outcome==='verified') {
        writes.push(DB.prepare(`UPDATE candidates SET status='verified',title=?,ticker=?,issuer=?,agency=?,event_type=?,
          company_evidence_url=?,impact_evidence_url=?,impact_note=?,approval_method='primary-document',approved_at=?
          WHERE id=? AND status='pending'`).bind(result.title,result.ticker,result.issuer,result.agency,result.event_type,
          result.company_evidence_url,result.impact_evidence_url,result.impact_note,stamp,row.id));
      } else if (result.outcome==='duplicate' || result.outcome==='excluded') {
        writes.push(DB.prepare("UPDATE candidates SET status='rejected',approval_method=?,approved_at=? WHERE id=? AND status='pending'")
          .bind('auto-'+result.outcome,stamp,row.id));
      }
      writes.push(attemptRow(DB,row,result,stamp,next));
      const saved=await DB.batch(writes);
      if (writes.length===1 || saved[0].meta?.changes) {
        counts[result.outcome]++;
        if (result.outcome==='verified') existing.push({...row,...result});
      }
      counts.examined++;
    }
    return counts;
  } finally {
    await DB.prepare("DELETE FROM pipeline_state WHERE key='review-lease' AND value=?").bind(lease).run();
  }
}
