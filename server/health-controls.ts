import type { Locator, Page } from 'playwright';

export type ControlFamily = 'Disclosure' | 'Tab' | 'Carousel' | 'Lightbox' | 'Cookie' | 'Menu';
export type Control = {
  index: number; label: string; target: string | null; expanded: string | null;
  id: string; tag: string; family: ControlFamily | null; cookieChoice: 'reject' | 'accept' | null; mainCta: boolean;
  skip: string | null; disabled: boolean;
};

export function visibleControls(page: Page) {
  return page.getByRole('button').or(page.getByRole('tab')).or(page.locator('summary')).filter({ visible: true });
}

// This function runs in the page. Use the full identity for safety before shortening its report label.
export function describeControls(input: Element[] | Element, limit: number) {
  const elements = Array.isArray(input) ? input : [input];
  const controls: Control[] = elements.slice(0, limit).map((element, index) => {
    const referenced = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
    const content = (element as HTMLElement).innerText ?? '';
    const value = element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type) ? element.value : '';
    const title = element.getAttribute('title') ?? '';
    const alt = element.querySelector('img[alt]')?.getAttribute('alt') ?? '';
    const label = (referenced || element.getAttribute('aria-label') || content || value || title || alt).replace(/\s+/g, ' ').trim();
    const expanded = element.getAttribute('aria-expanded');
    const target = element.getAttribute('aria-controls');
    const tag = element.localName;
    const id = element.id;
    const role = element.getAttribute('role');
    const type = element.getAttribute('type')?.toLowerCase();
    const link = element.closest('a[href]');
    const identity = [label, content, value, title, alt, id, element.getAttribute('class'), element.getAttribute('name'),
      element.getAttribute('aria-label'), element.getAttribute('data-action'), link?.getAttribute('href')]
      .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    const formButton = element instanceof HTMLButtonElement || element instanceof HTMLInputElement;
    const transactional = /\b(submit|buy|pay|payment|purchase|checkout|order|delete|remove|destroy|sign\s*out|log\s*out|send|save|subscribe|unsubscribe|register|reset|book|donate|redeem|transfer|upload|download|add to (cart|basket))\b/i.test(identity);
    const disabled = element.matches(':disabled') || !!element.closest('[aria-disabled="true"],[inert]');
    let skip: string | null = null;
    if (transactional || element.hasAttribute('formaction') || (formButton &&
      (['submit', 'reset', 'image'].includes(type ?? '') || (element.form && element.type === 'submit'))))
      skip = 'Skipped a destructive, transactional or form action.';
    else if (link && !link.getAttribute('href')?.startsWith('#')) skip = 'This control would navigate to another address.';
    else if (disabled) skip = 'Disabled in the starting state.';

    let family: ControlFamily | null = null, cookieChoice: Control['cookieChoice'] = null;
    const context = element.closest('[role="dialog"],dialog,section,aside,[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]') ?? element.parentElement;
    const cookieContext = /\b(cookies?|consent)\b/i.test(label) || !!context && !['body', 'html', 'main'].includes(context.localName) &&
      /cookie|consent/i.test([context.id, context.className, context.getAttribute('aria-label'), (context as HTMLElement).innerText?.slice(0, 500)].join(' '));
    if (cookieContext && /\b(reject|decline|deny|necessary only|essential only|accept|allow|agree|settings|preferences|manage|customi[sz]e)\b/i.test(label)) {
      family = 'Cookie';
      if (/\b(reject|decline|deny|necessary only|essential only)\b/i.test(label)) cookieChoice = 'reject';
      else if (/\b(accept|allow|agree)\b/i.test(label)) cookieChoice = 'accept';
    } else if (role === 'tab') family = 'Tab';
    else if (/\b(menu|navigation|hamburger)\b/i.test(identity) || element.getAttribute('aria-haspopup') === 'menu') family = 'Menu';
    else if (/\b(enlarge|all views|compare|lightbox|zoom|full\s?screen|gallery)\b/i.test(label) || element.getAttribute('aria-haspopup') === 'dialog') family = 'Lightbox';
    else if (/\b(carousel|slide|slides|previous|next|prev)\b/i.test(label) && (/\b(carousel|slides?)\b/i.test(label) ||
      element.closest('[aria-roledescription="carousel"],[class*="carousel" i],[class*="slider" i],[class*="gallery" i]'))) family = 'Carousel';
    else if (tag === 'summary' || expanded === 'true' || expanded === 'false' ||
      /\b(accordion|expand|collapse|toggle|show (more|less|details)|hide (details|more))\b/i.test(label)) family = 'Disclosure';
    const mainCta = element.matches('[data-cta],.cta,[class*="primary" i]') ||
      (!!element.closest('main,[role="main"]') && /\b(get started|sign up|buy|checkout|book|contact us|request a demo)\b/i.test(label));
    return { index, label, target, expanded, tag, id, family, cookieChoice, mainCta, skip, disabled };
  });
  return { total: elements.length, controls };
}

export function collectButtons(page: Page, limit: number) {
  return visibleControls(page).evaluateAll(describeControls, limit);
}

export function sameControl(initial: Control, fresh: Omit<Control, 'index'>) {
  return initial.tag === fresh.tag && initial.id === fresh.id && initial.label === fresh.label &&
    initial.family === fresh.family && initial.expanded === fresh.expanded && initial.target === fresh.target;
}

export async function watchControl(button: Locator) {
  return button.evaluateHandle((element) => {
    const expanded = element.getAttribute('aria-expanded'), selected = element.getAttribute('aria-selected');
    const beforeFocus = document.activeElement;
    const beforeText = document.body.innerText;
    const dialogs = Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).filter((node) => node.checkVisibility());
    let dom = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!node || !node.checkVisibility() || node.closest('script,style,template,head,[hidden]')) continue;
        if (record.type === 'attributes' && record.oldValue === node.getAttribute(record.attributeName!)) continue;
        dom = true;
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['hidden', 'open', 'class', 'style', 'src', 'aria-hidden', 'aria-current', 'aria-pressed'] });
    return {
      change() {
        if (element.getAttribute('aria-expanded') !== expanded) return 'aria-expanded changed';
        if (element.getAttribute('aria-selected') !== selected) return 'aria-selected changed';
        if (Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).some((el) => el.checkVisibility() && !dialogs.includes(el))) return 'a dialog became visible';
        const focused = document.activeElement;
        if (focused && focused !== document.body && focused !== beforeFocus && !element.contains(focused) && focused.checkVisibility()) return 'focus moved to another visible element';
        if (document.body.innerText !== beforeText) return 'the rendered text changed';
        return dom ? 'the rendered DOM changed' : null;
      },
      stop() { observer.disconnect(); },
    };
  });
}
