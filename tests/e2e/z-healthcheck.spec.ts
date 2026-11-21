import { expect, test } from '@playwright/test';

test('a sample-site check reads two pages and its finding opens a persisted bug', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== baseURL) externalRequests.push(url.origin);
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Healthcheck', exact: true }).click();
  const history = page.getByRole('combobox', { name: 'Healthcheck history' });
  const original = await history.inputValue();
  await page.getByRole('button', { name: 'New healthcheck' }).click();
  await expect(page).toHaveURL(/\/healthcheck\?new=1$/);
  await page.reload();
  const submit = page.getByRole('button', { name: 'Run healthcheck', exact: true });
  await page.getByRole('button', { name: 'Try a sample site' }).click();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Follow links on this site' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Run browser checks' })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Page limit' })).toHaveValue('4');
  await page.getByRole('button', { name: 'Add sample button checks' }).click();
  await expect(page.getByRole('button', { name: 'Add sample button checks' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I authorise this read-only check/ }).check();
  const completed = page.waitForResponse((res) => res.url().endsWith('/api/healthchecks') && res.request().method() === 'POST', { timeout: 0 });
  await submit.click();
  const {run} = await (await completed).json();
  const cases = run.checks_performed as {source: string; title: string; passed: boolean | null}[];
  expect(cases.find((c) => c.source === 'browser' && c.title === 'Button: Show release notes')?.passed).toBe(true);
  expect(cases.find((c) => c.source === 'browser' && c.title === 'Button: Open status')?.passed).toBe(false);
  await expect(page.getByRole('heading', { name: 'Run evidence', exact: true })).toBeVisible();
  const passed = cases.filter((c) => c.passed === true).length;
  const measured = cases.filter((c) => c.passed !== null).length;
  await expect(page.getByRole('heading', { name: '1 functional check failed' })).toBeVisible();
  await expect(page.getByText(new RegExp(`Across the review, ${passed} of ${measured} measured checks passed`))).toBeVisible();
  await expect(page.getByText('Release readiness unassessed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Core journeys: [1-9]\d* checks? measured/ })).toBeVisible();
  expect(cases.find((c) => c.title === 'Published sitemap')?.passed).toBe(true);
  expect(cases.find((c) => c.title === 'Published build or version metadata')?.passed).toBe(true);
  const recent = await history.inputValue();
  expect(recent).not.toBe(original);
  const pages = page.getByRole('list', { name: 'Pages inspected' }).getByRole('listitem');
  await expect(pages).toHaveCount(2);
  await expect(pages.filter({ hasText: 'HTTP 200' })).toHaveCount(2);
  await expect(pages.filter({ hasText: '/healthcheck-sample/guide' })).toHaveCount(1);
  await page.getByText(/^Check results \(\d+\)$/, { exact: true }).click();
  const checks = page.getByRole('list', { name: 'Check results' });
  await expect(checks.getByText('Failed', { exact: true }).first()).toBeVisible();
  await expect(checks.getByText('Passed', { exact: true }).first()).toBeVisible();
  await expect(checks.getByRole('listitem').filter({ hasText: 'Button: Open status' })).toContainText('Failed');
  await expect(checks.getByRole('listitem').filter({ hasText: 'Button: Show release notes' })).toContainText('Passed');
  await page.getByRole('button', { name: /Image missing alternative text/ }).click();
  await page.getByRole('button', { name: 'Create bug', exact: true }).click();
  const linkedBug = page.getByRole('link', { name: /^Open [A-Z0-9]+-\d+$/ });
  await expect(linkedBug).toBeVisible();
  const link = await linkedBug.getAttribute('href');
  await linkedBug.click();
  await expect(
    page.getByRole('heading', { name: 'Image missing alternative text', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Healthcheck', exact: true }).click();
  await history.selectOption(original);
  await expect(page.getByRole('heading', { name: 'Run evidence' })).toHaveCount(0);
  await expect(page.getByText('Evidence coverage', { exact: true })).toBeVisible();
  await history.selectOption(recent);
  await page.reload();
  await expect(history).toHaveValue(recent);
  await page.getByRole('button', { name: /Image missing alternative text/ }).click();
  await expect(linkedBug).toHaveAttribute('href', link!);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('a staging report can be reviewed on its own and excludes private runner output', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Healthcheck', exact: true }).click();
  await page.getByRole('button', { name: 'New healthcheck' }).click();
  const input = page.getByLabel('Playwright JSON report', { exact: true });
  const testCase = (title: string, status: string, attempts: string[]) => ({
    title, tests: [{ expectedStatus: 'passed', status, results: attempts.map(status => ({ status, stdout: [{text: 'PRIVATE-RUNNER-OUTPUT'}] })) }],
  });
  await input.setInputFiles({ name: 'staging.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    errors: [], suites: [{ specs: [testCase('Save and reopen a draft', 'expected', ['passed']), testCase('Sign in', 'flaky', ['failed','passed'])] }],
  })) });
  await expect(page.getByText('2 staging test results ready to import.')).toBeVisible();
  await page.getByRole('checkbox', { name: /I own or manage/ }).check();
  const response = page.waitForResponse(res => res.url().endsWith('/api/healthchecks') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run healthcheck', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  expect(saved.request().postData()).not.toContain('PRIVATE-RUNNER-OUTPUT');
  const {run} = await saved.json();
  expect(run.inspected_pages).toEqual([]);
  expect(run.checks_performed.map((c: {passed:boolean|null}) => c.passed)).toEqual([true,null]);
  await expect(page.getByText('Release readiness unassessed', {exact:true})).toBeVisible();
});
