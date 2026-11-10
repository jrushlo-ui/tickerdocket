const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('worker.js', 'utf8').replace(/export\s*\{[\s\S]*$/, '');
const context = vm.createContext({
  console,
  URL,
  Response,
  Headers,
  FormData,
  TextEncoder,
  AbortSignal,
  crypto,
  fetch,
  setTimeout,
  clearTimeout,
  Date,
  Map,
  Set,
  Intl
});
vm.runInContext(source, context);

const tests = [
  [context.federalNeedsReview({ title: 'Sunshine Act meeting notice', agency: 'National Science Foundation' }), false, 'irrelevant notice'],
  [context.federalNeedsReview({ title: 'Example Holdings, Inc. proposed consent order', agency: 'Federal Trade Commission' }), true, 'named company at market agency'],
  [context.federalNeedsReview({ title: 'Masimo Corporation filing', agency: 'Other' }), true, 'known public company'],
  [context.matchPublicIssuer('Masimo Corporation')?.ticker, 'MASI', 'Masimo alias'],
  [context.matchPublicIssuer('B·R·A·H·M·S GmbH (part of Thermo Fisher Scientific)')?.ticker, 'TMO', 'parent named by applicant']
];
for (const [actual, expected, label] of tests) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
console.log(`Passed ${tests.length} editorial pipeline smoke tests.`);

