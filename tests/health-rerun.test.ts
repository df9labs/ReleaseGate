import assert from 'node:assert/strict';
import test from 'node:test';
import { completeHealthcheck, prepareHealthcheck } from '../server/healthchecks';
import { canRerunDirectly, needsRerunUrl, settingsForRerun } from '../src/health-rerun';

const evidence = { pages: [], checks: [], limitations: [] };
const input = prepareHealthcheck({
  authorization_attested: true, target_url: 'https://site.example/pricing', target_name: 'Pricing',
  target_type: 'website', environment: 'live', current_version: '1.2', scope_notes: 'Pricing and plans',
  max_pages: 7, browser_checks: true,
  button_journeys: [{button:'Show plans', expected_text:'Monthly plans'}],
  supplied_evidence: 'PASS: Checked by hand',
  suite_results: [{name:'Create account', outcome:'passed'}],
});
const run = completeHealthcheck(input, 'HC-1', evidence);

test('one-click repeat settings preserve scope and discard every previous result', () => {
  const settings = settingsForRerun(run);
  assert.ok(canRerunDirectly(run));
  assert.deepEqual(settings, {
    target_name:'Pricing', target_type:'website', target_url:'https://site.example/pricing',
    sample_site:false, environment:'live', current_version:'1.2', scope_notes:'Pricing and plans',
    follow_links:true, max_pages:7, browser_checks:true, button_journeys:input.button_journeys,
    supplied_evidence:'', suite_results:[], authorization_attested:false,
  });
  settings.button_journeys![0].button = 'Changed';
  assert.equal(run.button_journeys![0].button, 'Show plans');
  assert.equal(canRerunDirectly({...run, authorization_attested:false}), false);
});

test('sample runs repeat without submitting their local preview path', () => {
  const sample = completeHealthcheck(prepareHealthcheck({
    sample_site:true, follow_links:false, browser_checks:false, authorization_attested:true,
  }), 'HC-2', evidence);
  assert.ok(canRerunDirectly(sample));
  assert.equal(sample.target_url, '/healthcheck-sample/');
  const fresh = prepareHealthcheck({...settingsForRerun(sample), authorization_attested:true});
  assert.deepEqual([fresh.target_url, fresh.sample_site, fresh.follow_links, fresh.max_pages, fresh.browser_checks],
    ['', true, false, 1, false]);
});

test('omitted original queries and fragments require a fresh URL without leaking their values', () => {
  for (const part of ['?view=region','#/route','?','#']) {
    const url = 'https://site.example/pricing' + part;
    const saved = completeHealthcheck({...input, target_url:url}, 'HC-3', evidence);
    assert.equal(saved.target_url, 'https://site.example/pricing');
    assert.ok(needsRerunUrl(saved));
    assert.equal(canRerunDirectly(saved), false);
    assert.equal(settingsForRerun(saved).target_url, '');
    assert.equal(settingsForRerun(saved).max_pages, 7);
    assert.ok(!JSON.stringify(saved).includes(url));
  }
  const legacyQuery = {...run, target_url_needs_input:undefined, limitations:[
    'The start URL contains a query. Browser replay needs a query-free address to reproduce its location.',
  ]};
  assert.ok(needsRerunUrl(legacyQuery));
  assert.equal(canRerunDirectly(legacyQuery), false);
});

test('old local HTTP-only runs keep their original mode and imported or manual runs open as drafts', () => {
  const old = {...run, browser_checks:undefined, button_journeys:undefined, target_url_needs_input:undefined,
    max_pages:undefined, follow_links:undefined};
  assert.ok(canRerunDirectly(old));
  const repeat = settingsForRerun(old);
  assert.equal(repeat.browser_checks, false);
  assert.deepEqual(repeat.button_journeys, []);
  assert.equal(repeat.max_pages, 4);
  const imported = {...old, check_source:undefined};
  assert.equal(canRerunDirectly(imported), false);
  assert.equal(settingsForRerun(imported).target_url, run.target_url);
  assert.equal(settingsForRerun(imported).browser_checks, true);
  const manual = completeHealthcheck({...input, target_url:''}, 'HC-4');
  assert.equal(canRerunDirectly(manual), false);
  assert.equal(settingsForRerun(manual).target_url, '');
  assert.deepEqual(settingsForRerun(manual).suite_results, []);
  for (const url of ['', 'about:blank', '/healthcheck-sample/', 'https://account:private@site.example/']) {
    assert.equal(canRerunDirectly({...run, target_url:url}), false);
    assert.equal(settingsForRerun({...run, target_url:url}).target_url, '');
  }
});
