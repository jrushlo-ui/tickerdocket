// Network is deliberately absent. All writes go to a local in-memory SQLite database.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const evidence = path.resolve(process.argv[2] || '../audit/evidence');
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
const fixedAt = '2026-11-24T22:30:14.716Z';
const {DB,db}=require('./test-d1.cjs').editorialD1();
function add(table, row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
}
for (const e of read('closing.json').editions.filter(e => e.kind !== 'closing' || e.date !== '2026-11-24')) {
  add('editions',{id:e.id,local_date:e.date,kind:e.kind,published_at:e.published_at,status:e.status,scan_status:e.scan_status,qualifying_count:e.count,notes:e.notes});
}
for (const r of read('sources.json')) add('sync_runs',{id:r.id,source:r.source,started_at:r.start,ended_at:r.end,status:r.status,seen_count:r.seen,inserted_count:r.inserted,error:r.error});
for (const c of read('candidates.json')) {
  const {url,...row}=c;
  add('candidates',{...row,source_url:url});
}
const context = vm.createContext({console,URL,Response,Headers,FormData,TextEncoder,AbortSignal,crypto,Date,Map,Set,Intl,
  fetch(){throw Error('Network forbidden in historical replay');},setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(process.env.TD_FIXED_BUNDLE || path.join(evidence,'production-worker.mjs'),'utf8').replace(/export\s*\{[\s\S]*$/,''),context);
context.nowISO=()=>fixedAt;
(async()=>{
  const result=await context.publish({DB},'closing',{day:'2026-11-24'});
  assert.equal(result.items,0);
  assert.equal(result.scan_status,'partial');
  assert.equal(result.cutoff,'2026-11-24T14:00:20.723Z');
  if (process.env.TD_FIXED_BUNDLE) {
    const edition=db.prepare('SELECT * FROM editions WHERE id=30').get();
    assert.equal(edition.status,'verification_pending');
    assert(JSON.parse(edition.notes).pending_review_count>0);
    // Later runs must never change historical health or sneak future approvals into the edition.
    db.prepare("INSERT INTO sync_runs(source,started_at,ended_at,status) VALUES('Company releases','2026-11-24T23:00:00Z','2026-11-24T23:00:01Z','ok')").run();
    assert.equal(await context.sourceCoverage({DB},fixedAt),'partial');
    await context.logRun({DB},'synthetic-source',fixedAt,'ok',10,0,null);
    await context.logRun({DB},'synthetic-source',fixedAt,'ok',10,0,null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_runs WHERE source='synthetic-source'").get().n,2);
    context.discoverRegulatoryLeads=async()=>[];
    context.nowISO=()=> '2026-11-25T06:10:00Z';
    await context.scanDisclosures({DB},new Date('2026-11-25T06:10:00Z'),'2026-11-25');
    const checked=db.prepare("SELECT * FROM candidates WHERE ticker='COGT'").get();
    assert.equal(checked.first_seen_at,'2026-11-24T14:30:11.697Z');
    assert.equal(checked.status,'verified');
    assert.equal(checked.approved_at,'2026-11-25T06:10:00Z');
    const pypd=db.prepare("SELECT * FROM candidates WHERE ticker='PYPD'").get();
    assert.equal(pypd.first_seen_at,'2026-11-24T22:25:11.482Z');
    context.nowISO=()=> '2026-11-25T06:15:00Z';
    await context.scanDisclosures({DB},new Date('2026-11-25T06:15:00Z'),'2026-11-25');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM candidates WHERE ticker='COGT'").get().n,1);
    assert.equal(db.prepare("SELECT approved_at FROM candidates WHERE ticker='COGT'").get().approved_at,'2026-11-25T06:10:00Z');

  }
  const rows=read('candidates.json');
  const cogent=rows.find(x=>x.title.includes('bezuclastinib'));
  const polypid=rows.find(x=>x.title.includes('PolyPid'));
  assert.equal(cogent.status,'pending');
  assert.equal(polypid.status,'pending');
  assert(cogent.first_seen_at>result.cutoff && polypid.first_seen_at<fixedAt);
  const report={mode:'saved-record publication replay',network:false,database:':memory:',edition_at:fixedAt,
    result,loaded_candidate_rows:rows.length,limitations:['No historical raw response bodies or per-entry rejection decisions were saved.','447 saved recent candidates are a bounded subset; older pending totals come from a separate aggregate.','No historical verification is invented; later primary-source corroboration is separate.']};
  fs.writeFileSync(path.resolve(process.env.TD_FIXED_BUNDLE ? '../audit/fixed-replay-result.json' : '../audit/replay-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
