import { expect, test } from '@playwright/test';
import type { Healthcheck } from '../../src/api';

test('download the selected saved Healthcheck as a PDF and recover from an export error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@releasegate.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.RG_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Healthcheck', exact: true }).click();
  const history = page.getByRole('combobox', { name: 'Healthcheck history' });
  const currentId = await history.inputValue();
  const response = await page.request.get('/api/healthchecks');
  const { records } = await response.json() as { records: Healthcheck[] };
  const selected = records.find((run) => run.id !== currentId)!;
  await history.selectOption(selected.id);

  const exportButton = page.getByRole('button', { name: 'Export PDF', exact: true });
  const path = '/api/healthchecks/' + encodeURIComponent(selected.id) + '/pdf';
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.route(path, (route) => route.fulfill({
    status: 503, json: { message: 'The PDF service is unavailable.' },
  }), { times: 1 });
  await exportButton.click();
  await expect(page.getByRole('alert')).toContainText('PDF export failed. The PDF service is unavailable.');

  const result = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === path);
  const saving = page.waitForEvent('download');
  await exportButton.click();
  const [file, pdf] = await Promise.all([saving, result]);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect(file.suggestedFilename()).toBe(`ReleaseGate-${selected.healthcheck_number}.pdf`);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.headers()['content-length']).toBe(String(bytes.length));
  expect(bytes.subarray(-32).toString('ascii').trimEnd()).toMatch(/%%EOF$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(history).toHaveValue(selected.id);
  await expect(history.locator('option')).toHaveCount(records.length);
  expect(writes).toEqual([]);
});
