export const EXPECTED_SOURCES = ['federal', '510k', 'pma', 'FDA biologics', 'FDA drugs',
  'FDA press-releases', 'FDA recalls', 'CMS newsroom', 'Company releases', 'SEC 8-K', 'SEC 6-K'];

export function describeCoverage(rows, at) {
  const cutoff = Date.parse(at);
  const bySource = new Map();
  for (const row of rows) {
    const ended = Date.parse(row.ended_at);
    if (!Number.isFinite(ended) || ended > cutoff) continue;
    const previous = bySource.get(row.source);
    if (!previous || ended > Date.parse(previous.ended_at) || ended === Date.parse(previous.ended_at) && row.id > previous.id) {
      bySource.set(row.source, row);
    }
  }
  const checks = EXPECTED_SOURCES.map(source => {
    const row = bySource.get(source);
    const age = row ? cutoff - Date.parse(row.ended_at) : Infinity;
    const fresh = age >= 0 && age < 75 * 60000;
    return { source, run_id: row?.id ?? null, ended_at: row?.ended_at ?? null,
      status: !row ? 'missing' : !fresh ? 'stale' : row.status,
      seen_count: row?.seen_count ?? null, error: row?.error ?? null };
  });
  const status = checks.every(x => x.status === 'ok') ? 'checked'
    : checks.some(x => ['ok', 'partial'].includes(x.status)) ? 'partial' : 'incomplete';
  return { status, as_of: at, checks };
}

export function editionOutcome(count, coverage, pending) {
  if (count) return 'published';
  if (pending) return 'verification_pending';
  return coverage === 'checked' ? 'no_new_verified_items' : 'source_checks_incomplete';
}

export function editionNotice(edition) {
  let audit;
  try { audit = JSON.parse(edition?.notes || '{}'); } catch { audit = {}; }
  if (audit.pending_review_count) return `${audit.pending_review_count} discovered leads await verification. Zero verified findings does not establish that no qualifying stories occurred.`;
  return edition?.scan_status === 'checked' ? 'No new verified findings in this edition.' : 'Source checks were incomplete for this edition.';
}
