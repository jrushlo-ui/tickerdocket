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
  [context.matchPublicIssuer('B·R·A·H·M·S GmbH (part of Thermo Fisher Scientific)')?.ticker, 'TMO', 'parent named by applicant'],
  [context.matchFederalIssuer({ title: 'Institution of Section 206 Proceeding: ConocoPhillips Co.' })?.ticker, 'COP', 'Federal Register direct issuer'],
  [context.matchFederalIssuer({ title: 'Proposed Rule Changes: Cboe BYX Exchange, Inc.' })?.ticker, 'CBOE', 'Federal Register named subsidiary'],
  [context.matchFederalIssuer({ title: 'Special Conditions: Gulfstream Aerospace Corporation, Model G400' })?.ticker, 'GD', 'Federal Register named operating company'],
  [context.matchFederalIssuer({ title: 'Sunshine Act meeting notice' }), null, 'Federal Register unmatched title'],
  [context.expectsFreshSourceCheck({ hour: 23, minute: 30 }), false, 'overnight monitoring pause'],
  [context.expectsFreshSourceCheck({ hour: 9, minute: 0 }), true, 'active monitoring window']
];
for (const [actual, expected, label] of tests) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
console.log(`Passed ${tests.length} editorial pipeline smoke tests.`);

