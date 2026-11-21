import { parse as parseJavaScript } from '@babel/parser';
import { traverseFast } from '@babel/types';
import postcss from 'postcss';
import parseValue from 'postcss-value-parser';

export type SourceKind = 'module' | 'script' | 'stylesheet';
export type AssetKind = SourceKind | 'font';
export type Dependencies = {
  refs: { value: string; kind: 'module' | 'stylesheet' | 'font' }[];
  computed: number;
};

export function sourceDependencies(kind: SourceKind, source: string): Dependencies {
  const result: Dependencies = { refs: [], computed: 0 };
  if (kind === 'stylesheet') {
    // A source-map annotation is page data. Parsing CSS must never load its map.
    const sheet = postcss.parse(source, { map: false, from: undefined });
    for (const node of sheet.nodes) {
      if (node.type === 'comment') continue;
      if (node.type !== 'atrule' || node.nodes) break;
      const name = node.name.toLowerCase();
      if (name === 'charset' || name === 'layer') continue;
      if (name !== 'import') break;
      const first = parseValue(node.params).nodes.find((n) => n.type !== 'space' && n.type !== 'comment');
      const value = first?.type === 'string' && !first.unclosed ? cssUnescape(first.value) : literalUrl(first);
      if (value) result.refs.push({ kind: 'stylesheet', value });
    }
    sheet.walkAtRules(/^font-face$/i, (rule) => {
      rule.each((decl) => {
        if (decl.type !== 'decl' || decl.prop.toLowerCase() !== 'src') return;
        for (const node of parseValue(decl.value).nodes) {
          const value = literalUrl(node);
          if (value) result.refs.push({ kind: 'font', value });
        }
      });
    });
    return result;
  }
  if (!source.includes('import') && !source.includes('export')) return result;
  const tree = parseJavaScript(source, { sourceType: kind, createImportExpressions: true, attachComment: false });
  traverseFast(tree.program, (node) => {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      if (node.source) result.refs.push({ kind: 'module', value: node.source.value });
    } else if (node.type === 'ImportExpression') {
      const target = node.source;
      if (target.type === 'StringLiteral') result.refs.push({ kind: 'module', value: target.value });
      else if (target.type === 'TemplateLiteral' && !target.expressions.length && target.quasis[0].value.cooked != null)
        result.refs.push({ kind: 'module', value: target.quasis[0].value.cooked });
      else result.computed++;
    }
  });
  return result;
}

function cssUnescape(value: string) {
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\r\n\f])|([\s\S]))/g,
    (_match, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
      if (!hex) return newline ? '' : char ?? '';
      const code = parseInt(hex, 16);
      return code && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
    });
}

function literalUrl(node: parseValue.Node | undefined) {
  if (node?.type !== 'function' || node.value.toLowerCase() !== 'url' || node.unclosed) return;
  const args = node.nodes;
  if (args.length === 1 && args[0].type === 'string' && !args[0].unclosed) return cssUnescape(args[0].value);
  if (!args.length || args.some((arg) => arg.type !== 'word' && arg.type !== 'div')) return;
  const raw = parseValue.stringify(args);
  if (/[\s"'()]/.test(raw.replace(/\\(?:[0-9a-fA-F]{1,6}\s?|.)/g, ''))) return;
  return cssUnescape(raw);
}
