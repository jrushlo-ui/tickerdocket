// Generate the dashboard-deployable module from the same source and templates Wrangler uses.
const fs = require('node:fs');
const output = process.argv[2];
if (!output) throw Error('Provide the output path');
const modules = ['regulatory-discovery.mjs','edition-health.mjs','source-evidence.mjs','pipeline-store.mjs','wire-collector.mjs',
  'disclosure-review.mjs','review-queue.mjs','morning-brief.mjs','worker.js'];
const templates = [['homeTemplate','dist/index.html'],['adminTemplate','dist/admin.html']]
  .map(([name,file])=>'const '+name+' = '+JSON.stringify(fs.readFileSync(file,'utf8'))+';');
const sources = modules.map(file=>'// '+file+'\n'+fs.readFileSync(file,'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^export (?=(?:async )?function|const )/gm,'')
  .replace(/^export\s*\{[\s\S]*$/m,''));
fs.writeFileSync(output,[...templates,...sources,'export { worker_default as default, publish, selectEditionCutoff, status };'].join('\n'));
