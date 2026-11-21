import { expect, test } from '@playwright/test';
import { completeHealthcheck, prepareHealthcheck } from '../../server/healthchecks';
import type { DesktopInspection, HealthcheckInput } from '../../src/api';

test('choose a Windows application, save its inventory and collect fresh action evidence on rerun', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Healthcheck', exact: true }).click();
  await page.getByRole('button', { name: 'New healthcheck' }).click();

  const inventory: DesktopInspection = {
    application: 'Studio fixture.exe',
    buttons: [{ name: 'Open projects', enabled: true }, { name: 'Export', enabled: false }],
    checks: [], limitations: [],
  };
  const tested: DesktopInspection = {
    ...inventory, checks: [{ button: 'Open projects', expected: 'Project library', outcome: 'passed' }],
  };
  const pickerResults = [{ cancelled: true }, inventory, tested];
  await page.route('**/api/healthchecks/inspect-windows', (route) => {
    expect(route.request().postDataJSON()).toEqual({ authorization_attested: true });
    return route.fulfill({ json: pickerResults.shift() });
  });
  const saved: HealthcheckInput[] = [];
  await page.route('**/api/healthchecks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON();
    saved.push(input);
    const run = completeHealthcheck(prepareHealthcheck(input), `HC-${9500 + saved.length}`);
    return route.fulfill({ status: 201, json: { run } });
  });

  await page.getByRole('radio', { name: 'Windows desktop app (.exe)' }).check();
  await expect(page.getByLabel('Website URL')).toHaveCount(0);
  const choose = page.getByRole('button', { name: 'Choose .exe on this PC' });
  const save = page.getByRole('button', { name: 'Run healthcheck', exact: true });
  const authorised = page.getByRole('checkbox', { name: /I am authorised to inspect/ });
  await expect(choose).toBeDisabled();
  await authorised.check();
  await choose.click();
  await expect(page.getByText('Windows inspection cancelled.')).toBeVisible();
  await expect(save).toBeDisabled();
  await choose.click();
  await expect(page.getByText('Inventory only. No button action was tested.')).toBeVisible();
  await save.click();
  await expect(page.getByRole('heading', { name: 'Button inventory only' })).toBeVisible();
  expect(saved[0]).toMatchObject({ desktop_inspection: inventory, target_name: inventory.application, target_type: 'internal_tool', target_url: '' });
  await page.getByText('Buttons found (2)', { exact: true }).click();
  await expect(page.getByRole('list', { name: 'Desktop button inventory' }).getByText('Export', { exact: true })).toBeVisible();
  await expect(page.getByText('URLs checked', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Rerun healthcheck', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Windows desktop app (.exe)' })).toBeChecked();
  await expect(authorised).not.toBeChecked();
  await expect(save).toBeDisabled();
  await authorised.check();
  await expect(save).toBeDisabled();
  await choose.click();
  await expect(page.getByRole('list', { name: 'Desktop action checks' })).toContainText('Project library');
  await save.click();
  await expect(page.getByRole('heading', { name: '1 of 1 checks passed' })).toBeVisible();
  expect(saved[1].desktop_inspection).toEqual(tested);
  expect(pickerResults).toHaveLength(0);
});
