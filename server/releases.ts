import { sql } from 'drizzle-orm';
import type { Actor, Store } from './storage';
import type { Workflow } from './workflow';
import type { Version } from '../src/api';
import { ensure, textField, choice, strings, uid, now, type Fields } from './support';

export function releases(store: Store, flow: Workflow) {
  const { db } = store;
  function create(body: Fields, actor: Actor) {
    const semantic = textField(body, 'semantic_version', true, 128);
    // Each self-serve account numbers its own versions; the operator keeps the plain key.
    const versionKey = actor.role === 'admin' ? semantic : semantic + '#' + actor.id;
    ensure(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(
        semantic,
      ),
      422,
      'Enter a semantic version.',
    );
    ensure(
      !db.get(sql`SELECT id FROM versions WHERE semantic_version=${versionKey}`),
      409,
      'This version already exists.',
    );
    const ids = [...new Set(strings(body.linked_bug_ids, 'linked reports'))];
    const links = ids.map((id) => {
      const { bug, work } = store.getBug(id);
      ensure(!bug.linked_version_record_id, 409, 'This report already has a linked version.');
      return { bug, work, receipt: flow.releaseReady(bug, work) };
    });
    const qa = choice(
      body.qa_status ?? 'not_tested',
      ['not_tested', 'partial', 'passed', 'failed', 'blocked'],
      'QA status',
    );
    const preview = choice(
      body.preview_status ?? 'not_tested',
      ['not_tested', 'partial', 'passed', 'failed'],
      'preview status',
    );
    const startingStatus = choice(
      body.release_status ?? 'draft',
      ['draft', 'preview_verified'],
      'initial release status',
    );
    const evidence = textField(body, 'preview_evidence') || links.map((l) => l.receipt).join('\n');
    ensure(
      (preview !== 'passed' && startingStatus !== 'preview_verified') || evidence,
      422,
      'Passing preview requires evidence.',
    );
    ensure(
      startingStatus !== 'preview_verified' || links.length || preview === 'passed',
      422,
      'A preview-verified version requires passed preview checks.',
    );
    const version: Version = {
      id: uid(),
      semantic_version: semantic,
      title: textField(body, 'title', true, 240),
      summary: textField(body, 'summary', true),
      changes: textField(body, 'changes', true),
      reason: textField(body, 'reason', true),
      change_type: choice(
        body.change_type ?? 'fix',
        ['baseline', 'feature', 'fix', 'refinement', 'architecture', 'security'],
        'change type',
      ),
      release_status: startingStatus,
      implementation_status: 'saved',
      implementation_evidence:
        textField(body, 'implementation_evidence') ||
        links
          .map((l) => l.bug.implementation_evidence)
          .filter(Boolean)
          .join('\n'),
      source_checkpoint:
        textField(body, 'source_checkpoint') ||
        links
          .map((l) => l.bug.implementation_reference)
          .filter(Boolean)
          .join(', '),
      qa_status: qa,
      qa_notes: textField(body, 'qa_notes'),
      preview_status: links.length ? 'passed' : preview,
      preview_evidence: evidence,
      production_status: 'not_published',
      production_evidence: '',
      known_issues: textField(body, 'known_issues'),
      rollback_notes: textField(body, 'rollback_notes'),
      linked_bug_ids: ids,
      linked_bug_numbers: links.map((l) => l.bug.bug_number),
      recorded_at: now(),
      is_synthetic: false,
    };
    if (version.preview_status === 'passed') {
      ensure(
        version.source_checkpoint && version.implementation_evidence,
        422,
        'Supply a source checkpoint and implementation evidence for a preview-proven version.',
      );
    }
    db.run(
      sql`INSERT INTO versions VALUES (${version.id},${versionKey},${version.recorded_at},${JSON.stringify(actor.role === 'admin' ? version : { ...version, owner_id: actor.id })})`,
    );
    for (const { bug, work, receipt } of links) {
      db.run(sql`INSERT INTO version_bugs VALUES (${version.id},${bug.id},${bug.revision},${receipt})`);
      bug.linked_version_record_id = version.id;
      bug.linked_semantic_version = semantic;
      store.saveBug(bug, work);
    }
    store.audit(
      actor,
      'version.created',
      'VersionRecord',
      version.id,
      'Recorded ' + semantic + ' with ' + links.length + ' linked reports.',
    );
    return { version };
  }
  function activeLinks(id: string) {
    return db
      .all<{ bug_id: string; revision: number; receipt: string }>(
        sql`SELECT * FROM version_bugs WHERE version_id=${id}`,
      )
      .map((link) => {
        const { bug, work } = store.getBug(link.bug_id);
        ensure(
          bug.linked_version_record_id === id &&
            bug.revision === link.revision &&
            flow.releaseReady(bug, work) === link.receipt,
          409,
          'A linked report changed after this version was recorded.',
        );
        return { bug, work };
      });
  }
  function release(id: string, actor: Actor) {
    const version = store.version(id);
    ensure(
      ['draft', 'preview_verified'].includes(version.release_status),
      409,
      'This version has already been released.',
    );
    ensure(
      version.preview_status === 'passed' && version.preview_evidence?.trim(),
      409,
      'Preview must pass with evidence first.',
    );
    ensure(
      version.source_checkpoint?.trim() && version.implementation_evidence?.trim(),
      409,
      'The version requires a source checkpoint and implementation evidence.',
    );
    for (const { bug, work } of activeLinks(id)) {
      bug.production_verification_status = 'published_unverified';
      store.saveBug(bug, work);
    }
    version.release_status = 'released';
    version.production_status = 'published_unverified';
    version.released_at = now();
    db.run(sql`UPDATE versions SET doc=${JSON.stringify(version)} WHERE id=${id}`);
    store.audit(
      actor,
      'version.released',
      'VersionRecord',
      id,
      'Recorded the local release of ' + version.semantic_version + '.',
    );
    return { version };
  }
  function verify(id: string, body: Fields, actor: Actor) {
    const version = store.version(id);
    ensure(
      version.release_status === 'released' && version.production_status !== 'passed',
      409,
      'An unverified released version is required.',
    );
    const result = choice(
      body.result,
      ['passed', 'partial', 'failed', 'published_unverified'],
      'live result',
    );
    const evidence = textField(body, 'evidence', true);
    for (const { bug, work } of activeLinks(id)) {
      if (bug.production_verification_status !== result || bug.production_evidence !== evidence) {
        flow.liveProof(bug, work, actor, result, evidence, evidence, bug.expected_behavior || '');
      }
    }
    version.production_status = result;
    version.production_evidence = evidence;
    db.run(sql`UPDATE versions SET doc=${JSON.stringify(version)} WHERE id=${id}`);
    store.audit(actor, 'version.live.' + result, 'VersionRecord', id, evidence);
    return { version };
  }
  return { create, release, verify };
}
