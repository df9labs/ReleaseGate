export const suiteOutcomes = ['passed', 'failed', 'flaky', 'skipped', 'incomplete'] as const;
export type SuiteCase = { name: string; outcome: (typeof suiteOutcomes)[number] };
export const suiteCaseLimit = 250;
export const suiteCaseNameLimit = 240;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Playwright JSON report.');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('The report is missing a Playwright results list.');
  return value;
}
function outcome(test: Record<string, unknown>): SuiteCase['outcome'] {
  const attempts = list(test.results).map((attempt) => record(attempt).status);
  const last = attempts.at(-1);
  if (test.status === 'skipped' || last === 'skipped') return 'skipped';
  if (test.expectedStatus !== 'passed' || !last || last === 'interrupted') return 'incomplete';
  if (last === 'failed' || last === 'timedOut') return 'failed';
  if (last !== 'passed') return 'incomplete';
  if (test.status === 'flaky' || attempts.slice(0,-1).some((status) => status !== 'passed')) return 'flaky';
  return test.status === 'expected' ? 'passed' : 'incomplete';
}

// Only case titles, project labels and verdicts leave the file picker. A report
// can also contain credentials in its configuration, screenshots and console logs.
export function parsePlaywrightReport(raw: unknown): SuiteCase[] {
  const report = record(raw);
  const pending = [...list(report.suites)].reverse();
  const cases: SuiteCase[] = [];
  function add(name: string, value: SuiteCase['outcome']) {
    if (cases.length >= suiteCaseLimit) throw new Error('Import at most 250 test cases per review.');
    if (!name.trim() || name.length > suiteCaseNameLimit) throw new Error('Each test title including its project must be 1–240 characters.');
    cases.push({ name: name.trim(), outcome: value });
  }
  while (pending.length) {
    const suite = record(pending.pop());
    for (const item of list(suite.specs)) {
      const spec = record(item);
      if (typeof spec.title !== 'string' || !spec.title.trim()) throw new Error('A test is missing its title.');
      const tests = list(spec.tests);
      if (!tests.length) add(spec.title, 'incomplete');
      for (const entry of tests) {
        const test = record(entry);
        const project = typeof test.projectName === 'string' && test.projectName.trim();
        add(project ? spec.title + ' (' + project + ')' : spec.title, outcome(test));
      }
    }
    if (suite.suites !== undefined) {
      const children = list(suite.suites);
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
  }
  if (list(report.errors).length) add('Test runner reported an error outside a test case', 'failed');
  if (!cases.length) throw new Error('No test cases or runner errors were recorded in this report.');
  return cases;
}
