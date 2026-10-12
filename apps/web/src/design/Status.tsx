import type { HTMLAttributes, ReactNode } from 'react';
import raw from './Status.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'chip' | 'chipGlyph' | 'neutral' | 'accent' | 'fault' | 'violation' | 'ok' | 'dot' | 'dotHollow' | 'motif' | 'motifEnd' | 'motifRing' | 'recovery' | 'valueRow' | 'valueKey' | 'lock' | 'valueCell' | 'valueMissing' | 'facts' | 'factKey' | 'factValue' | 'empty' | 'emptyTitle' | 'emptyBody' | 'legend', string>;

export type Tone = 'neutral' | 'accent' | 'fault' | 'recovery' | 'violation' | 'ok';

/**
 * Every tone carries a distinct glyph as well as a colour, so meaning never depends on hue
 * alone (and survives a monochrome display or a colour-vision deficiency).
 */
const GLYPH: Record<Tone, ReactNode> = {
  neutral: <span className={styles.dot} />,
  accent: <span className={styles.dot} />,
  ok: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fault: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1 9 8.5H1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  // Restorative, so an open ring rather than the fault's solid triangle.
  recovery: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M8.3 5a3.3 3.3 0 1 1-1.1-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  violation: (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.6 2.6 7.4 7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  /** false shows the text alone, for chips whose glyph would be noise. */
  readonly glyph?: boolean;
}

export function Chip({ tone = 'neutral', glyph = true, children, className, ...rest }: ChipProps) {
  return (
    <span className={[styles.chip, styles[tone], className].filter(Boolean).join(' ')} {...rest}>
      {glyph && (
        <span className={styles.chipGlyph} aria-hidden="true">
          {GLYPH[tone]}
        </span>
      )}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', filled = true, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; filled?: boolean }) {
  return <span className={[styles.dot, filled ? null : styles.dotHollow, styles[tone], className].filter(Boolean).join(' ')} aria-hidden="true" {...rest} />;
}

/**
 * The header's five-mark motif (open question Q11, decided at Gate 2).
 *
 * It is DECORATIVE. It is not a node count, an invariant counter, a loading state, a progress
 * indicator or a protocol health light, and nothing may give it one later without a decision.
 * Therefore: `aria-hidden`, no tab stop, no pointer cursor, no hover or active response — it
 * must not read as a control to either a sighted or an assistive-technology user.
 *
 * The figure is deliberately SYMMETRIC and carries no accent colour, so it cannot be read as
 * a progression or as an active step (see Status.module.css for the reasoning).
 */
export function DecorativeMotif({ className }: { readonly className?: string }) {
  return (
    <span className={[styles.motif, className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className={styles.motifEnd} />
      <span className={styles.motifRing} />
      <span className={styles.motifRing} />
      <span className={styles.motifRing} />
      <span className={styles.motifEnd} />
    </span>
  );
}

const Lock = () => (
  <svg className={styles.lock} width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <rect x="2" y="4.8" width="7" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path d="M3.6 4.8V3.4a1.9 1.9 0 0 1 3.8 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

export interface ValueRowProps {
  readonly label: ReactNode;
  /** `undefined` renders the "not recorded" state rather than an empty box. */
  readonly value: ReactNode;
  /** Shows the padlock: this is historical state and cannot be edited. */
  readonly readOnly?: boolean;
  /** Right-hand slot: provenance marker, jump link (Q13 is still open; the slot is not). */
  readonly trailing?: ReactNode;
}

export function ValueRow({ label, value, readOnly = true, trailing }: ValueRowProps) {
  return (
    <div className={styles.valueRow}>
      <span className={styles.valueKey}>
        {readOnly && <Lock />}
        {label}
      </span>
      <span className={styles.valueCell}>
        {value === undefined || value === null ? <span className={styles.valueMissing}>not recorded</span> : value}
        {trailing}
      </span>
    </div>
  );
}

export function FactTable({ facts, className }: { readonly facts: readonly (readonly [ReactNode, ReactNode])[]; readonly className?: string }) {
  return (
    <dl className={[styles.facts, className].filter(Boolean).join(' ')}>
      {facts.map(([key, value], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt className={styles.factKey}>{key}</dt>
          <dd className={styles.factValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children, action }: { readonly title: ReactNode; readonly children?: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children !== undefined && <p className={styles.emptyBody}>{children}</p>}
      {action}
    </div>
  );
}

export function Legend({ children }: { readonly children: ReactNode }) {
  return <p className={styles.legend}>{children}</p>;
}
