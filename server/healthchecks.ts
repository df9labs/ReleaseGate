import type { DesktopInspection, Healthcheck, Finding, HealthcheckInput, HealthObservation } from '../src/api';
import { choice, ensure, httpUrl, textField, uid, now, digest, type Fields } from './support';
import type { Check, ReviewEvidence } from './health-pages';
import { suiteOutcomes, suiteCaseLimit, suiteCaseNameLimit } from '../src/health-suite';

const categories = [
  ['core_journeys', 'Core journeys'],
  ['access_data', 'Access & data'],
  ['reliability', 'Reliability'],
  ['usability', 'UX & accessibility'],
  ['release_evidence', 'Release evidence'],
] as const;
const inspectionCategories = [
  ['seo', 'Technical SEO'],
  ['html', 'HTML structure'],
  ['browser_functions', 'Browser functions'],
  ['suite_functions', 'Staging test results'],
] as const;

function categoryScores(checks: Pick<Check, 'category' | 'passed'>[], desktop = false) {
  const present = inspectionCategories.filter(([id]) => checks.some((c) => c.category === id));
  const groups = desktop ? [['desktop_functions', 'Windows button checks']] : [...categories, ...present];
  return groups.map(([id, label]) => {
    const group = checks.filter((c) => c.category === id),
      tested = group.filter((c) => c.passed !== null);
    return {
      id,
      label,
      total_checks: group.length,
      completed_checks: tested.length,
      score: tested.length ? Math.round((100 * tested.filter((c) => c.passed).length) / tested.length) : 0,
      coverage: group.length ? Math.round((100 * tested.length) / group.length) : 0,
      status: tested.length ? 'Measured' : 'Not tested',
    };
  });
}

// The first local reader stored observations without category IDs. Its website checks
// covered only the HTTP response and the delivered markup, and included no browser journeys.
const legacyHttpTitles = new Set([
  'Page responded successfully',
  'Page returned an unsuccessful HTTP status',
  'Page could not be reached',
  'Page could not be inspected',
]);
function legacyCategory(check: HealthObservation) {
  if (check.source === 'supplied') return 'release_evidence';
  return legacyHttpTitles.has(check.title) ? 'reliability' : 'usability';
}

export function withLocalCheckCategories(run: Healthcheck): Healthcheck {
  if (
    (run.check_source !== 'website' && run.check_source !== 'sample') ||
    !run.checks_performed?.some((check) => !check.category)
  ) return run;
  const checks = run.checks_performed.map((check) => ({
    ...check,
    category: check.category ?? legacyCategory(check),
  }));
  return { ...run, checks_performed: checks, category_scores: categoryScores(checks) };
}

export function prepareDesktopInspection(value: unknown): DesktopInspection {
  function record(input: unknown): Fields {
    ensure(input && typeof input === 'object' && !Array.isArray(input), 422, 'Invalid Windows inspection.');
    return input as Fields;
  }
  const input = record(value);
  const application = textField(input, 'application', true, 255);
  ensure(/\.exe$/i.test(application) && !/[\\/:*?"<>|\x00-\x1f]/.test(application), 422,
    'Use the Windows executable file name without a folder path.');
  let capturedAt: string | undefined;
  if (input.captured_at !== undefined) {
    const stamp = textField(input, 'captured_at', true, 24);
    const date = new Date(stamp);
    ensure(Number.isFinite(date.getTime()) && stamp === date.toISOString(), 422, 'Invalid Windows capture time.');
    capturedAt = stamp;
  }
  ensure(Array.isArray(input.buttons) && input.buttons.length <= 100, 422, 'A Windows inspection may contain up to 100 buttons.');
  const buttons = input.buttons.map(value => {
    const button = record(value);
    ensure(typeof button.enabled === 'boolean' && typeof button.name === 'string', 422, 'Invalid Windows button.');
    return { name: textField(button, 'name', false, 160), enabled: button.enabled };
  });
  ensure(Array.isArray(input.checks) && input.checks.length <= 8, 422, 'A Windows inspection may contain up to eight button checks.');
  const checks = input.checks.map(value => {
    const check = record(value);
    const detail = textField(check, 'detail', false, 512);
    return {
      button: textField(check, 'button', true, 160),
      expected: textField(check, 'expected', true, 160),
      outcome: choice(check.outcome, ['passed', 'failed', 'inconclusive'] as const, 'Windows check outcome'),
      ...(detail && { detail }),
    };
  });
  ensure(Array.isArray(input.limitations) && input.limitations.length <= 16, 422, 'A Windows inspection may contain up to 16 limitations.');
  const limitations = input.limitations.map(note => textField({ note }, 'note', true, 512));
  return { application, ...(capturedAt && { captured_at: capturedAt }), buttons, checks, limitations };
}

export function prepareHealthcheck(body: Fields): HealthcheckInput {
  ensure(body.authorization_attested === true, 422, 'Confirm authorisation for this review.');
  for (const flag of ['sample_site', 'follow_links', 'browser_checks'])
    ensure(body[flag] === undefined || typeof body[flag] === 'boolean', 422, 'Choose a valid review option.');
  const sample = body.sample_site === true;
  const maxPages = body.max_pages === undefined ? 4 : body.max_pages;
  ensure(typeof maxPages === 'number' && Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 25, 422, 'Choose a whole number of pages between 1 and 25.');
  const url = httpUrl(textField(body, 'target_url', false, 2048));
  const evidence = textField(body, 'supplied_evidence');
  const desktop = body.desktop_inspection === undefined ? undefined : prepareDesktopInspection(body.desktop_inspection);
  ensure(!sample || !url, 422, 'Choose the sample site or enter your own URL.');
  const browserChecks = Boolean(sample || url) && body.browser_checks !== false;
  const journeys = body.button_journeys === undefined ? [] : body.button_journeys;
  ensure(Array.isArray(journeys) && journeys.length <= 8, 422, 'Enter up to eight button checks.');
  ensure(!journeys.length || browserChecks, 422, 'Button checks require a website and browser checks.');
  const buttonJourneys = journeys.map((item) => {
    ensure(item && typeof item === 'object' && !Array.isArray(item), 422, 'Enter a button name and expected text.');
    return { button: textField(item, 'button', true, 160), expected_text: textField(item, 'expected_text', true, 240) };
  });
  const pairs = buttonJourneys.map((journey) => JSON.stringify(journey));
  ensure(new Set(pairs).size === pairs.length, 422, 'Remove repeated button checks with the same expected result.');
  const suite = body.suite_results === undefined ? [] : body.suite_results;
  ensure(Array.isArray(suite) && suite.length <= suiteCaseLimit, 422, 'Import up to 250 staging test results.');
  const suiteResults = suite.map((item) => {
    ensure(item && typeof item === 'object' && !Array.isArray(item), 422, 'Invalid staging test result.');
    return { name: textField(item, 'name', true, suiteCaseNameLimit), outcome: choice(item.outcome, suiteOutcomes, 'test outcome') };
  });
  ensure(!desktop || (!url && !sample && !evidence && !suiteResults.length), 422,
    'Save a Windows inspection separately from a website, sample, staging report or manual evidence.');
  ensure(!desktop || body.target_type === undefined || body.target_type === 'internal_tool', 422,
    'Select Internal tool for a Windows inspection.');
  ensure(
    desktop || sample || url || evidence.length >= 60 || suiteResults.length,
    422,
    'Enter a public URL, choose the sample, inspect a Windows app, import a test report or supply at least 60 characters of evidence.',
  );
  return {
    sample_site: sample,
    follow_links: !desktop && body.follow_links !== false,
    max_pages: body.follow_links === false ? 1 : maxPages,
    browser_checks: browserChecks,
    button_journeys: buttonJourneys,
    suite_results: suiteResults,
    ...(desktop && { desktop_inspection: desktop }),
    target_url: url,
    target_name:
      textField(body, 'target_name') ||
      desktop?.application ||
      (sample ? 'Datum Foundry Nine sample site' : url ? new URL(url).hostname : 'Local evidence review'),
    target_type: choice(
      body.target_type ?? (desktop ? 'internal_tool' : 'web_app'),
      ['website', 'web_app', 'internal_tool', 'other'],
      'target type',
    ),
    environment: choice(body.environment ?? 'preview', ['preview', 'live', 'unknown'], 'environment'),
    current_version: textField(body, 'current_version'),
    scope_notes: textField(body, 'scope_notes'),
    supplied_evidence: evidence,
    authorization_attested: true,
  };
}

export function completeHealthcheck(
  input: HealthcheckInput,
  number: string,
  web?: ReviewEvidence,
): Healthcheck {
  const checks: Check[] = [...(web?.checks ?? [])];
  const desktop = input.desktop_inspection;
  for (const [i, test] of (desktop?.checks ?? []).entries()) {
    checks.push({
      key: 'desktop-' + i + '-' + digest(JSON.stringify([test.button, test.expected])).slice(0, 16),
      category: 'desktop_functions', title: 'Check “' + test.button + '”',
      source: 'desktop', passed: test.outcome === 'passed' ? true : test.outcome === 'failed' ? false : null,
      detail: 'Expected a newly visible element named “' + test.expected + '”. ' + (test.detail || {
        passed: 'The inspector observed the expected element after activation.',
        failed: 'The expected element did not appear during the observation.',
        inconclusive: 'The inspector could not verify this outcome.',
      }[test.outcome]),
      recommendation: 'Repeat this action in the same application state and check the expected result.',
    });
  }
  for (const [i, test] of (input.suite_results ?? []).entries()) {
    checks.push({
      key: 'suite-' + i + '-' + digest(test.name).slice(0, 16),
      category: 'suite_functions', title: test.name, source: 'suite', suite_outcome: test.outcome,
      passed: test.outcome === 'passed' ? true : test.outcome === 'failed' ? false : null,
      detail: 'Imported test outcome: ' + test.outcome + '. ReleaseGate did not execute this test or verify the target build.',
      recommendation: 'Inspect the original staging test and repeat it against the intended build.',
    });
  }
  for (const line of (input.supplied_evidence || '').split(/\r?\n/)) {
    const m = /^\s*(PASS|FAIL)\s*:\s*(.+)$/i.exec(line);
    if (m && m[2].trim()) {
      const detail = m[2].trim();
      checks.push({
        key: 'supplied-' + digest(detail).slice(0, 20),
        category: 'release_evidence',
        title: detail,
        passed: m[1].toLowerCase() === 'pass',
        detail,
        source: 'supplied',
        recommendation: 'Confirm the observation in preview.',
      });
    }
  }
  const failures = checks.filter((c) => c.passed === false),
    passes = checks.filter((c) => c.passed === true);
  const measured = passes.length + failures.length;
  // An HTTP success by itself supplies no evidence about a non-HTML page.
  const scored =
    measured > 0 &&
    (failures.length > 0 ||
      passes.some((c) => c.source !== 'website' || c.key.endsWith('-content')));
  const score = scored ? Math.round((100 * passes.length) / measured) : 0;
  const findings: Finding[] = failures.map((c, i) => {
    const detail = c.page ? c.page + ' — ' + c.detail : c.detail;
    return {
      id: uid(),
      reference: number + '-F' + String(i + 1).padStart(2, '0'),
      title: c.title.slice(0, 240),
      basis: 'observed',
      category: c.category,
      severity: 'medium',
      check_key: c.key,
      confidence: c.source === 'supplied' ? 'operator_reported' : c.source === 'suite' ? 'imported_test_result' : 'directly_observed',
      evidence_summary: detail,
      observation: detail,
      impact:
        c.source === 'supplied'
          ? 'A supplied release check failed.'
          : c.source === 'suite'
            ? 'The imported test run recorded a failure.'
          : c.source === 'desktop'
            ? 'The expected change was absent from the selected Windows application during the check.'
          : c.source === 'browser'
            ? 'The expected behaviour failed in the isolated browser replay.'
            : 'The indicated page check failed during this review.',
      affected_area: c.page || desktop?.application || 'Release proof',
      recommendation: c.recommendation,
      validation_step: 'Repeat the check and record fresh evidence.',
      converted_bug_id: null,
      converted_bug_number: null,
    };
  });
  const source = desktop ? 'desktop' : web ? (input.sample_site ? 'sample' : 'website') : 'supplied';
  const target = input.target_url ? new URL(input.target_url) : null;
  const limitations = desktop
    ? [
      'The inventory covers buttons exposed by Windows UI Automation in the selected application window. Other screens and custom-drawn controls may contain more.',
      'Only the individual checks below measure an action. A newly visible element proves only that interface change. Saving, export and other effects require separate evidence.',
      ...desktop.limitations,
    ]
    : [...(web?.limitations ?? ['This review uses evidence supplied by the operator.'])];
  if (input.suite_results?.length) limitations.push('The staging results come from an operator-selected report. Confirm its site, build and run date separately. Flaky, skipped and incomplete cases give no passing evidence.');
  return {
    ...input,
    target_url: input.sample_site ? '/healthcheck-sample/' : target ? target.origin + target.pathname : '',
    ...(target && { target_url_needs_input: /[?#]/.test(target.href) }),
    id: uid(),
    healthcheck_number: number,
    check_source: source,
    inspected_pages: web?.pages ?? [],
    checks_performed: checks.map(({ key, recommendation, ...c }) => c),
    completed_at: now(),
    status: 'completed',
    is_synthetic: !!input.sample_site,
    band: scored ? (score >= 80 ? 'strong' : score >= 50 ? 'needs_attention' : 'at_risk') : 'not_scored',
    readiness_indicator: score,
    evidence_coverage: checks.length ? Math.round((100 * measured) / checks.length) : 0,
    observed_count: findings.length,
    potential_count: 0,
    not_tested_count: checks.length || desktop ? checks.length - measured : 1,
    high_priority_count: 0,
    findings,
    resolved_findings: [],
    regressions: [],
    strengths: passes.map((c) => (c.page ? c.page + ' — ' : '') + c.title),
    limitations,
    next_steps: findings.length
      ? ['Open an observed finding to create a linked bug, then repeat the check after the fix.']
      : [desktop ? 'Inspect another screen or select a button and specify the change you expect.' : 'Record browser journey evidence or repeat the review after a change.'],
    summary:
      (desktop ? 'Inspected ' + desktop.application + '. ' + desktop.buttons.length + ' visible buttons recorded. ' : web ? 'Inspected ' + web.pages.length + ' page(s). ' : 'Supplied evidence review. ') +
      passes.length +
      ' checks passed, ' +
      failures.length +
      ' failed, ' +
      (checks.length - measured) +
      ' untested.',
    category_scores: categoryScores(checks, !!desktop),
  };
}
