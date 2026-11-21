import type { Healthcheck, HealthcheckInput } from './api';

// Older local reports sometimes recorded the removal only in their scope notes.
export function needsRerunUrl(run: Healthcheck): boolean {
  if (run.check_source === 'sample' || run.check_source === 'supplied') return false;
  if (/[?#]/.test(run.target_url || '')) return true;
  return run.target_url_needs_input ?? (run.limitations ?? []).some(
    (note) => note.startsWith('The start URL contains a query.'),
  );
}

function savedTarget(run: Healthcheck): string {
  if (!run.target_url || needsRerunUrl(run)) return '';
  try {
    const url = new URL(run.target_url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function canRerunDirectly(run: Healthcheck): boolean {
  return run.authorization_attested === true && (
    run.check_source === 'sample' || (run.check_source === 'website' && !!savedTarget(run))
  );
}

export function settingsForRerun(run: Healthcheck): HealthcheckInput {
  const sample = run.check_source === 'sample';
  const followLinks = run.follow_links ?? true;
  return {
    sample_site: sample,
    target_url: sample || run.check_source === 'supplied' ? '' : savedTarget(run),
    target_name: run.target_name ?? '',
    target_type: run.target_type || 'web_app',
    environment: run.environment || 'preview',
    current_version: run.current_version ?? '',
    scope_notes: run.scope_notes ?? '',
    follow_links: followLinks,
    max_pages: followLinks ? (run.max_pages ?? 4) : 1,
    // Local reports without this flag predate the browser runner.
    browser_checks: run.browser_checks ?? !run.check_source,
    button_journeys: (run.button_journeys ?? []).map(({button, expected_text}) => ({button, expected_text})),
    suite_results: [],
    supplied_evidence: '',
    authorization_attested: false,
  };
}
