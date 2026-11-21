import type { Page } from 'playwright';

type RecordObservation = (key: string, title: string, passed: boolean | null, detail: string) => void;
export const contrastTextLimit = 100;

function formObservations() {
  const forms = Array.from(document.forms);
  let fields = 0, unlabelled = 0, inputs = 0, unknownTypes = 0;
  let required = 0, ineffective = 0, validated = 0, unverified = 0, skipped = 0;
  const types = new Set<string>();
  for (const form of forms) {
    const candidates = Array.from(form.elements).filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) &&
      !el.matches(':disabled,input[type="hidden"],input[type="submit"],input[type="reset"],input[type="button"],input[type="image"]') &&
      !el.closest('[hidden],[inert],[aria-hidden="true"]') && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    const empty = new Set<Element>();
    for (const el of candidates) {
      fields++;
      const labelled = el.getAttribute('aria-label')?.trim() ||
        (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim()) ||
        Array.from(el.labels ?? []).some((label) => {
          const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
          while (text.nextNode()) {
            if (text.currentNode.textContent?.trim() && !text.currentNode.parentElement?.closest('select,textarea,button,script,style,template')) return true;
          }
          return Array.from(label.querySelectorAll('img[alt]')).some((img) => img.getAttribute('alt')?.trim());
        });
      if (!labelled) unlabelled++;
      if (el instanceof HTMLInputElement) {
        inputs++;
        types.add(el.type);
        const declared = el.getAttribute('type')?.toLowerCase();
        if (declared && declared !== el.type) unknownTypes++;
      }
      if (!el.required && el.getAttribute('aria-required') !== 'true') continue;
      required++;
      if (!el.required || !el.willValidate || (el instanceof HTMLInputElement && ['range', 'color'].includes(el.type))) ineffective++;
      if (el.willValidate && el.validity.valueMissing) empty.add(el);
    }
    if (form.noValidate || !empty.size) { skipped++; continue; }
    const invalid = new Set<EventTarget>();
    const listener = { observe(event: Event) { if (event.target) invalid.add(event.target); } };
    // Constraint validation dispatches invalid events without visiting a submitter or submission algorithm.
    document.addEventListener('invalid', listener.observe, true);
    try {
      const valid = HTMLFormElement.prototype.checkValidity.call(form);
      if (!valid && [...empty].every((el) => invalid.has(el))) validated++;
      else unverified++;
    } finally { document.removeEventListener('invalid', listener.observe, true); }
  }
  return { forms: forms.length, fields, unlabelled, inputs, unknownTypes, types: [...types], required, ineffective, validated, unverified, skipped };
}

// Compare visible text only when Chromium exposes a solid foreground and an unambiguous solid backdrop.
function measureContrast(limit: number) {
  const colour = {
    rgb(value: string) {
      const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
      return match ? match.slice(1).map(Number) : null;
    },
    luminance(rgb: number[]) {
      const values = rgb.map((v) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    },
  };
  let considered = 0, measured = 0, low = 0, minimum = Infinity, more = false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, element = node.parentElement;
    if (!node.textContent?.trim() || !element || element.closest('script,style,template,noscript')) continue;
    if (considered === limit) { more = true; break; }
    considered++;
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getClientRects()[0];
    if (!rect || !rect.width || !rect.height) continue;
    const hit = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Sibling overlays, background layers and text outside the viewport cannot be inferred from CSS colours.
    if (hit[0] !== element || hit.some((layer) => !layer.contains(element))) continue;
    const style = getComputedStyle(element), fg = colour.rgb(style.color);
    if (!fg || style.webkitTextFillColor !== style.color || style.textShadow !== 'none') continue;
    let bg: number[] | null = null, complex = false;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const layer = getComputedStyle(parent);
      if (layer.opacity !== '1' || layer.filter !== 'none' || layer.mixBlendMode !== 'normal' ||
        layer.backdropFilter !== 'none' || layer.backgroundImage !== 'none' ||
        ['::before', '::after'].some((p) => !['none', 'normal'].includes(getComputedStyle(parent!, p).content))) { complex = true; break; }
      if (!bg && layer.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        bg = colour.rgb(layer.backgroundColor);
        if (!bg) { complex = true; break; }
      }
    }
    if (complex || (!bg && style.colorScheme !== 'normal' && style.colorScheme !== 'light')) continue;
    const a = colour.luminance(fg), b = colour.luminance(bg ?? [255, 255, 255]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(style.fontSize), bold = parseFloat(style.fontWeight) >= 700;
    measured++;
    minimum = Math.min(minimum, ratio);
    if (ratio < (size >= 24 || (bold && size >= 56 / 3) ? 3 : 4.5)) low++;
  }
  return { considered, measured, low, minimum: measured ? minimum.toFixed(2) : '', more };
}

export async function inspectBrowserAccess(page: Page, add: RecordObservation) {
  const main = await page.getByRole('main').filter({ visible: true }).count();
  add('main-landmark', 'Main landmark', main === 1, 'Chromium found ' + main + ' visible main landmark(s).');

  const notices = await page.evaluate(() => {
    const text = document.body.innerText;
    const controls = Array.from(document.querySelectorAll('a[href],button,[role="button"]')).filter((el) =>
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
    const labels = controls.map((el) => [el.getAttribute('aria-label'), (el as HTMLElement).innerText].join(' ')).join('\n');
    const links = controls.filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
    return {
      privacy: /\bprivacy (policy|notice|statement)\b/i.test(text + '\n' + labels) ||
        links.some((link) => /\bprivacy\b/i.test(link.innerText) && /\/privacy(?:[./_-]|$)/i.test(link.pathname)),
      cookie: /\b(cookie (policy|notice|settings|preferences)|(?:use|uses|manage|reject|accept) (?:all |optional )?cookies)\b/i.test(text + '\n' + labels) ||
        links.some((link) => /\bcookies?\b/i.test(link.innerText) && /\/cookies?(?:[./_-]|$)/i.test(link.pathname)),
    };
  });
  for (const [key, present] of Object.entries(notices)) {
    const title = key === 'privacy' ? 'Privacy notice' : 'Cookie notice or settings';
    add(key + '-notice', title, present || null, present ? 'The signed-out page displayed wording for this notice or control.' :
      'No matching notice or control was visible in the initial signed-out state.');
  }

  const contrast = await page.evaluate(measureContrast, contrastTextLimit);
  if (contrast.measured) add('contrast', 'Text contrast on solid backgrounds', !contrast.low,
    contrast.low + ' of ' + contrast.measured + ' measured text run(s) fell below the applicable 4.5:1 or 3:1 ratio. Lowest measured ratio ' + contrast.minimum + ':1.');
  if (!contrast.measured || contrast.measured < contrast.considered || contrast.more) add('contrast-unmeasured', 'Unmeasured text contrast', null,
    (contrast.considered - contrast.measured) + ' inspected text run(s) had no measurable visible solid-colour pair.' +
    (contrast.more ? ' Additional text exceeded the ' + contrastTextLimit + '-run sample.' : ''));

  const form = await page.evaluate(formObservations);
  if (form.forms) {
    if (form.fields) add('form-labels', 'Form field labels', !form.unlabelled,
      form.unlabelled + ' of ' + form.fields + ' enabled data-entry fields lacked an associated label or ARIA label.');
    if (form.inputs) add('form-types', 'Form input types', !form.unknownTypes, 'Chromium exposed ' + form.types.join(', ') + '. ' +
      form.unknownTypes + ' of ' + form.inputs + ' input type declarations fell back to another type.');
    add('form-required', 'Required field declarations', form.required ? !form.ineffective : null,
      form.required ? form.required + ' required field declaration(s), including ' + form.ineffective + ' without an applicable native constraint.' :
        'The inspected forms declared no required fields. Their intended requirements are unknown.');
    if (form.validated || form.unverified) add('form-validation', 'Empty form constraint validation', form.unverified ? null : true,
      form.validated + ' form(s) rejected empty required fields and dispatched invalid events. ' + form.unverified + ' had an inconclusive event observation. No form was submitted.');
    if (form.skipped) add('form-validation-skipped', 'Forms without an empty validation observation', null,
      form.skipped + ' form(s) disabled native validation or had no initially empty, natively required field to exercise.');
  }

  const before = await page.evaluateHandle(() => document.activeElement);
  try {
    await page.keyboard.press('Tab');
    const moved = await page.evaluate((previous) => {
      const active = document.activeElement;
      return !!active && active !== previous && active !== document.body && active !== document.documentElement &&
        active.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }, before);
    add('keyboard-focus', 'Keyboard focus via Tab', moved || null,
      moved ? 'One Tab press moved focus to another visible element.' : 'One Tab press did not demonstrate focus moving to a visible element.');
  } finally { await before.dispose(); }
}
