import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlaywrightReport } from '../src/health-suite';
import { completeHealthcheck, prepareHealthcheck } from '../server/healthchecks';

const spec = (title: string, status: string, attempts: string[], expectedStatus = 'passed') => ({
  title, tests: [{ status, expectedStatus, projectName: 'Chrome', results: attempts.map(status => ({
    status, stdout: [{ text: 'PRIVATE-LOG' }], attachments: [{ body: 'PRIVATE-ATTACHMENT' }],
  })) }],
});
test('staging evidence preserves failures, runner errors, retries and skipped cases separately', () => {
  const raw = { errors: [{ message: 'PRIVATE-ERROR' }], config: { secret: 'PRIVATE-CONFIG' }, suites: [
    { specs: [], suites: [{ specs: [
      spec('Submit', 'expected', ['passed']), spec('Retrieve', 'unexpected', ['failed']),
      spec('Save', 'flaky', ['failed','passed']), spec('Payment', 'skipped', ['skipped']),
      spec('Known defect', 'expected', ['failed'], 'failed'), spec('Interrupted', 'unexpected', ['interrupted']),
      spec('Timeliness', 'unexpected', ['timedOut']),
    ] }] },
  ] };
  const cases = parsePlaywrightReport(raw);
  assert.deepEqual(cases.map(c => c.outcome), ['passed','failed','flaky','skipped','incomplete','incomplete','failed','failed']);
  const run = completeHealthcheck(prepareHealthcheck({ authorization_attested: true, suite_results: cases }), 'HC-1');
  assert.equal(run.findings.length, 3);
  assert.equal(run.not_tested_count, 4);
  assert.equal(run.checks_performed!.filter(c => c.passed === true).length, 1);
  assert.ok(run.findings.every(c => c.confidence === 'imported_test_result'));
  assert.equal(run.inspected_pages!.length, 0);
  assert.ok(!JSON.stringify(run).includes('PRIVATE-'));
});
test('empty, oversized or malformed test reports cannot silently become green', () => {
  for (const raw of [null, {}, { suites: [], errors: [] }, { suites: [{specs:[{}]}], errors: [] },
    { suites: [{specs:Array(251).fill(spec('test','expected',['passed']))}], errors: [] }]) {
    assert.throws(() => parsePlaywrightReport(raw));
  }
  assert.throws(() => prepareHealthcheck({authorization_attested:true, suite_results:[{name:'case',outcome:'maybe'}]}));
});
