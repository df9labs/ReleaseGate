import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDependencies } from '../server/health-asset-imports';
import { PageImportMap } from '../server/health-import-map';

test('JavaScript parsing finds side effects, declarations, re-exports and literal dynamic imports only in executable syntax', () => {
  const source = [
    'import "./init.js"; import {a} from "./shape.js";',
    'export * from "./all.js"; export {b as c} from "library";',
    '// import("./comment.js")',
    'const text = "import(\\\"./string.js\\\")";',
    'const re = /import\\(".\\/regex.js"\\)/;',
    'const sample = `export * from "./template.js"`;',
    'function lazy() { return import(/* webpackChunkName: "scene" */ "./sc\\u0065ne.js") }',
    'const other = import(`./literal.js`); const computed = import("./" + a);',
    'const template = import(`./${a}.js`); import.meta.resolve("unused");',
    'const obj = { import() {} }; obj.import("unused");',
  ].join('\n');
  const { refs, computed } = sourceDependencies('module', source);
  assert.deepEqual(refs.map((r) => r.value), ['./init.js', './shape.js', './all.js', 'library', './scene.js', './literal.js']);
  assert.equal(computed, 2);
  assert.deepEqual(sourceDependencies('script', 'window.lazy = () => import("./helper.js")').refs,
    [{ kind: 'module', value: './helper.js' }]);
});

test('CSS parsing reads top-level stylesheet imports and actual font-face src URLs', () => {
  const { refs } = sourceDependencies('stylesheet', [
    '@charset "UTF-8"; @layer foundation; /* @import "fake.css"; */',
    '@import "./base.css" layer(foundation); @import url(../print.css) print;',
    '@media screen { @font-face { font-family: Demo; src: local("Demo"),',
    'url("./space\\20 font.woff2") format("woff2"), URL(https://unpkg.com/f/demo.ttf); } }',
    '.poster { background: url("not-a-font.woff2"); content: "@import url(fake.css)"; }',
    '@import "too-late.css";',
  ].join('\n'));
  assert.deepEqual(refs, [
    { kind: 'stylesheet', value: './base.css' }, { kind: 'stylesheet', value: '../print.css' },
    { kind: 'font', value: './space font.woff2' }, { kind: 'font', value: 'https://unpkg.com/f/demo.ttf' },
  ]);
});

test('inline maps resolve relative to their document base, using exact names, longest prefixes and scopes', () => {
  const map = new PageImportMap(), base = new URL('https://owned.example/assets/');
  assert.ok(map.addInline(JSON.stringify({
    imports: { lenis: 'https://cdn.jsdelivr.net/npm/lenis@1/+esm', 'pkg/': './vendor/', 'pkg/ui/': './ui/',
      './old.js': './new.js', blocked: null, invalid: 'bare-target' },
    scopes: { './js/': { lenis: './scoped.js' }, './js/admin/': {other: './admin.js'}, './js/pinned.js': {lenis: null} },
  }), base));
  assert.ok(map.addInline('{"imports":{"lenis":"./wrong.js","later":"./later.js"}}', base));
  const resolve = (value: string, file = 'js/admin/app.js') => map.resolve(value, new URL(file, base))?.href;
  assert.equal(resolve('lenis'), base.href + 'scoped.js');
  assert.equal(resolve('other'), base.href + 'admin.js');
  assert.equal(resolve('pkg/ui/tab.js'), base.href + 'ui/tab.js');
  assert.equal(resolve('../../old.js'), base.href + 'new.js');
  assert.equal(resolve('lenis', 'main.js'), 'https://cdn.jsdelivr.net/npm/lenis@1/+esm');
  assert.equal(resolve('later'), base.href + 'later.js');
  assert.equal(resolve('./sibling.js'), base.href + 'js/admin/sibling.js');
  assert.equal(resolve('/root.js'), base.origin + '/root.js');
  assert.equal(resolve('pkg/../escape.js'), undefined);
  for (const value of ['missing', 'blocked', 'invalid']) assert.equal(resolve(value), undefined);
  assert.equal(resolve('lenis', 'js/pinned.js'), undefined);
  assert.equal(map.addInline('{bad json}', base), false);
  assert.equal(map.addInline('{"imports":[]}', base), false);
});
