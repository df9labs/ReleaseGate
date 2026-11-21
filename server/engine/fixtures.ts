import {
  EngineError,
  type PreviewChange,
  type PreviewState,
  type Proof,
  type Proposal,
} from './contracts.ts';
import { fingerprint } from './policy.ts';

export const fixturePlans = {
  disclosure: {
    diagnosis: 'The demo card receives an activation but its detail stays collapsed.',
    summary: 'Connect the local card control to its open state.',
    steps: [
      'Checkpoint the inactive card handler.',
      'Enable toggling for the activated card in the isolated preview.',
    ],
    checks: [
      'The selected card opens on activation.',
      'A second activation closes it.',
      'A neighbouring card keeps its state.',
    ],
  },
  'build-label': {
    diagnosis: 'The demo build badge exposes raw version text and omits its build caption.',
    summary: 'Normalise the display of a build reference in the local preview.',
    steps: [
      'Checkpoint the raw label formatter.',
      'Format a trimmed version with its Build caption and provide an empty-state label.',
    ],
    checks: [
      'The badge renders Build 0.1.0.',
      'An empty version displays Build pending.',
      'A prerelease suffix survives formatting.',
    ],
  },
  duplicate: {
    diagnosis:
      'The report explicitly identifies an existing canonical issue, but is still included in the active queue.',
    summary: 'Apply workflow.mark_duplicate to the isolated queue record.',
    steps: [
      'Checkpoint the report and its canonical reference.',
      'Link the duplicate metadata to the confirmed canonical record.',
    ],
    checks: [
      'The report links to the confirmed canonical ID.',
      'The duplicate leaves the active queue.',
      'The canonical issue remains open.',
    ],
  },
};

function initialState(proposal: Proposal): PreviewState {
  if (proposal.family === 'build-label') return { kind: 'build-label', normalise: false };
  if (proposal.family === 'duplicate') {
    if (!proposal.canonical)
      throw new EngineError('invalid_input', 'A canonical issue is required for this fixture.');
    return {
      kind: 'duplicate',
      bugId: proposal.bugId,
      canonicalId: proposal.canonical.id,
      duplicateOf: null,
    };
  }
  return { kind: 'disclosure', activation: 'ignore' };
}

function applyFixtureChange(before: PreviewState): PreviewState {
  switch (before.kind) {
    case 'disclosure':
      return { ...before, activation: 'toggle' };
    case 'build-label':
      return { ...before, normalise: true };
    case 'duplicate':
      return { ...before, duplicateOf: before.canonicalId };
  }
}

export function applyFixture(proposal: Proposal): PreviewChange {
  const before = initialState(proposal);
  return {
    proposalId: proposal.proposalId,
    bugId: proposal.bugId,
    revision: proposal.revision,
    inputFingerprint: proposal.inputFingerprint,
    family: proposal.family,
    before,
    after: applyFixtureChange(before),
    checkpoint: fingerprint(['releasegate.checkpoint.v1', proposal.proposalId, before]),
  };
}

export function restorePreview(change: PreviewChange): PreviewState {
  const expected = fingerprint(['releasegate.checkpoint.v1', change.proposalId, change.before]);
  if (change.checkpoint !== expected)
    throw new EngineError('invalid_proof', 'The recorded checkpoint has changed.', 409);
  return structuredClone(change.before);
}

interface FixtureResult {
  name: string;
  observation: string;
  assertions: boolean[];
  labels: string[];
}

function exercise(state: PreviewState): FixtureResult {
  switch (state.kind) {
    case 'disclosure': {
      const cards = new Map([
        ['client', false],
        ['neighbour', false],
      ]);
      const activate = (id: string) => {
        if (state.activation === 'toggle') cards.set(id, !cards.get(id));
      };
      activate('client');
      const opened = cards.get('client') === true;
      activate('client');
      return {
        name: 'DF9 local fixture · client card disclosure',
        observation: opened
          ? 'First activation displayed the client details.'
          : 'First activation left the client details collapsed.',
        assertions: [opened, opened && cards.get('client') === false, cards.get('neighbour') === false],
        labels: fixturePlans.disclosure.checks,
      };
    }
    case 'build-label': {
      const renderLabel = (version: string) =>
        state.normalise ? 'Build ' + (version.trim() || 'pending') : version;
      const displayed = renderLabel(' 0.1.0 ');
      return {
        name: 'DF9 local fixture · build badge',
        observation: 'Rendered badge ' + JSON.stringify(displayed),
        assertions: [
          displayed === 'Build 0.1.0',
          renderLabel('') === 'Build pending',
          renderLabel('0.2.0-rc.1').endsWith('0.2.0-rc.1'),
        ],
        labels: fixturePlans['build-label'].checks,
      };
    }
    case 'duplicate': {
      const queue = [
        { id: state.bugId, duplicateOf: state.duplicateOf },
        { id: state.canonicalId, duplicateOf: null },
      ];
      const openIds = queue.filter((item) => item.duplicateOf === null).map((item) => item.id);
      return {
        name: 'DF9 local fixture · duplicate workflow metadata',
        observation: state.duplicateOf
          ? 'Duplicate linked to ' + state.duplicateOf + '.'
          : 'Report and canonical issue both appeared in the active queue.',
        assertions: [
          state.duplicateOf === state.canonicalId,
          !openIds.includes(state.bugId),
          openIds.includes(state.canonicalId),
        ],
        labels: fixturePlans.duplicate.checks,
      };
    }
    default:
      throw new EngineError('invalid_proof', 'The preview target is unknown.');
  }
}

export function gatherProof(change: PreviewChange): Proof {
  const previous = restorePreview(change);
  if (previous.kind !== change.after.kind)
    throw new EngineError('invalid_proof', 'Preview and checkpoint target different fixtures.', 409);
  const before = exercise(previous);
  const after = exercise(change.after);
  const checks = before.labels.map((name, index) => ({
    name,
    beforePassed: before.assertions[index],
    afterPassed: after.assertions[index],
  }));
  const report = {
    proposalId: change.proposalId,
    bugId: change.bugId,
    revision: change.revision,
    inputFingerprint: change.inputFingerprint,
    fixture: after.name,
    before: before.observation,
    after: after.observation,
    checks,
    passed:
      checks.every((check) => check.afterPassed) &&
      checks.some((check) => !check.beforePassed && check.afterPassed),
  };
  return { ...report, receipt: fingerprint(['releasegate.preview-proof.v1', report]) };
}
