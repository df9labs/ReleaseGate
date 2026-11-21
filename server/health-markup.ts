import type { DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type RecordCheck = (
  key: string, category: string, title: string, passed: boolean,
  detail: string, recommendation: string,
) => void;
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const nonEmpty = (node: Element, name: string) => !!attr(node, name)?.trim();
const ignoredText = new Set(['script', 'style', 'template', 'noscript']);
const nativeFields = new Set(['input', 'select', 'textarea', 'button']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';

export interface SearchMetadata {
  page: string;
  title?: string;
  description?: string;
}

// Native title elements contain text. Normalise it only for comparisons within the sample.
function textKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase() || undefined;
}

export function inspectMarkup(
  nodes: Element[], page: URL, duplicateAttributes: number, environment: string | undefined,
  add: RecordCheck, note: (detail: string) => void,
): SearchMetadata {
  const head = nodes.find((node) => node.namespaceURI === htmlNamespace && node.tagName === 'head');
  const metadata = (head?.childNodes ?? []).filter(
    (node): node is Element => 'tagName' in node && node.namespaceURI === htmlNamespace,
  );
  const titles = metadata.filter((e) => e.tagName === 'title');
  const meta = metadata.filter((e) => e.tagName === 'meta');
  const descriptions = meta.filter((e) => attr(e, 'name')?.toLowerCase() === 'description');
  const title = titles[0]?.childNodes.map((n) => 'value' in n ? n.value : '').join('');
  const description = descriptions[0] && attr(descriptions[0], 'content');
  if (titles.length > 1) {
    add('multiple-titles', 'html', 'Multiple document titles declared', false,
      titles.length + ' title elements appear in the document head.', 'Give the page a single document title.');
  }
  if (descriptions.length === 1 && description?.trim()) {
    add('description', 'seo', 'Search description declared', true,
      'The document head contains one non-empty meta description.', 'Review its wording against the purpose of the page.');
  } else {
    note(descriptions.length > 1
      ? 'SEO opportunity: the document head contains multiple meta descriptions. Choose one description for this page.'
      : 'SEO opportunity: the document head has no non-empty meta description. Consider adding one if this page is intended for search.');
  }
  const canonicals = metadata.filter(
    (e) => e.tagName === 'link' && attr(e, 'rel')?.toLowerCase().split(/\s+/).includes('canonical'),
  );
  if (canonicals.length) {
    const targets = new Set<string>();
    const base = metadata.find((e) => e.tagName === 'base' && attr(e, 'href') !== undefined);
    const baseUrl = URL.parse(base ? attr(base, 'href')! : page.href, page) ?? page;
    let valid = true;
    for (const element of canonicals) {
      const href = attr(element, 'href')?.trim();
      const target = href ? URL.parse(href, baseUrl) : null;
      if (target && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password)
        targets.add(target.href);
      else valid = false;
    }
    valid = valid && targets.size === 1;
    add('canonical', 'seo', valid ? 'Canonical target is consistent' : 'Canonical target is invalid or conflicting', valid,
      canonicals.length + ' canonical declaration(s) resolve to ' + targets.size + ' distinct HTTP(S) target(s).',
      'Check that each declared canonical points to the intended URL.');
  }
  const robots = meta.filter((e) => /^(robots|googlebot|bingbot)$/i.test(attr(e, 'name') ?? ''));
  const excluded = robots.filter((e) => /(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(attr(e, 'content') ?? ''));
  if (excluded.length) {
    const agents = [...new Set(excluded.map((e) => attr(e, 'name')!.toLowerCase()))].join(', ');
    note('Indexing directive (' + agents + '): the delivered HTML requests exclusion from search results. ' +
      (environment === 'preview' ? 'This can be intentional on a preview.' :
        environment === 'live' ? 'Confirm this is intended for the live page.' : 'Confirm this matches the intended audience.'));
  }
  add('duplicate-attributes', 'html', duplicateAttributes ? 'Duplicate HTML attributes found' : 'No duplicate HTML attributes found',
    duplicateAttributes === 0, 'The HTML parser reported ' + duplicateAttributes + ' duplicate attribute(s) in the source.',
    'Keep one intended value for each attribute on a tag.');

  const ids = new Map<string, Element>();
  let reusedIds = 0;
  // The parser returns parent elements before their children.
  const hidden = new Set<Element>();
  for (const node of nodes) {
    const id = attr(node, 'id');
    if (id) {
      if (ids.has(id)) reusedIds++;
      else ids.set(id, node);
    }
    if (
      (node.parentNode && 'tagName' in node.parentNode && hidden.has(node.parentNode)) ||
      attr(node, 'hidden') !== undefined || attr(node, 'inert') !== undefined ||
      attr(node, 'aria-hidden')?.toLowerCase() === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(attr(node, 'style') ?? '')
    ) hidden.add(node);
  }
  if (ids.size) {
    add('unique-ids', 'html', reusedIds ? 'Document IDs are reused' : 'Document IDs are unique', !reusedIds,
      reusedIds + ' element(s) repeat an ID already present in the delivered document.',
      'Give each element its own ID and update references to it.');
  }

  // This recognises common naming sources in the markup. CSS, script and the full browser
  // accessible-name algorithm can produce different results when the page is rendered.
  const namedContent = new Set<Element>(), namedIncludingHidden = new Set<Element>();
  const hasChildName = (node: Node, names: Set<Element>): boolean =>
    'value' in node ? !!node.value.trim() : 'tagName' in node && !nativeFields.has(node.tagName) && names.has(node);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (ignoredText.has(node.tagName)) continue;
    const nameAttribute = nonEmpty(node, 'aria-label') || nonEmpty(node, 'title') ||
      (node.tagName === 'img' && nonEmpty(node, 'alt'));
    if (nameAttribute || node.childNodes.some((n) => hasChildName(n, namedIncludingHidden))) namedIncludingHidden.add(node);
    if (!hidden.has(node) && (nameAttribute || node.childNodes.some((n) => hasChildName(n, namedContent)))) namedContent.add(node);
  }
  const isReferencedName = (node: Element) => (attr(node, 'aria-labelledby') ?? '').split(/\s+/).some((id) => {
    const ref = ids.get(id);
    return ref && namedIncludingHidden.has(ref);
  });
  const labelFor = new Set<string>(), wrapped = new Set<Element>();
  for (const node of nodes) {
    if (node.tagName !== 'label' || !(namedContent.has(node) || isReferencedName(node))) continue;
    const id = attr(node, 'for');
    if (id !== undefined) {
      if (id) labelFor.add(id);
    } else wrapped.add(node);
  }
  const enclosingLabel = new Map<Element, Element>();
  const implicitlyLabelled = new Set<Element>();
  const nativeLabelable = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);
  const usedLabels = new Set<Element>();
  for (const node of nodes) {
    const parent = node.parentNode;
    const label = parent && 'tagName' in parent &&
      (wrapped.has(parent) ? parent : enclosingLabel.get(parent));
    if (!label) continue;
    enclosingLabel.set(node, label);
    if (nativeLabelable.has(node.tagName) && !(node.tagName === 'input' && attr(node, 'type')?.toLowerCase() === 'hidden') &&
      !usedLabels.has(label)) {
      implicitlyLabelled.add(node);
      usedLabels.add(label);
    }
  }
  let links = 0, namelessLinks = 0, controls = 0, namelessControls = 0;
  let lastHeading = 0, headingCount = 0, skips = 0;
  for (const node of nodes) {
    if (hidden.has(node) || node.namespaceURI !== htmlNamespace) continue;
    if (/^h[1-6]$/.test(node.tagName)) {
      const level = Number(node.tagName[1]);
      if (lastHeading && level > lastHeading + 1) skips++;
      lastHeading = level;
      headingCount++;
    }
    if (node.tagName === 'a' && attr(node, 'href') !== undefined) {
      links++;
      if (!namedContent.has(node) && !isReferencedName(node)) namelessLinks++;
    }
    if (!nativeFields.has(node.tagName) || attr(node, 'disabled') !== undefined) continue;
    const inputType = node.tagName === 'input' ? (attr(node, 'type') || 'text').toLowerCase() : '';
    if (['hidden', 'submit', 'reset'].includes(inputType)) continue;
    controls++;
    const named = nonEmpty(node, 'aria-label') || nonEmpty(node, 'title') || isReferencedName(node) ||
      labelFor.has(attr(node, 'id') || '') || implicitlyLabelled.has(node) ||
      (node.tagName === 'button' && namedContent.has(node)) ||
      (inputType === 'image' && nonEmpty(node, 'alt')) || (inputType === 'button' && nonEmpty(node, 'value')) ||
      ((node.tagName === 'textarea' || ['text', 'search', 'email', 'url', 'tel', 'password'].includes(inputType)) && nonEmpty(node, 'placeholder'));
    if (!named) namelessControls++;
  }
  if (links) add('link-names', 'html', namelessLinks ? 'Links lack a detectable static name' : 'Link name sources found in HTML',
    !namelessLinks, namelessLinks + ' of ' + links + ' link(s) lack detectable text, image alternative, title or ARIA naming in the source.',
    'Inspect the rendered link name and add descriptive text or a label where needed.');
  if (controls) add('control-names', 'access_data', namelessControls ? 'Form controls lack a detectable static name' : 'Control name sources found in HTML',
    !namelessControls, namelessControls + ' of ' + controls + ' inspected native control(s) lack a detectable name source in the HTML.',
    'Inspect the accessible name in a browser and associate a descriptive label where needed.');
  if (headingCount > 1) add('heading-order', 'html', skips ? 'Heading levels skip a level' : 'Heading levels follow a sequence',
    !skips, skips + ' downward jump(s) skip a level among ' + headingCount + ' native headings in source order.',
    'Review the heading outline and select levels that reflect the content structure.');
  return { page: page.origin + page.pathname, title: textKey(title ?? ''), description: textKey(description ?? '') };
}

export function compareSearchMetadata(sample: SearchMetadata[], notes: string[]) {
  for (const [field, label] of [['title', 'document title'], ['description', 'meta description']] as const) {
    const groups = new Map<string, string[]>();
    for (const entry of sample) {
      const value = entry[field];
      if (!value) continue;
      const pages = groups.get(value) ?? [];
      pages.push(entry.page);
      groups.set(value, pages);
    }
    for (const pages of groups.values()) {
      if (pages.length > 1)
        notes.push('SEO opportunity: the same ' + label + ' (ignoring case and spacing) appears on these sampled pages: ' + pages.join(', ') +
          '. Consider distinct wording if their purposes differ.');
    }
  }
}
