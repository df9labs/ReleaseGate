// Only declared slash prefixes can match. Deep referrer paths do not need a lookup per directory.
class PrefixMap<T> extends Map<string, T> {
  private readonly lengths = new Set<number>();
  private longestFirst?: number[];

  override set(key: string, value: T) {
    if (key.endsWith('/') && !this.lengths.has(key.length)) {
      this.lengths.add(key.length);
      this.longestFirst = undefined;
    }
    return super.set(key, value);
  }

  *matchingPrefixes(key: string): Generator<[number, T]> {
    this.longestFirst ??= [...this.lengths].sort((a, b) => b - a);
    for (const length of this.longestFirst) {
      if (length >= key.length || key[length - 1] !== '/') continue;
      const value = this.get(key.slice(0, length));
      if (value !== undefined) yield [length, value];
    }
  }
}

type SpecifierMap = PrefixMap<URL | null>;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A bare name is eligible only through an import map. new URL(name, base) alone would turn it into a path.
function urlLike(value: string, base: URL) {
  return /^(?:\/|\.\/|\.\.\/)/.test(value) ? URL.parse(value, base) : URL.parse(value);
}

function mergeBindings(target: SpecifierMap, entries: Record<string, unknown>, base: URL) {
  const normalized = new Map<string, URL | null>();
  for (const [key, value] of Object.entries(entries)) {
    if (!key) continue;
    const name = urlLike(key, base)?.href ?? key;
    const address = typeof value === 'string' ? urlLike(value, base) : null;
    normalized.set(name, name.endsWith('/') && !address?.href.endsWith('/') ? null : address);
  }
  for (const [key, address] of normalized) if (!target.has(key)) target.set(key, address);
}

// undefined means no match. A null match explicitly blocks resolution, including fallback to outer scopes.
function match(map: SpecifierMap | undefined, name: string, asUrl: URL | null) {
  if (!map?.size) return;
  const exact = map.get(name);
  if (exact !== undefined) return exact;
  if (asUrl && !['http:', 'https:', 'file:', 'ftp:', 'ws:', 'wss:'].includes(asUrl.protocol)) return;
  for (const [length, address] of map.matchingPrefixes(name)) {
    if (!address) return null;
    const target = URL.parse(name.slice(length), address);
    return target?.href.startsWith(address.href) ? target : null;
  }
}

export class PageImportMap {
  private readonly imports: SpecifierMap = new PrefixMap();
  private readonly scopes = new PrefixMap<SpecifierMap>();

  addInline(source: string, base: URL) {
    let data: unknown;
    try { data = JSON.parse(source); } catch { return false; }
    if (!object(data) || ['imports', 'scopes', 'integrity'].some((key) => Object.hasOwn(data, key) && !object(data[key]))) return false;
    if (object(data.imports)) mergeBindings(this.imports, data.imports, base);
    if (object(data.scopes)) for (const [key, entries] of Object.entries(data.scopes)) {
      const scope = URL.parse(key, base);
      if (!scope || !object(entries)) continue;
      const map = this.scopes.get(scope.href) ?? new PrefixMap<URL | null>();
      mergeBindings(map, entries, base);
      this.scopes.set(scope.href, map);
    }
    return true;
  }

  resolve(specifier: string, referrer: URL) {
    const asUrl = urlLike(specifier, referrer);
    const name = asUrl?.href ?? specifier;
    const exact = match(this.scopes.get(referrer.href), name, asUrl);
    if (exact !== undefined) return exact;
    for (const [, bindings] of this.scopes.matchingPrefixes(referrer.href)) {
      const scoped = match(bindings, name, asUrl);
      if (scoped !== undefined) return scoped;
    }
    const global = match(this.imports, name, asUrl);
    return global === undefined ? asUrl : global;
  }
}
