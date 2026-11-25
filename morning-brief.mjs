const site = 'https://tickerdocket.com';
const dateLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});
const subjectDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

function escapeHtml(value) {
  const symbols = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => symbols[character]);
}

function publicLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function isFda(item) {
  return /^FDA\b/i.test(item.source ?? '') || /\bFood and Drug Administration\b/i.test(item.agency ?? '');
}

function marketExposure(item) {
  const action = `${item.event_type ?? ''} ${item.title ?? ''}`;
  const note = item.impact_note ?? '';
  if (/\b(propos(?:ed|al)|draft|request for|comment period|investigation|preliminary)\b/i.test(action)) return 0;
  if (!/\b(final rule|final order|suspension|revocation|recall|ban|consent decree|license (?:grant|denial|termination))\b/i.test(action)) return 0;
  if (!/\b(halt\w*|suspend\w*|revok\w*|ban\w*|clos\w*|ceas\w*|prohibit\w*|den(?:ial|ied|ies)|grant\w*|authoriz\w*|require\w*|recall\w*|penalt\w*)\b/i.test(action)) return 0;
  if (!item.issuer || !publicLink(item.source_url) || !publicLink(item.impact_evidence_url) || !publicLink(item.company_evidence_url)) return 0;
  if (/\b(materiality (?:is )?(?:unknown|not established)|no material impact)\b/i.test(note)) return 0;
  const exposure = [...note.matchAll(/(?<![\d.,+--])(\d{1,3}(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?(?:issuer['']s\s+|company['']s\s+|its\s+)?(?:(?:annual|consolidated|quarterly|total|net)\s+){0,3}(?:revenue|sales|operating income)\b/gi)]
    .map((match) => Number(match[1])).filter((percent) => percent >= 10 && percent <= 100);
  return Math.max(0, ...exposure);
}

export function impactCategory(item) {
  const action = item.event_type ?? '';
  if (/^Possible exposure$|proposed|draft|investigation|advisory committee/i.test(action)) return 'possible';
  if (/^Direct action$|complete response letter|review extension|application acceptance|authorization|approval|clearance|recall|final order|final rule|suspension|revocation/i.test(action) || marketExposure(item)) return 'direct';
  return null;
}

export function selectMorningItems(rows, limit = 10) {
  const ranked = rows.filter((item) => item.ticker && item.issuer && item.impact_note &&
    [item.source_url, item.company_evidence_url, item.impact_evidence_url].every(publicLink))
    .map((item) => ({ ...item, fda: isFda(item), exposure: marketExposure(item), impact_category: impactCategory(item) }))
    .filter((item) => item.impact_category);
  const actionPriority = (item) => /response letter|review extension|recall/i.test(item.event_type ?? '') ? 1 : 0;
  ranked.sort((a, b) => Number(b.impact_category === 'direct') - Number(a.impact_category === 'direct') ||
    actionPriority(b) - actionPriority(a) ||
    String(b.action_date ?? '').localeCompare(String(a.action_date ?? '')) ||
    b.exposure - a.exposure ||
    String(a.ticker).localeCompare(String(b.ticker)));
  const perTicker = new Map();
  const selected = ranked.filter((item) => {
    const count = perTicker.get(item.ticker) ?? 0;
    if (count >= 2) return false;
    perTicker.set(item.ticker, count + 1);
    return true;
  });
  const firstPossible = selected.find((item) => item.impact_category === 'possible');
  const visible = selected.slice(0, limit);
  if (limit > 1 && firstPossible && !visible.includes(firstPossible)) visible[limit - 1] = firstPossible;
  return visible;
}

export function morningSubject(localDate, test = false) {
  const label = subjectDate.format(new Date(`${localDate}T12:00:00Z`)).replace(/^Nov\b/, 'Nov.');
  return `TickerDocket | ${test ? '[TEST] ' : ''}${label} Morning Brief`;
}

function evidenceLink(label, value) {
  const link = publicLink(value);
  return link ? `<a href="${escapeHtml(link)}" style="color:#00675e;font-weight:bold;text-decoration:underline">${label} ↗</a>` : '';
}

function renderStory(item) {
  const storyUrl = `${site}/story/${encodeURIComponent(item.candidate_id)}`;
  const agency = item.fda ? 'FDA' : item.source?.startsWith('Federal Register') ? 'Federal Register' : item.agency || item.source;
  const evidence = [evidenceLink(item.source === 'Issuer disclosure' ? 'Issuer disclosure' : item.fda ? 'FDA record' : 'Official record', item.source_url),
    evidenceLink('Company evidence', item.company_evidence_url)];
  if (item.impact_evidence_url !== item.company_evidence_url && item.impact_evidence_url !== item.source_url) {
    evidence.push(evidenceLink(item.exposure ? 'Financial exposure' : 'Impact evidence', item.impact_evidence_url));
  }
  return `<tr><td style="padding:14px 0;border-top:1px solid #dce5ea">
    <p style="margin:0 0 5px;color:#52647a;font:bold 11px/1.5 Consolas,monospace;letter-spacing:0.055em;text-transform:uppercase"><span style="color:#00675e;background:#eff5f6;padding:2px 5px">${escapeHtml(item.ticker)}</span> &nbsp; ${escapeHtml(agency)}${item.event_type ? ` &middot; ${escapeHtml(item.event_type)}` : ''}</p>
    <h2 style="font:bold 17px/1.28 Arial,sans-serif;margin:0 0 5px"><a href="${escapeHtml(storyUrl)}" style="color:#172438;text-decoration:none">${escapeHtml(item.title)}</a></h2>
    ${item.impact_note ? `<p style="margin:0 0 7px;font:14px/1.5 Arial,sans-serif;color:#263c51">${escapeHtml(item.impact_note)}</p>` : ''}
    <p style="margin:0;font:13px/1.5 Arial,sans-serif">${evidence.filter(Boolean).join(' &nbsp;&middot;&nbsp; ')}</p>
  </td></tr>`;
}

export function renderMorningBrief({ edition, items, unsubscribe, postalAddress, test = false }) {
  const date = dateLabel.format(new Date(`${edition.local_date}T12:00:00Z`));
  const docket = `${site}/?utm_source=morning_email&utm_medium=email&utm_campaign=${encodeURIComponent(edition.local_date)}`;
  const headline = `${items.length} verified ${items.length === 1 ? 'development' : 'developments'}`;
  const sections = [['direct', 'Directly affects'], ['possible', 'Could possibly affect']]
    .map(([category, label]) => {
      const stories = items.filter((item) => item.impact_category === category);
      return stories.length ? '<h2 style="margin:15px 0 5px;font:bold 17px Arial,sans-serif;color:#00675e">' +
        label + '</h2><table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
        stories.map(renderStory).join('') + '</table>' : '';
    }).join('');
  const incomplete = edition.scan_status !== 'checked';
  const preheader = items.length ? items[0].title : incomplete ? 'Source checks are incomplete this morning.' : 'No new developments qualified this morning.';
  const quietTitle = incomplete ? 'Source checks are incomplete' : 'No new developments qualified this morning';
  const quietText = incomplete
    ? 'Some monitored sources were unavailable when this edition was prepared. We will continue checking throughout the trading day.'
    : 'We checked our monitored feeds for new developments with documented public-company exposure. Monitoring continues through the trading day.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TickerDocket Morning Brief</title></head>
  <body style="margin:0;padding:0;background:#edf3f5;color:#172438;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:#edf3f5"><tr><td align="center" style="padding:14px 8px">
    <!--[if mso]><table role="presentation" width="620"><tr><td><![endif]-->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:620px;margin:auto;border:1px solid #dce5ea;border-radius:10px;background:#fff">
      <tr><td style="padding:21px 24px 23px;border-top:3px solid #4ed5bd;background:#0d1a2b;color:#f3f8fc">
        <p style="margin:0;font:bold 15px/1.45 Arial,sans-serif;letter-spacing:0.08em"><span style="background:#65e0ca;color:#0d1a2b;padding:4px 6px;border-radius:4px">TD</span>&nbsp; TICKER<span style="color:#69e1ca">DOCKET</span></p>
        <p style="margin:17px 0 3px;color:#92dece;font:bold 11px/1.4 Consolas,monospace;letter-spacing:0.08em">${test ? 'TEST EMAIL / ' : ''}PREMARKET / 08:00 CT</p>
        <h1 style="margin:0 0 4px;color:#f3f8fc;font:bold 32px/1.15 Arial,sans-serif">The Morning Brief</h1>
        <p style="margin:0;color:#b9c9d8;font:13px/1.4 Arial,sans-serif">${escapeHtml(date)}</p>
      </td></tr>
      <tr><td style="padding:18px 24px 23px">
        <p style="margin:0 0 10px;color:#00675e;font:bold 11px/1.4 Consolas,monospace;letter-spacing:0.08em;text-transform:uppercase">${escapeHtml(headline)}</p>
        ${incomplete && items.length ? '<p style="margin:0 0 12px;color:#52647a;font:13px/1.5 Arial,sans-serif">Some sources were unavailable when this edition was prepared.</p>' : ''}
        ${items.length ? sections : `<div style="border-top:1px solid #dce5ea;padding:13px 0"><h2 style="margin:0 0 6px;font:bold 17px/1.3 Arial,sans-serif">${quietTitle}</h2><p style="margin:0;font:14px/1.55 Arial,sans-serif;color:#263c51">${quietText} The next website edition is scheduled for 4:30 PM Central.</p></div>`}
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#087567;border-radius:6px"><a href="${escapeHtml(docket)}" style="display:inline-block;padding:10px 13px;font:bold 13px/1.35 Arial,sans-serif;text-decoration:none;color:#fff">Open the full docket ↗</a></td></tr></table>
      </td></tr>
      <tr><td style="padding:13px 24px;background:#eff5f6;color:#52647a;font:12px/1.5 Arial,sans-serif">
        <p style="margin:0 0 4px">Regulatory exposure alone doesn't establish a stock-price reaction.</p>
        <p style="margin:0">TickerDocket &middot; ${escapeHtml(postalAddress)} &nbsp;&middot;&nbsp; <a href="${escapeHtml(unsubscribe)}" style="color:#00675e;text-decoration:underline">Unsubscribe</a></p>
      </td></tr>
    </table><!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
  </body></html>`;
}

