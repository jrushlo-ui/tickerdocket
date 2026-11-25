// These source modules have no external dependencies; preserve one deployable ES module.
const fs=require('node:fs');
const modules=['edition-health.mjs','source-evidence.mjs','regulatory-discovery.mjs','morning-brief.mjs','worker.js'];
const output=process.argv[2];
if(!output) throw Error('Provide the output path');
const source=modules.map(name=>'// '+name+'\n'+fs.readFileSync(name,'utf8')
  .replace(/^import .*;\r?\n/gm,'')
  .replace(/^export (?=(?:async )?function|const )/gm,'')
  .replace(/export\s*\{[\s\S]*$/,'')).join('\n');
fs.writeFileSync(output,source+'\nexport { worker_default as default, publish, selectEditionCutoff, status };\n');
