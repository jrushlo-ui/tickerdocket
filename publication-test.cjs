const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {DB,db}=require('./test-d1.cjs').editorialD1();
db.exec(`CREATE TABLE subscribers(id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE email_queue(edition_id INTEGER,subscriber_id INTEGER,status TEXT,UNIQUE(edition_id,subscriber_id));
 CREATE TABLE related_news(candidate_id TEXT,published_at TEXT,verified_at TEXT);
 CREATE TABLE company_mappings(applicant_norm TEXT);
 INSERT INTO subscribers VALUES(1,'active');`);
const os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tickerdocket-publication-'));
const bundle=path.join(dir,'worker.mjs');
require('node:child_process').execFileSync(process.execPath,['build-worker.cjs',bundle]);
const root=fs.readFileSync(bundle,'utf8').replace(/^export \{[^\n]*$/m,'');
const ctx=vm.createContext({console,Response,Request,Headers,URL,Date,Map,Set,Intl,crypto,TextEncoder,TextDecoder,Blob,CompressionStream,DecompressionStream,AbortSignal,AbortController,FormData,setTimeout,clearTimeout,fetch(){throw Error('No network allowed');}});
vm.runInContext(root,ctx);
fs.rmSync(dir,{recursive:true,force:true});
async function run() {
 await ctx.ensurePipeline(DB);
 const now='2026-11-25T14:00:00.000Z',day='2026-11-25';
 ctx.nowISO=()=>now;
 const keys=vm.runInContext('EXPECTED_SOURCES',ctx);
 for(const source of keys) db.prepare('INSERT INTO sync_runs(source,started_at,ended_at,status) VALUES(?,?,?,?)').run(source,now,now,'ok');
 const add=db.prepare(`INSERT INTO candidates(id,source,source_url,title,agency,event_type,action_date,first_seen_local,first_seen_at,status,
 ticker,issuer,company_evidence_url,impact_evidence_url,impact_note,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const row=n=>['test:'+n,'FDA drugs','https://www.fda.gov/'+n,'Sample '+n,'FDA','FDA approval',day,day,now,'verified','EX','Example Inc.','https://www.sec.gov/','https://www.fda.gov/'+n,'Documented and verified issuer and impact for the sample.',now];
 for(let i=0;i<155;i++) add.run(...row(i));
 // Failure inside the transaction must roll back the edition header, all items and mail queue.
 db.exec("CREATE TRIGGER fail_publication BEFORE INSERT ON edition_items WHEN NEW.candidate_id='test:2' BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
 await assert.rejects(ctx.publish({DB},'morning',{day}),/simulated failure/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM editions').get().n,0);
 db.exec('DROP TRIGGER fail_publication');
 const pub=await ctx.publish({DB},'morning',{day});
 assert.equal(pub.items,155);assert.equal(db.prepare('SELECT COUNT(*) n FROM edition_items').get().n,155);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM email_queue').get().n,1);
 assert((await ctx.publish({DB},'morning',{day})).already_published);
 const later=row('later');later[8]='2026-11-25T15:00:00.000Z';later[15]=later[8];add.run(...later);
 const env={DB,TURNSTILE_SITE_KEY:'public-key',TURNSTILE_SECRET:'test',EMAIL_POSTAL_ADDRESS:'test',BREVO_API_KEY:'test',EMAIL_LINK_SECRET:'test'};
 const api=await (await ctx.feed(new Request('https://tickerdocket.com/api/feed'),env)).json();assert.equal(api.items.length,155);
 const home=await ctx.renderHome(new Request('https://tickerdocket.com/'),env);assert.equal(home.status,200);
 const html=await home.text();assert(html.includes('id="since-edition"'));assert(html.includes('test%3Alater'));assert(html.includes('18 of 18 sources checked'));assert(html.includes('data-sitekey="public-key"'));
 assert.equal((await ctx.article(new Request('https://tickerdocket.com/story/test%3Alater'),env)).status,200);
 assert.equal((await ctx.article(new Request('https://tickerdocket.com/story/never-published'),env)).status,404);
 const index=await (await ctx.sitemap(env)).text();assert(index.includes('test%3Alater'));
 const off=await ctx.renderHome(new Request('https://tickerdocket.com/'),{DB});assert((await off.text()).includes('data-sitekey=""'));
 console.log('Passed atomic publication and retry, 155-item retrieval, queue-once, real-time story, homepage coverage, signup configuration and sitemap integration.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
