import { test, expect } from '@playwright/test';

test('a reported defect becomes preview proof, a human decision and a released version', async ({
  page,
  baseURL,
}) => {
  const offsite = new Set<string>();
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== baseURL) offsite.add(url.origin);
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Login | Release Gate');
  const manifest = await (await page.request.get('/manifest.json')).json();
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) {
    const resource = await page.request.get(icon.src);
    expect(resource.status()).toBe(200);
    expect(resource.headers()['content-type']).toContain('image/png');
  }
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Release dashboard' })).toBeVisible();
  const observed = page.getByText('Reports observed', { exact: true }).locator('..');
  await expect(observed).toContainText('1');
  await page.getByRole('link', { name: 'Inject a report' }).click();
  await page.getByLabel('Short title').fill('Client card does not expand');
  await page
    .getByLabel('Plain-language description')
    .fill('Opening the client card in the preview does not reveal its details.');
  await page.getByLabel('Actual result').fill('The selected client card stays collapsed.');
  await page
    .getByLabel('Expected result')
    .fill('The selected card opens, and the neighbouring card keeps its state.');
  await page.getByLabel('Affected area').fill('Dashboard');
  await page.getByLabel('Reproduction steps').fill('Open the dashboard and activate the client card.');
  await page
    .getByLabel('Evidence notes or controlled file reference')
    .fill('Observed in the local disclosure fixture.');
  await page.getByRole('button', { name: 'Log bug and check' }).click();
  await expect(page.getByRole('heading', { name: 'Bug logged without losing the trail' })).toBeVisible();
  await page.getByRole('button', { name: 'Open bug record' }).click();
  await expect(page.getByRole('heading', { name: 'Client card does not expand' }).first()).toBeVisible();
  const recordURL = page.url();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(observed).toContainText('2');
  await page.goto(recordURL);
  await page.getByRole('button', { name: 'Plan Preview repair' }).click();
  await page
    .getByRole('textbox', { name: 'Repair plan', exact: true })
    .fill('Connect the selected card to its disclosure state in the preview fixture.');
  await page.getByLabel('Checkpoint / backup reference').fill('disclosure-before-change');
  const saveAction = page.getByRole('button', { name: 'Save action', exact: true });
  await saveAction.click();
  await page.getByRole('button', { name: 'Record implementation', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What changed', exact: true })
    .fill('Enabled the disclosure handler in the isolated preview.');
  await page.getByLabel('Commit, checkpoint or change reference').fill('disclosure-preview');
  await page
    .getByLabel('Saved implementation evidence')
    .fill('Preview implementation bound to this report and checkpoint.');
  await saveAction.click();
  await page.getByRole('button', { name: 'Record Preview retest', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Observed', exact: true })
    .fill('Card opened, closed and left its neighbour unchanged.');
  await page
    .getByRole('textbox', { name: 'Evidence', exact: true })
    .fill('Replay of the isolated disclosure checks.');
  await saveAction.click();
  await page.getByRole('button', { name: 'Review release gate', exact: true }).click();
  await page
    .getByRole('textbox', { name: /decision reason|reason for (?:the )?decision|gate reason/i })
    .fill('Reviewed the before and after checks on the isolated preview.');
  await page.getByRole('button', { name: /^Approve(?: release| gate| for release)?$/i }).click();
  await page.getByRole('link', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: 'Record version', exact: true }).click();
  await page.getByLabel('Semantic version').fill('0.1.1');
  await page.getByLabel('Release title').fill('Client card disclosure');
  await page.getByLabel('Plain-language summary').fill('The selected client card now opens.');
  await page
    .getByRole('textbox', { name: 'What changed', exact: true })
    .fill('Repaired the disclosure handler.');
  await page.getByLabel('Why it changed').fill('Client details were inaccessible in preview.');
  await page.getByLabel('Source checkpoint').fill('disclosure-preview');
  await page.getByLabel('QA status').selectOption('passed');
  await page.getByLabel('Preview status').selectOption('passed');
  await page.getByLabel('Implementation evidence').fill('Isolated disclosure fixture updated.');
  await page.getByLabel('Preview evidence').fill('Disclosure and neighbour checks passed; gate approved.');
  await page.getByRole('checkbox', { name: /Client card does not expand/i }).check();
  await page.getByRole('button', { name: 'Save Version Record' }).click();
  await page.getByRole('button', { name: /v0\.1\.1.*Client card disclosure/i }).click();
  await page.getByRole('button', { name: 'Mark released', exact: true }).click();
  await page
    .getByPlaceholder('URL, observed result and evidence reference')
    .fill('Local demo live target matches the approved preview behaviour.');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('0.1.1', { exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByText('Live proof', { exact: true })
      .locator('..')
      .filter({ has: page.locator('p') })
      .first(),
  ).toContainText('1');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Release notifications' })).toContainText(
    /release|verification/i,
  );
  expect([...offsite]).toEqual([]);
  expect(exceptions).toEqual([]);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
