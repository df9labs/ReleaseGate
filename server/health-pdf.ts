import type { Healthcheck } from '../src/api';
import { browserReviewLimits, launchHealthBrowser } from './health-browser';
import { healthcheckDocument } from './health-pdf-document';

export function pdfReference(run: Healthcheck): string {
  return /^HC-[0-9]+$/.test(run.healthcheck_number) ? run.healthcheck_number : 'Healthcheck';
}

export async function renderHealthcheckPdf(run: Healthcheck): Promise<Buffer> {
  const html = healthcheckDocument(run);
  const browser = await launchHealthBrowser();
  const deadline = setTimeout(() => void browser.close().catch(() => {}), browserReviewLimits.reviewMs);
  try {
    const context = await browser.newContext({
      offline: true, javaScriptEnabled: false, serviceWorkers: 'block', permissions: [], acceptDownloads: false,
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true,
      margin: { top: '16mm', right: '16mm', bottom: '20mm', left: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;margin:0 16mm;border-top:1px solid #cbd5e1;padding-top:6px;display:flex;justify-content:space-between;font:9px Arial,sans-serif;color:#475569">
        <span>Datum Foundry Nine &nbsp; / &nbsp; ReleaseGate &nbsp; / &nbsp; ${pdfReference(run)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
    });
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}
