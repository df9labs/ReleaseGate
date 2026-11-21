import { sql } from 'drizzle-orm';
import type { Analysis as AnalysisRecord, Bug, Repair, Verification } from '../src/api';
import {
  createConfiguredEngine,
  type BugInput,
  type DemoEngine,
  type ProposalOnlyEngine,
  type PolicyInput,
  type Proof,
} from './engine/index';
import type { Actor, Store, Work } from './storage';
import type { AppEnvironment } from './auth';
import { ensure, textField, choice, strings, httpUrl, now, uid, type Fields } from './support';

const analysisLease = 5 * 60_000;
export function workflow(
  store: Store,
  env: AppEnvironment,
  engine: DemoEngine | ProposalOnlyEngine = createConfiguredEngine(env),
) {
  function input(bug: Bug): BugInput {
    return {
      id: bug.id,
      revision: bug.revision,
      title: bug.title,
      description: bug.description,
      affectedArea: bug.affected_module,
      expected: bug.expected_behavior || '',
      actual: bug.actual_behavior || '',
      severity: bug.severity,
      evidence: bug.evidence || '',
    };
  }
  function policy(bug: Bug): PolicyInput {
    const candidate = bug.duplicate_candidate_id ? store.getBug(bug.duplicate_candidate_id).bug : null;
    return {
      automationEnabled: store.settings().automation_enabled,
      canonical: candidate
        ? {
            id: candidate.id,
            title: candidate.title,
            revision: candidate.revision,
            affectedArea: candidate.affected_module,
            severity: candidate.severity,
          }
        : null,
    };
  }
  async function analyse(id: string, actor: Actor, deep = false) {
    const ticket = uid();
    const original = store.transaction(() => {
      const { bug, work } = store.getBug(id);
      ensure(
        [
          'new',
          'needs_manual_investigation',
          'needs_evidence',
          'ready_for_repair',
          'reopened',
          'preview_failed',
          'triage_in_progress',
        ].includes(bug.status),
        409,
        'Reopen the report before a new analysis.',
      );
      ensure(
        !work.analysisTicket || Date.now() - Date.parse(bug.updated_date) >= analysisLease,
        409,
        'An analysis is already in progress.',
      );
      ensure(!deep || bug.analysis_count > 0, 409, 'Run an initial analysis first.');
      const currentPolicy = policy(bug);
      bug.status = 'triage_in_progress';
      bug.ai_triage_status = 'running';
      work.analysisTicket = ticket;
      store.saveBug(bug, work);
      store.audit(
        actor,
        'bug.triage.started',
        'BugRecord',
        id,
        'Analysis started for the current evidence.',
        bug,
      );
      return { input: input(bug), policy: currentPolicy };
    });
    const outcome = await engine
      .analyse(original.input, original.policy)
      .then((analysis) => ({
        analysis,
        proposal: engine.propose(original.input, analysis, original.policy),
      }))
      .catch(() => null);
    return store.transaction(() => {
      const { bug, work } = store.getBug(id);
      ensure(
        work.analysisTicket === ticket && bug.revision === original.input.revision,
        409,
        'Evidence changed during analysis. Run a fresh pass.',
      );
      const proposal = outcome?.proposal;
      const reasons = proposal?.safetyReasons ?? ['AI analysis failed safely'];
      const seq = bug.analysis_count + 1;
      const record: AnalysisRecord = {
        id: uid(),
        bug_record_id: id,
        analysis_sequence: seq,
        analysis_pass: deep ? 'deep' : 'first_pass',
        analysis_status: outcome ? 'completed' : 'failed',
        analysis_model:
          engine.mode === 'demo' ? 'DF9 deterministic preview' : env.LLM_MODEL || 'Configured analyser',
        analyzed_at: now(),
        summary: outcome?.analysis.diagnosis ?? null,
        suspected_cause: outcome?.analysis.diagnosis ?? null,
        proposed_fix: proposal?.summary ?? null,
        alternative_hypothesis: null,
        implementation_prompt: proposal?.steps.join('\n') ?? null,
        confidence: outcome?.analysis.confidence ?? 0,
        risk_level: outcome?.analysis.risk ?? 'high',
        safety_decision: proposal?.safetyDecision ?? 'manual_only',
        safety_reasons: reasons,
        evidence_supporting: bug.evidence ? [bug.evidence] : [],
        missing_information: [],
        affected_areas: [bug.affected_module],
        regression_risks: [],
        repair_checks: proposal?.checks ?? [],
        failure_reason: outcome
          ? null
          : 'Analysis could not be completed. The report is preserved for manual investigation.',
      };
      store.addHistory(id, 'analysis', record);
      Object.assign(bug, {
        latest_analysis_id: record.id,
        analysis_count: seq,
        ai_summary: record.summary,
        ai_confidence: record.confidence,
        ai_risk_level: record.risk_level,
        suspected_cause: record.suspected_cause,
        proposed_fix: record.proposed_fix,
        affected_areas: record.affected_areas,
        repair_checks: record.repair_checks,
        safety_decision: record.safety_decision,
        safety_reasons: reasons,
        safe_fix_eligible: record.safety_decision === 'eligible',
        requires_manual_investigation: record.safety_decision === 'manual_only',
        ai_triage_status: record.analysis_status,
        analysis_engine: engine.mode,
        analysis_stale: false,
        repair_status: record.safety_decision === 'manual_only' ? 'needs_manual' : 'proposed',
        repair_mode:
          record.safety_decision === 'eligible' ? 'allowlisted_automation' : 'controlled_preview',
        repair_recipe_id: record.safety_decision === 'eligible' ? 'workflow.mark_duplicate' : null,
        status:
          record.safety_decision === 'manual_only' ? 'needs_manual_investigation' : 'ready_for_repair',
        gate_status: null,
      });
      store.saveBug(bug, { proposal });
      store.audit(
        actor,
        outcome ? 'bug.triage.completed' : 'bug.triage.failed',
        'BugRecord',
        id,
        reasons.join(' '),
        bug,
      );
      return { bug, analysis_failed: !outcome };
    });
  }
  function demo(bug: Bug, work: Work) {
    ensure(
      work.proposal,
      409,
      'This record has no saved proposal. Open Analysis and run a fresh pass before planning a repair.',
    );
    ensure(
      engine.mode === 'demo' && work.proposal.engine === 'demo',
      409,
      'The external analyser stops at a proposal for human review.',
    );
    ensure(
      !bug.analysis_stale && work.proposal.revision === bug.revision,
      409,
      'The proposal is stale.',
    );
    return { runner: engine, proposal: work.proposal };
  }
  function begin(id: string, body: Fields, actor: Actor) {
    const { bug, work } = store.getBug(id);
    ensure(
      ['ready_for_repair', 'needs_manual_investigation', 'preview_failed'].includes(bug.status),
      409,
      'This report is outside the planning stage.',
    );
    demo(bug, work);
    const plan: Repair = {
      id: uid(),
      bug_record_id: id,
      attempt_sequence: store.history(id, 'repair').length + 1,
      status: 'planned',
      mode: 'controlled_preview',
      summary: textField(body, 'summary', true),
      checkpoint_reference: textField(body, 'checkpoint_reference', true),
      planned_tests: strings(body.planned_tests, 'planned tests'),
      affected_resources: strings(body.affected_resources, 'affected resources'),
    };
    store.addHistory(id, 'repair', plan);
    bug.status = 'repair_in_progress';
    bug.repair_status = 'planned';
    bug.repair_mode = 'controlled_preview';
    delete work.proof;
    delete work.gate;
    delete work.change;
    store.saveBug(bug, work);
    store.audit(actor, 'repair.planned', 'RepairAttempt', plan.id, plan.summary, bug);
    return { bug };
  }
  function implement(id: string, body: Fields, actor: Actor) {
    const { bug, work } = store.getBug(id);
    ensure(bug.status === 'repair_in_progress', 409, 'Plan a controlled preview repair first.');
    const { runner, proposal } = demo(bug, work);
    const summary = textField(body, 'summary', true),
      evidence = textField(body, 'evidence', true),
      reference = textField(body, 'reference');
    const attempt = store.history<Repair>(id, 'repair')[0];
    ensure(attempt?.status === 'planned', 409, 'A planned repair is required.');
    work.change = runner.applyToPreview(input(bug), proposal, policy(bug));
    attempt.status = 'applied';
    attempt.implementation_evidence = evidence;
    store.db.run(sql`UPDATE bug_history SET doc=${JSON.stringify(attempt)} WHERE id=${attempt.id}`);
    Object.assign(bug, {
      status: 'awaiting_preview_verification',
      repair_status: 'applied',
      implementation_summary: summary,
      implementation_reference: reference || work.change.checkpoint,
      implementation_evidence: evidence,
    });
    store.saveBug(bug, work);
    store.audit(actor, 'repair.implemented', 'RepairAttempt', attempt.id, summary, bug);
    return { bug };
  }
  function persistPreview(
    bug: Bug,
    work: Work,
    actor: Actor,
    proof: Proof,
    result: string,
    note: string,
    expected: string,
    observed: string,
  ) {
    const verification: Verification = {
      id: uid(),
      bug_record_id: bug.id,
      environment: 'preview',
      method: 'demo_fixture',
      verified_at: now(),
      result,
      expected_result: expected,
      observed_result: observed,
      evidence: note,
      proof,
    };
    store.addHistory(bug.id, 'verification', verification);
    bug.preview_verification_status = result;
    bug.preview_evidence = note;
    bug.preview_verified_at = verification.verified_at;
    work.proof = proof;
    store.audit(
      actor,
      'preview.' + result,
      'Verification',
      verification.id,
      proof.fixture + ' · ' + note,
      bug,
    );
  }
  function setGate(
    bug: Bug,
    work: Work,
    actor: Actor,
    route: 'human' | 'automatic',
    approved: boolean,
    reason: string,
  ) {
    const proof = work.proof;
    ensure(proof?.passed, 409, 'Passing preview proof is required.');
    const gate = { route, approved, reason, receipt: proof.receipt, revision: bug.revision };
    work.gate = gate;
    store.addHistory(bug.id, 'gate', { ...gate, id: uid(), actor: actor.email });
    bug.gate_status = approved ? (route === 'automatic' ? 'automatic' : 'approved') : 'rejected';
    bug.status = approved ? 'awaiting_production_verification' : 'blocked';
    store.audit(actor, 'gate.' + bug.gate_status, 'BugRecord', bug.id, reason, bug);
  }
  function verify(id: string, body: Fields, actor: Actor) {
    const { bug, work } = store.getBug(id);
    const environment = choice(body.environment, ['preview', 'live'], 'environment');
    const result = choice(
      body.result,
      ['passed', 'failed', 'blocked', 'inconclusive', 'published_unverified'],
      'result',
    );
    const observed = textField(body, 'observed_result', true),
      evidence = textField(body, 'evidence', true);
    const expected = textField(body, 'expected_result') || bug.expected_behavior || '';
    if (environment === 'live') {
      ensure(
        bug.linked_version_record_id &&
          store.version(bug.linked_version_record_id).release_status === 'released',
        409,
        'Release the linked version before recording Live proof.',
      );
      releaseReady(bug, work);
      ensure(
        bug.production_verification_status !== 'passed',
        409,
        'Live proof has already been recorded.',
      );
      liveProof(bug, work, actor, result, evidence, observed, expected, httpUrl(textField(body, 'url')));
    } else {
      ensure(
        bug.status === 'awaiting_preview_verification' && work.change,
        409,
        'Apply the preview repair before collecting proof.',
      );
      const { runner, proposal } = demo(bug, work);
      const proof = runner.gatherProof(work.change);
      const gate = runner.decide(input(bug), proposal, proof, policy(bug));
      ensure(
        gate.route !== 'blocked' && proof.passed,
        409,
        'Current preview checks failed or the proposal is stale.',
      );
      persistPreview(bug, work, actor, proof, result, evidence, expected, observed);
      if (result === 'passed') {
        bug.status = 'awaiting_production_verification';
        bug.gate_status = 'pending';
        if (gate.route === 'automatic')
          setGate(bug, work, actor, 'automatic', true, gate.reasons.join(' '));
      } else {
        bug.status = 'preview_failed';
        bug.gate_status = null;
      }
      store.saveBug(bug, work);
    }
    return { bug };
  }
  function applySafe(id: string, actor: Actor) {
    const { bug, work } = store.getBug(id);
    const { runner, proposal } = demo(bug, work);
    ensure(
      bug.status === 'ready_for_repair' && bug.safe_fix_eligible && proposal.family === 'duplicate',
      409,
      'No eligible workflow recipe exists.',
    );
    const current = policy(bug);
    const change = runner.applyToPreview(input(bug), proposal, current);
    const proof = runner.gatherProof(change),
      gate = runner.decide(input(bug), proposal, proof, current);
    ensure(gate.route === 'automatic' && proof.passed, 409, 'Current policy requires human review.');
    const repair: Repair = {
      id: uid(),
      bug_record_id: id,
      attempt_sequence: store.history(id, 'repair').length + 1,
      mode: 'allowlisted_automation',
      summary: proposal.summary,
      checkpoint_reference: change.checkpoint,
      status: 'applied',
      implementation_evidence: proof.after,
    };
    store.addHistory(id, 'repair', repair);
    work.change = change;
    persistPreview(bug, work, actor, proof, 'passed', proof.receipt, proof.before, proof.after);
    setGate(bug, work, actor, 'automatic', true, gate.reasons.join(' '));
    Object.assign(bug, {
      status: 'duplicate',
      repair_status: 'applied',
      repair_mode: 'allowlisted_automation',
      implementation_summary: proposal.summary,
      implementation_reference: change.checkpoint,
      implementation_evidence: proof.after,
    });
    store.saveBug(bug, work);
    store.audit(
      actor,
      'repair.duplicate.applied',
      'RepairAttempt',
      repair.id,
      'Bound duplicate linked to ' + current.canonical!.id,
      bug,
    );
    return { bug };
  }
  function gate(id: string, body: Fields, actor: Actor) {
    const { bug, work } = store.getBug(id);
    ensure(
      bug.gate_status === 'pending' && bug.preview_verification_status === 'passed' && work.proof,
      409,
      'No current decision is pending.',
    );
    const answer = choice(body.decision, ['approve', 'reject'], 'decision'),
      reason = textField(body, 'reason', true);
    const { runner, proposal } = demo(bug, work);
    const decision = runner.decide(input(bug), proposal, work.proof, policy(bug));
    ensure(decision.route !== 'blocked', 409, 'The proposal or proof is stale.');
    setGate(bug, work, actor, 'human', answer === 'approve', reason);
    store.saveBug(bug, work);
    return { bug };
  }
  function releaseReady(bug: Bug, work: Work) {
    ensure(
      !bug.analysis_stale &&
        bug.preview_verification_status === 'passed' &&
        work.proof?.passed &&
        work.gate?.approved &&
        work.gate.revision === bug.revision &&
        work.gate.receipt === work.proof.receipt,
      409,
      'Current preview proof and gate approval are required.',
    );
    const { runner, proposal } = demo(bug, work);
    const decision = runner.decide(input(bug), proposal, work.proof, policy(bug));
    ensure(
      decision.route !== 'blocked' &&
        (work.gate.route !== 'automatic' || decision.route === 'automatic'),
      409,
      'Release proof is stale under the current policy.',
    );
    return work.proof.receipt;
  }
  function liveProof(
    bug: Bug,
    work: Work,
    actor: Actor,
    result: string,
    evidence: string,
    observed: string,
    expected: string,
    url = '',
  ) {
    const at = now();
    const entry: Verification = {
      id: uid(),
      bug_record_id: bug.id,
      environment: 'live',
      result,
      evidence,
      observed_result: observed,
      expected_result: expected,
      url,
      method: 'human_attestation',
      verified_at: at,
      build_reference: bug.linked_semantic_version || '',
    };
    store.addHistory(bug.id, 'verification', entry);
    Object.assign(bug, {
      status: result === 'passed' ? 'resolved' : 'awaiting_production_verification',
      production_verification_status: result,
      production_evidence: evidence,
      production_verified_at: at,
    });
    store.saveBug(bug, work);
    store.audit(actor, 'live.' + result, 'Verification', entry.id, evidence, bug);
  }
  return { analyse, begin, implement, verify, applySafe, gate, releaseReady, liveProof };
}
export type Workflow = ReturnType<typeof workflow>;
