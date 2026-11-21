import type { DefaultTreeAdapterTypes } from 'parse5';
import { contentRules } from './health-content-rules';

// "Generic AI content" review notes. Pure and deterministic: no network, no LLM.
// These are pattern matches that can be false alarms. They never pass or fail a check.

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

export const CONTENT_NOTE_PREFIX = 'Generic content:';
const SKIP = new Set(['script', 'style', 'template', 'noscript']); // same rule as ignoredText in health-markup.ts
const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'dd', 'dt', 'figcaption', 'div',
  'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol', 'table', 'tr', 'form', 'label', 'legend', 'button',
  'option', 'summary', 'details', 'figure', 'address', 'pre']);
const LABELISH = new Set(['label', 'legend', 'th', 'option', 'dt', 'button']);
const HERO = /\b(?:hero|tagline|banner|headline|jumbotron|masthead|strapline)\b/i;
const TESTIMONIAL = /testimonial|review-?card|customer-?quote/i;
const MAX_TEXT = 80;

export interface ContentFinding {
  id: string;
  name: string;
  text: string;
  advice?: string;
}
export interface PageContent {
  /** Path of the inspected page, for example /about. */
  page: string;
  findings: ContentFinding[];
  quotes: string[];
}

const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const trim = (value: string) => {
  const text = clean(value).replace(/^[.!?\s]+/, '');
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1).trimEnd() + '…' : text;
};

interface Block { text: string; tag: string; hero: boolean }

function isHidden(node: Element) {
  return attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden') === 'true';
}

function textOf(root: Node): string {
  const parts: string[] = [], pending: Node[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === '#text' && 'value' in node) parts.push(node.value);
    else if ('tagName' in node && (SKIP.has(node.tagName) || isHidden(node))) continue;
    else if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return clean(parts.join(' '));
}

// Visible text split into leaf blocks, so a "paragraph" means the text one block element holds directly.
function blocks(body: Element): Block[] {
  const result: Block[] = [];
  function walk(node: Element, hero: boolean, tag: string) {
    let current = '';
    const flush = () => {
      if (clean(current)) result.push({ text: clean(current), tag, hero });
      current = '';
    };
    for (const child of node.childNodes) {
      if (child.nodeName === '#text' && 'value' in child) current += child.value;
      else if ('tagName' in child) {
        if (SKIP.has(child.tagName) || isHidden(child)) continue;
        if (child.tagName === 'br') current += ' ';
        else if (BLOCK.has(child.tagName)) {
          flush();
          const marked = hero || /^h[12]$/.test(child.tagName) || HERO.test((attr(child, 'class') ?? '') + ' ' + (attr(child, 'id') ?? ''));
          walk(child, marked, child.tagName);
        } else {
          // Inline element: its text joins the current block.
          const inner = textOf(child);
          if (inner) current += ' ' + inner + ' ';
        }
      }
    }
    flush();
  }
  walk(body, false, 'body');
  return result;
}

const placeholders: { re: RegExp; ambiguous?: boolean }[] = [
  { re: /\blorem ipsum\b|\bdolor sit amet\b/gi },
  { re: /\b(?:john|jane) doe\b/gi },
  { re: /\bYour Company(?: Name)?\b|\bCompany Name\b|\bYour Name\b/g, ambiguous: true },
  { re: /\[(?:your name|your company|company name|your email|insert [^\]]{1,40}|placeholder[^\]]{0,20})\]/gi },
  { re: /\binsert [\w' -]{1,40} here\b/gi },
  { re: /[\w.+-]+@example\.(?:com|org|net)\b/gi },
  { re: /\b123 Main St(?:reet|\.)?/gi },
  { re: /\(555\)\s?\d{3}[-.\s]?\d{4}|\b555[-.\s]\d{3}[-.\s]\d{4}\b|\b555[-.\s]01\d\d\b/g },
];
const tokens = /\{\{[^{}]{1,60}\}\}|\[PLACEHOLDER[^\]]{0,20}\]|\bTODO\b|\bTBD\b/g;
const placeholderPerson = /\b(?:john|jane) (?:doe|smith)\b|\b(?:customer|client|company|full) name\b|\bfirstname lastname\b|\bname surname\b|\b(?:john|jane) [a-z]\.(?=\s|$)/i;
const noHandler = ['onclick', 'data-action', 'data-toggle', 'data-bs-toggle', 'data-target', 'data-bs-target', 'aria-controls', 'aria-expanded',
  'aria-haspopup', 'data-modal', 'data-href', 'id'];
const harmlessLabel = /^(?:back to top|top|menu|close|skip.*|open menu|toggle.*)$/i;

function patternHits(block: Block) {
  const found: { id: string; name: string; text: string; advice?: string; start: number; end: number; strong: boolean; tagline: boolean }[] = [];
  for (const rule of contentRules) {
    if (rule.heroOnly && !block.hero) continue;
    rule.re.lastIndex = 0;
    for (const m of block.text.matchAll(rule.re)) {
      if (!m[0].trim()) continue;
      const start = m.index!, end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue; // an earlier rule already owns this text
      found.push({ id: rule.id, name: rule.name, text: trim(m[0]), start, end, strong: !!rule.strong, tagline: !!rule.tagline,
        advice: rule.better ? 'Better: ' + rule.better : undefined });
    }
  }
  return found;
}

export function inspectGenericContent(nodes: Element[], page: string, now = new Date()): PageContent {
  const out: PageContent = { page, findings: [], quotes: [] };
  const body = nodes.find((n) => n.tagName === 'body');
  if (!body) return out;
  const list = blocks(body);
  const add = (id: string, name: string, text: string, advice?: string) => {
    if (!out.findings.some((f) => f.id === id && f.text === text)) out.findings.push({ id, name, text, advice });
  };

  // 1 and 2: placeholders and unfilled template tokens. One hit is enough.
  for (const block of list) {
    for (const { re, ambiguous } of placeholders)
      for (const m of block.text.matchAll(re)) {
        if (ambiguous && (LABELISH.has(block.tag) || block.text.length <= m[0].length + 2)) continue; // a form label, not copy
        add('DF9-PH', 'Placeholder text', trim(m[0]), 'Replace with real content.');
      }
    for (const m of block.text.matchAll(tokens)) add('DF9-TOK', 'Unfilled template token', trim(m[0]), 'Remove or fill in before publishing.');
  }
  const main = list.filter((b) => !['nav', 'header', 'footer'].includes(b.tag)).map((b) => b.text).join(' ');
  if (main.length < 120 && /\bcoming soon\b|\bunder construction\b/i.test(main))
    add('DF9-TOK', 'Unfilled template token', trim(/coming soon|under construction/i.exec(main)![0]), 'This is the only body text on the page.');

  // 3: cliché wording, with the density rule.
  const perBlock = list.map(patternHits);
  const ids = new Set(perBlock.flat().filter((h) => !h.strong).map((h) => h.id));
  const dense = ids.size >= 3 || perBlock.some((hits) => new Set(hits.filter((h) => !h.strong).map((h) => h.id)).size >= 2);
  perBlock.forEach((hits, i) => {
    for (const h of hits)
      if (dense || h.strong || (h.tagline && list[i].hero)) add(h.id, h.name, h.text, h.advice);
  });

  // 4: testimonial-like blocks with placeholder names; quotes are compared across pages later.
  for (const node of nodes) {
    const marked = node.tagName === 'blockquote' || TESTIMONIAL.test((attr(node, 'class') ?? '') + ' ' + (attr(node, 'id') ?? ''));
    if (!marked || isHidden(node)) continue;
    const text = textOf(node);
    if (!text) continue;
    const who = placeholderPerson.exec(text);
    if (who) add('DF9-TEST', 'Template testimonial', trim(who[0]), 'The testimonial is attributed to a placeholder name.');
    if (text.length >= 40) out.quotes.push(text.toLowerCase());
  }

  // 5: links that go nowhere and show no sign of a script handler.
  for (const node of nodes) {
    if (node.tagName !== 'a' || isHidden(node)) continue;
    const href = (attr(node, 'href') ?? '').trim().toLowerCase().replaceAll(/\s+/g, '');
    if (!['#', 'javascript:void(0)', 'javascript:void(0);', 'javascript:;', 'javascript:'].includes(href)) continue;
    if (noHandler.some((name) => attr(node, name) !== undefined) || attr(node, 'role') === 'tab') continue;
    const label = textOf(node) || attr(node, 'aria-label') || '';
    if (!label || harmlessLabel.test(label)) continue;
    add('DF9-CTA', 'Link or button goes nowhere', trim(label), 'The address is "' + (href || '#') + '" and no click handler is visible in the HTML. A script may still handle it.');
  }

  // 6: copyright year in the footer or any block carrying a copyright sign.
  for (const block of list) {
    const m = /(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})\b/i.exec(block.text);
    if (m && Number(m[1]) < now.getUTCFullYear() - 1 && Number(m[1]) > 1990)
      add('DF9-YR', 'Possibly stale copyright year (low severity)', trim(m[0]), 'The year is more than one year before this run.');
  }
  return out;
}

interface Group { id: string; name: string; text: string; advice?: string; pages: string[] }

export function summariseGenericContent(pages: PageContent[]): string[] {
  const groups = new Map<string, Group>();
  for (const p of pages)
    for (const f of p.findings) {
      const key = f.id + '\n' + f.text.toLowerCase();
      const group = groups.get(key) ?? { ...f, pages: [] };
      if (!group.pages.includes(p.page)) group.pages.push(p.page);
      groups.set(key, group);
    }
  const quotes = new Map<string, string[]>();
  for (const p of pages)
    for (const q of new Set(p.quotes)) quotes.set(q, [...(quotes.get(q) ?? []), p.page]);
  for (const [quote, where] of quotes)
    if (where.length > 1)
      groups.set('DF9-TEST\nrepeat ' + quote, { id: 'DF9-TEST', name: 'Template testimonial', text: trim(quote), pages: where,
        advice: 'The same quote appears on more than one page.' });
  const total = pages.length;
  const MAX_NOTES = 25;
  const lines = [...groups.values()].map((g) => {
    const shown = g.pages.slice(0, 3).join(', ') + (g.pages.length > 3 ? ' and ' + (g.pages.length - 3) + ' more' : '');
    const where = g.pages.length === 1 ? 'on ' + shown : 'on ' + g.pages.length + ' of ' + total + ' pages (' + shown + ')';
    return CONTENT_NOTE_PREFIX + ' [' + g.id + ' ' + g.name + '] "' + g.text + '" ' + where + '. ' + (g.advice ? g.advice + ' ' : '') +
      'Pattern match only; it can be a false alarm.';
  });
  return lines.length > MAX_NOTES
    ? [...lines.slice(0, MAX_NOTES), CONTENT_NOTE_PREFIX + ' ' + (lines.length - MAX_NOTES) + ' further pattern match(es) were left out of this list.']
    : lines;
}
