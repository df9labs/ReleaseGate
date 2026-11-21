import { expect, test, type Page } from '@playwright/test';
import type { Healthcheck, HealthcheckInput } from '../../src/api';

const history = (page: Page) => page.getByRole('combobox', { name: 'Healthcheck history' });
const rerun = (page: Page) => page.getByRole('button', { name: 'Rerun healthcheck', exact: true });
const waitForRun = (page: Page) => page.waitForResponse((response) =>
  response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/healthchecks'),
  { timeout: 0 },
);

async function saveRun(page: Page, settings: Partial<HealthcheckInput>): Promise<Healthcheck> {
  const response = await page.request.post('/api/healthchecks', {
    data: { ...settings, authorization_attested: true },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).run;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Healthcheck', exact: true })).toBeVisible();
});

test('one click repeats the selected sample and its button checks using fresh evidence', async ({ page }) => {
  const previous = await saveRun(page, {
    sample_site: true,
    follow_links: true,
    max_pages: 12,
    browser_checks: true,
    button_journeys: [{ button: 'Show release notes', expected_text: 'Preview build approved' }],
    target_name: 'Release-note controls',
    target_type: 'website',
    environment: 'live',
    current_version: '7.3',
    scope_notes: 'Check the release notes disclosure.',
    supplied_evidence: 'PASS: An operator saw the previous build complete its release-notes journey.',
    suite_results: [{ name: 'Previous build only', outcome: 'passed' }],
  });
  await saveRun(page, { suite_results: [{ name: 'Different review', outcome: 'skipped' }] });
  await page.goto('/healthcheck');
  await history(page).selectOption(previous.id);
  const oldHistory = await history(page).locator('option').count();
  await page.getByRole('button', { name: 'Edit and rerun', exact: true }).click();
  await expect(page.getByLabel('Page limit')).toHaveValue('12');
  await expect(page.getByLabel('Button name', { exact: true })).toHaveValue('Show release notes');
  await expect(page.getByLabel('Expected visible text', { exact: true })).toHaveValue('Preview build approved');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(history(page)).toHaveValue(previous.id);
  const write = waitForRun(page);
  await rerun(page).click();
  await expect(page.getByRole('button', { name: 'Rerunning…', exact: true })).toBeDisabled();
  const saved = await write;
  expect(saved.status()).toBe(201);
  const fresh: Healthcheck = (await saved.json()).run;
  expect(fresh.id).not.toEqual(previous.id);
  expect(fresh.healthcheck_number).not.toEqual(previous.healthcheck_number);
  expect(fresh).toMatchObject({
    sample_site: true,
    check_source: 'sample',
    target_url: previous.target_url,
    target_name: previous.target_name,
    target_type: previous.target_type,
    environment: previous.environment,
    current_version: previous.current_version,
    scope_notes: previous.scope_notes,
    follow_links: true,
    max_pages: 12,
    browser_checks: true,
    button_journeys: previous.button_journeys,
  });
  expect(fresh.inspected_pages).toHaveLength(2);
  expect(fresh.checks_performed).toContainEqual(expect.objectContaining({
    title: 'Button: Show release notes', source: 'browser', passed: true,
  }));
  expect(fresh.checks_performed?.filter((check) => ['suite', 'supplied'].includes(check.source))).toEqual([]);
  await expect(history(page)).toHaveValue(fresh.id);
  await expect(history(page).locator('option')).toHaveCount(oldHistory + 1);
  const original = await page.request.get('/api/healthchecks/' + previous.id);
  expect((await original.json()).run).toEqual(previous);
});

test('an evidence-only rerun keeps its settings and accepts a fresh observation', async ({ page }) => {
  const previous = await saveRun(page, {
    target_name: 'Member settings',
    target_type: 'internal_tool',
    environment: 'live',
    current_version: '8.1',
    scope_notes: 'Verify profile edits in the live build.',
    supplied_evidence: 'PASS: The operator reopened the profile and verified the saved display name.',
    suite_results: [{ name: 'Previous profile check', outcome: 'passed' }],
  });
  await page.goto('/healthcheck');
  await history(page).selectOption(previous.id);
  await rerun(page).click();
  await page.reload();
  await expect(page.getByLabel(/^Target name/)).toHaveValue(previous.target_name);
  await expect(page.getByLabel('Product type')).toHaveValue(previous.target_type);
  await expect(page.getByLabel('Environment', { exact: true })).toHaveValue(previous.environment);
  await expect(page.getByLabel('Version / build')).toHaveValue(previous.current_version!);
  await expect(page.getByLabel('Scope notes')).toHaveValue(previous.scope_notes!);
  const observations = page.getByLabel(/^Manual evidence/);
  await expect(observations).toHaveValue('');
  await expect(page.getByLabel('Playwright JSON report')).toHaveValue('');
  await page.getByRole('checkbox', { name: /I own or manage/ }).check();
  const submit = page.getByRole('button', { name: 'Run healthcheck', exact: true });
  await expect(submit).toBeDisabled();
  const newObservation = 'FAIL: Reopening the account settings on this build reverted the saved display name.';
  await observations.fill(newObservation);
  const write = waitForRun(page);
  await submit.click();
  const saved = await write;
  expect(saved.status()).toBe(201);
  const fresh: Healthcheck = (await saved.json()).run;
  expect(fresh.id).not.toEqual(previous.id);
  expect(fresh.checks_performed).toHaveLength(1);
  expect(fresh.checks_performed?.[0]).toMatchObject({ source: 'supplied', passed: false });
  expect(fresh.supplied_evidence).toBe(newObservation);
  await expect(history(page)).toHaveValue(fresh.id);
});
