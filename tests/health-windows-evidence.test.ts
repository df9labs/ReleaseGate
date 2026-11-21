import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopInspection } from '../src/api';
import { completeHealthcheck, prepareDesktopInspection, prepareHealthcheck } from '../server/healthchecks';
import { healthcheckDocument } from '../server/health-pdf-document';
import { HttpError } from '../server/support';

const inspection: DesktopInspection = {
  application: 'Indie Studio.exe',
  captured_at: '2026-01-17T14:02:03.000Z',
  buttons: [
    { name: 'Open <project>', enabled: true },
    { name: 'Import', enabled: true },
    { name: 'Settings', enabled: true },
    { name: 'Help', enabled: false },
    { name: '', enabled: true },
  ],
  checks: [],
  limitations: ['Only the selected window was inspected.'],
};

function review(desktop: DesktopInspection) {
  const prepared = prepareHealthcheck({ authorization_attested: true, desktop_inspection: desktop });
  return completeHealthcheck(prepared, 'HC-1010');
}

test('Windows inventory records every discovered button while counting zero functional passes', () => {
  const run = review(inspection);
  assert.equal(run.check_source, 'desktop');
  assert.equal(run.target_type, 'internal_tool');
  assert.equal(run.target_name, inspection.application);
  assert.equal(run.band, 'not_scored');
  assert.equal(run.evidence_coverage, 0);
  assert.deepEqual(run.checks_performed, []);
  assert.deepEqual(run.desktop_inspection, inspection);
  assert.deepEqual(run.category_scores.map(c => [c.id, c.total_checks, c.completed_checks]), [['desktop_functions', 0, 0]]);
  assert.deepEqual(run.inspected_pages, []);
  const html = healthcheckDocument(run);
  assert.match(html, /Inventory only · no actions tested/);
  assert.match(html, /Open &lt;project&gt;/);
  assert.match(html, /Help<\/td><td>Disabled/);
  assert.match(html, /Unnamed button/);
  assert.doesNotMatch(html, /URLs checked|Page limit|Website response/);
});

test('Windows passes, failures and inconclusive checks each reflect an individual expected change', () => {
  const run = review({ ...inspection, checks: [
    { button: 'Open <project>', expected: 'Project details', outcome: 'passed' },
    { button: 'Import', expected: 'Choose a file', outcome: 'failed' },
    { button: 'Settings', expected: 'Language', outcome: 'inconclusive', detail: 'The expected control was already visible.' },
  ] });
  assert.deepEqual(run.checks_performed?.map(c => [c.source, c.passed]), [['desktop', true], ['desktop', false], ['desktop', null]]);
  assert.match(run.checks_performed![2].detail, /already visible/);
  assert.equal(run.category_scores[0].completed_checks, 2);
  assert.equal(run.readiness_indicator, 50);
  assert.equal(run.findings.length, 1);
  assert.equal(run.findings[0].affected_area, inspection.application);
  assert.match(run.findings[0].evidence_summary, /Choose a file/);
  assert.equal(run.not_tested_count, 1);
  const html = healthcheckDocument(run);
  assert.match(html, /1 functional check failed/);
  assert.match(html, /Windows UI Automation/);
  assert.match(html, /The expected control was already visible/);
});

test('Windows capture validates bounds, timestamps, provenance fields and file names', () => {
  const invalid = (err: unknown) => err instanceof HttpError && err.statusCode === 422;
  for (const edits of [
    { application: 'C:\\Builds\\Studio.exe' }, { captured_at: 'February 31' },
    { buttons: Array(101).fill(inspection.buttons[0]) }, { buttons: [{ name: 'Save', enabled: 'yes' }] },
    { buttons: [{ name: 'x'.repeat(161), enabled: true }] }, { checks: Array(9).fill({}) },
    { checks: [{ button: 'Save', expected: 'Saved', outcome: 'unknown' }] },
    { limitations: ['x'.repeat(513)] },
  ]) assert.throws(() => prepareDesktopInspection({ ...inspection, ...edits }), invalid);
  for (const edits of [
    { target_type: 'website' }, { target_url: 'https://example.com' }, { sample_site: true },
    { suite_results: [{ name: 'X', outcome: 'passed' }] }, { supplied_evidence: 'An observation' },
    { button_journeys: [{ button: 'X', expected_text: 'Y' }] },
  ]) assert.throws(() => prepareHealthcheck({ authorization_attested: true, desktop_inspection: inspection, ...edits }), invalid);
  assert.deepEqual(prepareDesktopInspection({ ...inspection, local_path: 'private', buttons: [
    { ...inspection.buttons[0], file_path: 'private' }, ...inspection.buttons.slice(1),
  ] }), inspection);
});
