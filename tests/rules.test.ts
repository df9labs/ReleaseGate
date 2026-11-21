import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, newBug, prepareReport, matchesSearch, reopenRevision } from '../server/rules';
import { prepareHealthcheck, completeHealthcheck } from '../server/healthchecks';

const input = {
  title: 'Client card',
  description: 'The card stays closed.',
  affected_module: 'Dashboard',
  severity: 'medium',
} as const;
test('empty and partially proven sets produce derived counts, readiness and UTC dates', () => {
  const date = new Date('2026-11-19T00:00:00Z');
  assert.equal(metrics([], [], date).readiness, 0);
  const first = newBug(input, 'RP-1'),
    second = newBug(input, 'RP-2');
  first.status = 'awaiting_production_verification';
  first.preview_verification_status = 'passed';
  first.gate_status = 'pending';
  second.status = 'resolved';
  second.preview_verification_status = 'passed';
  second.production_verification_status = 'passed';
  second.production_verified_at = date.toISOString();
  first.reported_at = date.toISOString();
  second.reported_at = '2026-11-01T00:00:00Z';
  const result = metrics([first, second], [], date);
  assert.deepEqual(
    [
      result.total,
      result.open,
      result.resolved,
      result.manual,
      result.previewPassed,
      result.livePassed,
      result.readiness,
    ],
    [2, 1, 1, 1, 2, 1, 75],
  );
  assert.deepEqual(result.trend.at(-1), { day: '11-19', reported: 1, proven: 1 });
  assert.equal(result.severities.find((row) => row.name === 'medium')?.value, 2);
  second.production_verification_status = 'not_published';
  assert.equal(metrics([first, second], [], date).readiness, 50);
});
test('evidence revisions invalidate proof, linked releases and automation eligibility', () => {
  const bug = newBug(input, 'RP-1');
  bug.preview_verification_status = 'passed';
  bug.gate_status = 'automatic';
  bug.linked_semantic_version = '1.0.0';
  reopenRevision(bug);
  assert.equal(bug.revision, 2);
  assert.equal(bug.analysis_stale, true);
  assert.equal(bug.status, 'reopened');
  assert.equal(bug.preview_verification_status, 'not_tested');
  assert.equal(bug.gate_status, null);
  assert.equal(bug.linked_semantic_version, null);
});
test('register search uses number, title, area, route and linked semantic version', () => {
  const bug = newBug({ ...input, page_route: '/card' } as const, 'RP-28');
  bug.linked_semantic_version = '3.10.1';
  for (const term of ['rp-2', ' CLIENT ', 'dashboard', '/card', '3.10'])
    assert.equal(matchesSearch(bug, term), true);
  assert.equal(matchesSearch(bug, 'stays closed'), false);
});
test('report validation and offline healthcheck distinguish missing evidence from a pass', () => {
  assert.throws(() => prepareReport({ ...input, title: 'a'.repeat(241) }));
  assert.throws(() => prepareReport({ ...input, severity: 'none' }));
  assert.equal(prepareReport({ ...input, status: 'resolved' }).source, 'manual');
  assert.throws(() =>
    prepareHealthcheck({ target_url: 'https://example.test', authorization_attested: false }),
  );
  const empty = completeHealthcheck(
    prepareHealthcheck({
      supplied_evidence: 'The operator supplied notes on the release but did not classify any of the checks.',
      authorization_attested: true,
    }),
    'HC-1',
  );
  assert.equal(empty.band, 'not_scored');
  assert.equal(empty.findings.length, 0);
  const run = completeHealthcheck(
    prepareHealthcheck({
      authorization_attested: true,
      supplied_evidence: 'PASS: Title visible\nFAIL: Missing subtitle\nAdditional detail from the operator.',
    }),
    'HC-2',
  );
  assert.equal(run.readiness_indicator, 50);
  assert.equal(run.findings[0].title, 'Missing subtitle');
});

test('button checks require explicit observable outcomes and a bounded website review', () => {
  const input = { sample_site: true, authorization_attested: true };
  const journey = { button: ' Show notes ', expected_text: ' Details available ' };
  const run = prepareHealthcheck({ ...input, button_journeys: [journey], max_pages: 12 });
  assert.deepEqual(run.button_journeys, [{ button: 'Show notes', expected_text: 'Details available' }]);
  assert.equal(run.browser_checks, true);
  assert.equal(run.max_pages, 12);
  assert.equal(prepareHealthcheck({ ...input, follow_links: false }).max_pages, 1);
  for (const change of [
    { button_journeys: [journey], browser_checks: false }, { button_journeys: [journey, journey] },
    { button_journeys: [null] }, { button_journeys: [{}] }, { button_journeys: Array(9).fill(journey) },
    { button_journeys: [{ ...journey, button: 'b'.repeat(161) }] },
    { button_journeys: [{ ...journey, expected_text: 'e'.repeat(241) }] },
    { max_pages: 26 }, { max_pages: 0 }, { max_pages: 1.5 }, { max_pages: '12' },
  ]) assert.throws(() => prepareHealthcheck({ ...input, ...change }));
});
