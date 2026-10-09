import { useMemo, useState } from 'react';
import { COUNTEREXAMPLES, PRESETS, specFingerprint, type ExperimentSpec } from '@faultlab/experiments';
import { useSession, useSessionView } from '../../app/session-context';

interface Choice {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly spec: ExperimentSpec;
}

const GROUPS: readonly { category: string; label: string }[] = [
  { category: 'education', label: 'Learn the basics' },
  { category: 'raft', label: 'Raft leader election' },
  { category: 'counterexample', label: 'Stored counterexamples (found by exploration)' },
  { category: 'diagnostic', label: 'Diagnostics (testing the runtime)' },
];

export const CHOICES: readonly Choice[] = [
  ...PRESETS,
  ...COUNTEREXAMPLES.map((c) => ({ id: c.id, title: c.title, summary: `Expected: "${c.expected.violation.observed}" at t=${c.expected.violation.time} (recorded by engine ${c.expected.engineVersion}).`, category: 'counterexample', spec: c.spec })),
];

/**
 * CONFIGURE: choose and adjust the experiment's INPUTS. UX-001: this view shows configuration only;
 * nothing here describes the current state of a run.
 */
export function ConfigureView({ onLoaded }: { onLoaded: () => void }) {
  const session = useSession();
  const { experiment } = useSessionView();
  const [selected, setSelected] = useState<string>(experiment?.id.split('~')[0] ?? 'raft-healthy');
  const choice = CHOICES.find((c) => c.id === selected) ?? CHOICES[0]!;
  const [seed, setSeed] = useState<number | null>(null);
  const spec = useMemo<ExperimentSpec>(() => (seed === null ? choice.spec : { ...choice.spec, seed }), [choice, seed]);

  return (
    <div className="configure" data-testid="configure">
      <nav aria-label="Experiments" className="configure__list">
        {GROUPS.map((group) => (
          <section key={group.category}>
            <h2>{group.label}</h2>
            <ul>
              {CHOICES.filter((c) => c.category === group.category).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={c.id === choice.id}
                    data-testid={`choose-${c.id}`}
                    onClick={() => {
                      setSelected(c.id);
                      setSeed(null);
                    }}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <section className="configure__detail" aria-label="Experiment configuration">
        <h2 data-testid="config-title">{choice.title}</h2>
        <p>{choice.summary}</p>
        <dl className="facts">
          <dt>Protocol</dt>
          <dd>
            {spec.protocol.name}@{spec.protocol.version}
          </dd>
          <dt>Nodes</dt>
          <dd>{spec.nodes.join(', ')}</dd>
          <dt>Planned faults</dt>
          <dd>{spec.faults?.length ?? 0}</dd>
          <dt>Safety invariants</dt>
          <dd>{spec.invariants?.map((i) => i.id).join(', ') || 'none'}</dd>
          <dt>Liveness checks</dt>
          <dd>{spec.liveness?.map((l) => `${l.id} (deadline ${String(l.params['deadline'])}, a test bound)`).join(', ') || 'none'}</dd>
          <dt>Spec fingerprint</dt>
          <dd data-testid="spec-fingerprint">{specFingerprint(spec)}</dd>
        </dl>
        <label>
          Seed{' '}
          <input
            type="number"
            min={0}
            max={2 ** 32 - 1}
            value={spec.seed}
            data-testid="seed"
            onChange={(e) => setSeed(Number.isInteger(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : null)}
          />
        </label>
        <p>
          <button
            type="button"
            className="primary"
            data-testid="load"
            onClick={() => {
              session.load(spec, { id: seed === null ? choice.id : `${choice.id}~${seed}`, title: choice.title, summary: choice.summary, category: choice.category });
              onLoaded();
            }}
          >
            Load experiment
          </button>{' '}
          <span className="hint">Loading prepares a run in a Web Worker; it starts when you press Run.</span>
        </p>
        <details>
          <summary>Experiment specification (JSON: what is sent to the Worker)</summary>
          <pre data-testid="spec-json">{JSON.stringify(spec, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
