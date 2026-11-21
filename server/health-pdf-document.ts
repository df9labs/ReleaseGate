import type { Healthcheck, HealthObservation, Finding } from '../src/api';
import { organisationName } from '../src/organisation';

const escapeText = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const readable = (value: string) => {
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function completionDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(date) + ' UTC';
}

function section(title: string, content: string) {
  return content ? `<section><h2>${escapeText(title)}</h2>${content}</section>` : '';
}

function list(items: string[] = []) {
  return items.length ? '<ul>' + items.map(item => `<li>${escapeText(item)}</li>`).join('') + '</ul>' : '';
}

function detail(label: string, value: string | undefined | null) {
  return value ? `<p class="detail"><b>${escapeText(label)}</b> ${escapeText(value)}</p>` : '';
}

function metric(label: string, value: number | string, tone = '') {
  return `<div class="metric ${tone}"><strong>${escapeText(value)}</strong><span>${escapeText(label)}</span></div>`;
}

const functional = (category?: string) => category === 'browser_functions' || category === 'suite_functions' || category === 'desktop_functions';

function outcome(check: HealthObservation) {
  return check.passed === true ? 'Passed' : check.passed === false ? 'Failed' : 'Inconclusive';
}

function checkRow(check: HealthObservation, category: string) {
  const label = outcome(check);
  const source = { browser: 'Isolated browser', website: 'Website response', suite: 'Imported test result', supplied: 'Operator observation', desktop: 'Windows UI Automation' }[check.source];
  const labels = [source || 'Source unspecified', category, check.suite_outcome && readable(check.suite_outcome)].filter(Boolean);
  return `<article class="check">
    <div class="check-title"><span class="badge ${label.toLowerCase()}">${label}</span><strong>${escapeText(check.title)}</strong></div>
    <p class="context">${escapeText(labels.join(' · '))}</p>
    ${check.detail && check.detail !== check.title ? `<p class="copy">${escapeText(check.detail)}</p>` : ''}
  </article>`;
}

function findingRow(finding: Finding) {
  const meta = [finding.reference, readable(finding.severity || ''), readable(finding.basis || ''),
    finding.confidence && finding.confidence !== 'not_applicable' ? readable(finding.confidence) : '',
    finding.converted_bug_number && 'Bug ' + finding.converted_bug_number].filter(Boolean);
  return `<article class="finding">
    <p class="context">${escapeText(meta.join(' · '))}</p><h3>${escapeText(finding.title)}</h3>
    ${detail('Observation', finding.observation)}
    ${finding.evidence_summary !== finding.observation ? detail('Evidence', finding.evidence_summary) : ''}
    ${detail('Area', finding.affected_area)}${detail('Impact', finding.impact)}
    ${detail('Recommendation', finding.recommendation)}
    ${finding.validation_step !== finding.recommendation ? detail('Retest', finding.validation_step) : ''}
    ${detail('Previous bug', finding.regression_of_bug_number)}
  </article>`;
}

function comparisons(run: Healthcheck) {
  const fixed = run.resolved_findings ?? [];
  const regressed = run.regressions ?? [];
  if (!run.compared_to_previous && !fixed.length && !regressed.length) return '';
  return section('Comparison with previous results',
    detail('Previous run', run.previous_healthcheck_number) +
    `<p>${fixed.length} resolved · ${regressed.length} regressed</p>` +
    fixed.map(finding => `<article class="finding"><h3>Resolved · ${escapeText(finding.title)}</h3>
      ${detail('Bug', finding.bug_number)}${detail('Before', finding.previous_evidence_summary)}
      ${detail('After', finding.resolution_evidence)}${detail('Verification limit', finding.verification_blocked_reason)}
    </article>`).join('') +
    regressed.map(finding => `<article class="finding"><h3>Regressed · ${escapeText(finding.title)}</h3>
      ${detail('Bug', finding.bug_number)}
      ${finding.previously_resolved_at ? detail('Previously resolved', completionDate(finding.previously_resolved_at)) : ''}
    </article>`).join(''));
}

function evidenceRegister(run: Healthcheck, categories: Map<string, string>) {
  const groups = new Map<string, { status?: number | null; checks: HealthObservation[] }>();
  for (const page of run.inspected_pages ?? []) groups.set(page.url, { status: page.status, checks: [] });
  for (const check of run.checks_performed ?? []) {
    const page = check.page || '';
    if (!groups.has(page)) groups.set(page, { checks: [] });
    groups.get(page)!.checks.push(check);
  }
  const rows: string[] = [];
  for (const [page, group] of groups) {
    const response = group.status === null ? 'No HTTP response' : group.status !== undefined ? 'HTTP ' + group.status : '';
    const context = [response, `${group.checks.length} recorded check${group.checks.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const heading = page || (run.check_source === 'desktop' ? 'Button actions' : 'Other recorded evidence');
    rows.push(`<div class="group-head"><h3>${escapeText(heading)}</h3><p class="context">${escapeText(context)}</p></div>`);
    for (const check of group.checks)
      rows.push(checkRow(check, categories.get(check.category || '') ?? readable(check.category || '')));
  }
  return section('Check results', rows.join(''));
}

function desktopInventory(run: Healthcheck) {
  const inspection = run.desktop_inspection;
  if (!inspection) return '';
  const caption = '<p>Each row records a button exposed to Windows on the selected screen. Enabled buttons can still fail when used.</p>';
  if (!inspection.buttons.length) return section('Button inventory', '<p>No visible buttons were exposed to the inspector.</p>');
  const rows = inspection.buttons.map(button =>
    `<tr><td>${escapeText(button.name || 'Unnamed button')}</td><td>${button.enabled ? 'Enabled' : 'Disabled'}</td></tr>`
  ).join('');
  return section('Button inventory', caption + `<table><thead><tr><th>Accessible name</th><th style="width:25%">State at capture</th></tr></thead><tbody>${rows}</tbody></table>`);
}

const styles = `
  @page { size: A4 }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10pt/1.45 Arial, "Liberation Sans", sans-serif; color: #222c32; background: white;
    print-color-adjust: exact; -webkit-print-color-adjust: exact; overflow-wrap: anywhere; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 2em;
    padding-bottom: 3mm; border-bottom: 2px solid #b95521; color: #23313a; }
  header strong { font-size: 13pt; } header span, .eyebrow, .context { color: #50606a; font-size: 8.5pt; }
  .eyebrow { font-weight: bold; text-transform: uppercase; letter-spacing: .12em; margin: 7mm 0 1mm; }
  h1, h2, h3, p { margin: 0; }
  h1 { color: #15232a; font-size: 28pt; line-height: 1.1; letter-spacing: -.035em; }
  .address { color: #4d5c65; margin-top: 1.5mm; }
  h2 { font-size: 15pt; margin: 6mm 0 2.5mm; padding-top: 2mm; border-top: 1px solid #c3cdd0; }
  h3 { font-size: 11.5pt; line-height: 1.35; }
  h1, h2, h3, .eyebrow, .check-title, .group-head, .finding > .context { break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  .meta { margin: 2.5mm 0 4mm; font-size: 9pt; color: #40505b; }
  .verdict { border-left: 3px solid #b95521; padding: 2.8mm 4mm; background: #f6f3ee; margin: 3mm 0; }
  .verdict strong { display: block; font-size: 14pt; color: #293239; }
  .verdict span { display: block; margin-top: .8mm; font-size: 9pt; }
  .metrics { display: flex; border: 1px solid #d6dee0; margin: 3mm 0 4mm; break-inside: avoid; }
  .metric { flex: 1; padding: 2.3mm 3.5mm; }
  .metric + .metric { border-left: 1px solid #d6dee0; }
  .metric strong, .metric span { display: block; }
  .metric strong { font-size: 17pt; line-height: 1.1; } .metric span { font-size: 8.4pt; color: #40505b; }
  .alert { color: #8c2924; }
  .detail, .copy, li { white-space: pre-wrap; } .detail, .copy { margin-top: 1mm; }
  .detail b { color: #43515b; padding-right: 1.5mm; }
  ul { margin: 1mm 0 2mm; padding-left: 5.2mm; } li { margin: .8mm 0; }
  .finding, .check { border-bottom: 1px solid #e0e5e7; padding: 2.2mm 0; break-inside: avoid; }
  .finding h3 { margin: .8mm 0 1.2mm; }
  .group-head { background: #eef2f3; padding: 2mm 3mm; margin-top: 3mm; break-inside: avoid; }
  .group-head h3 { font-size: 10.3pt; }
  .context { margin: .4mm 0; line-height: 1.35; }
  .check-title { line-height: 1.45; } .badge { display: inline-block; padding: .1mm 1.5mm;
    margin-right: 2mm; border-radius: 1mm; color: #344a58; background: #e9eef0; font-size: 8pt; font-weight: bold; }
  .badge.passed { color: #19563d; background: #e6f3eb; } .badge.failed { color: #80251f; background: #fae7e3; }
  .badge.inconclusive { color: #6c4a1a; background: #f4eddb; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 1.5mm 2mm; border-bottom: 1px solid #dbe2e4; }
  th { font-size: 8.5pt; color: #43515b; background: #eef2f3; } tr { break-inside: avoid; }
`;

export function healthcheckDocument(run: Healthcheck): string {
  const local = Boolean(run.check_source);
  const checks = run.checks_performed ?? [];
  const passed = checks.filter(c => c.passed === true).length;
  const failed = checks.filter(c => c.passed === false).length;
  const functionalFails = checks.filter(c => functional(c.category) && c.passed === false).length;
  const findings = [...(run.findings ?? [])].sort((a, b) => Number(functional(b.category)) - Number(functional(a.category)));
  const scores = (run.category_scores ?? []).map(row => {
    if (!local) return row;
    const labels: Record<string, string> = {
      usability: 'HTML structure', html: 'HTML quality', reliability: 'Page responses',
      release_evidence: 'Release evidence',
    };
    return { ...row, label: Object.hasOwn(labels, row.id) ? labels[row.id] : row.label };
  });
  const categories = new Map(scores.map(row => [row.id, row.label]));
  const sample = run.check_source === 'sample' || run.is_synthetic;
  const desktop = run.desktop_inspection;
  const kind = [!local && 'Historical snapshot', sample ? 'Sample data' :
    desktop ? 'Windows desktop inspection' : run.check_source === 'supplied' ? 'Supplied evidence' : run.check_source === 'website' ? 'Website review' : ''].filter(Boolean).join(' · ');
  let headline = 'No checks measured';
  if (desktop && !checks.length) headline = 'Inventory only · no actions tested';
  else if (!local) headline = 'Historical Healthcheck';
  else if (functionalFails) headline = `${functionalFails} functional check${functionalFails === 1 ? '' : 's'} failed`;
  else if (run.band === 'not_scored' && checks.length) headline = 'Insufficient evidence for a score';
  else if (passed + failed) headline = `${passed} of ${passed + failed} measured checks passed`;
  const figures = local
    ? metric('Passed', passed) + metric('Failed', failed, failed ? 'alert' : '') +
      metric('Inconclusive', checks.length - passed - failed) + (desktop ? metric('Buttons found', desktop.buttons.length) : metric('URLs checked', run.inspected_pages?.length ?? 0))
    : metric('Observed findings', run.observed_count) + metric('Potential findings', run.potential_count) +
      metric('Recorded coverage', run.evidence_coverage + '%') + metric('High priority', run.high_priority_count);
  const scope = [
    detail('Scope notes', run.scope_notes),
    desktop ? detail('Executable', desktop.application) : '',
    desktop?.captured_at ? detail('Inspection received', completionDate(desktop.captured_at)) : '',
    !desktop && run.max_pages !== undefined && run.check_source !== 'supplied' ? detail('Page limit', String(run.max_pages)) : '',
    !desktop && run.browser_checks !== undefined && run.check_source !== 'supplied' ? detail('Browser checks', run.browser_checks ? 'Enabled' : 'Switched off') : '',
    run.button_journeys?.length ? '<h3>Requested button outcomes</h3>' + list(run.button_journeys.map(journey =>
      'Activate “' + journey.button + '” and look for “' + journey.expected_text + '”.')) : '',
    list(run.limitations),
  ].join('');
  const coverage = scores.length ? section('Coverage by category', `<table>
    <thead><tr><th style="width:32%">Category</th><th style="width:19%">Checks measured</th><th>Recorded status</th></tr></thead>
    <tbody>${scores.map(c => `<tr><td>${escapeText(c.label)}</td><td>${escapeText(c.completed_checks)} of ${escapeText(c.total_checks)}</td>
    <td>${escapeText(c.status)}</td></tr>`).join('')}</tbody></table>`) : '';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${escapeText(run.healthcheck_number)} | ReleaseGate Healthcheck</title><style>${styles}</style></head><body>
    <header><strong>ReleaseGate</strong><span>${escapeText(organisationName)}</span></header>
    <p class="eyebrow">Healthcheck report · ${escapeText(run.healthcheck_number)}</p>
    <h1>${escapeText(run.target_name || 'Healthcheck')}</h1>
    ${run.target_url ? `<p class="address">${escapeText(run.target_url)}</p>` : ''}
    <p class="meta">${escapeText([kind, run.target_type && readable(run.target_type), run.environment && readable(run.environment), run.current_version && 'Build ' + run.current_version,
      (desktop ? 'Saved ' : '') + completionDate(run.completed_at)].filter(Boolean).join(' · '))}</p>
    <div class="verdict"><strong>${escapeText(headline)}</strong>
      <span>${local ? 'Release readiness unassessed. Each result applies to the evidence recorded for this run.'
        : 'This report preserves the original findings and category totals. Individual test outcomes are available only where the original run recorded them.'}</span></div>
    <div class="metrics">${figures}</div>
    ${!local && run.band && run.band !== 'not_scored' && Number.isFinite(run.readiness_indicator)
      ? detail('Archived readiness indicator', run.readiness_indicator + '/100 · ' + readable(run.band)) : ''}
    ${!local && run.summary ? `<p class="copy">${escapeText(run.summary)}</p>` : ''}
    ${section('Findings', findings.length ? findings.map(findingRow).join('') : '<p>No findings were recorded for this run.</p>')}
    ${section('Scope and limitations', scope)}${coverage}${comparisons(run)}
    ${section('Next steps', list(run.next_steps))}
    ${!local ? section('Recorded strengths', list(run.strengths)) : ''}
    ${evidenceRegister(run, categories)}
    ${desktopInventory(run)}
    </body></html>`;
}
