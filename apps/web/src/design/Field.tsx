import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import raw from './Field.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'row' | 'label' | 'hint' | 'error' | 'surface' | 'select' | 'chevron' | 'input' | 'affix' | 'range' | 'dual' | 'dualTrack' | 'dualFill' | 'switch' | 'switchControl' | 'switchInput' | 'track' | 'knob' | 'segmented' | 'segment' | 'segmentInput' | 'segmentLabel', string>;

/**
 * Form controls. Each one wraps a NATIVE element, so keyboard operation, form association,
 * validation and assistive-technology semantics come from the browser; only the appearance is
 * ours. That is also why none of them re-implements arrow-key handling.
 */

interface FieldShell {
  readonly label: ReactNode;
  /** Keeps the accessible name but hides it, where the reference shows no visible label. */
  readonly hideLabel?: boolean | undefined;
  readonly hint?: ReactNode | undefined;
  /** Shown below the control and referenced by `aria-describedby`; also sets `aria-invalid`. */
  readonly error?: string | undefined;
}

function Shell({ label, hint, error, id, hideLabel = false, children }: FieldShell & { id: string; hideLabel?: boolean; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <label className={hideLabel ? 'sr-only' : styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint !== undefined && error === undefined && (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const describedBy = (id: string, hint: unknown, error: unknown) => (error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined);

const Chevron = () => (
  <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── select ──────────────────────────────────────────────────────────────────────────────────

export interface SelectFieldProps extends FieldShell, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  readonly options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[];
}

export function SelectField({ label, hint, error, hideLabel, options, disabled, className, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} error={error} id={id} hideLabel={hideLabel === true}>
      <div className={[styles.surface, className].filter(Boolean).join(' ')} data-disabled={disabled === true} data-invalid={error !== undefined}>
        <select id={id} className={styles.select} disabled={disabled} aria-invalid={error !== undefined || undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
    </Shell>
  );
}

// ── number ──────────────────────────────────────────────────────────────────────────────────

export interface NumberFieldProps extends FieldShell, Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  /** Buttons etc. shown inside the control, right-aligned (copy, regenerate …). */
  readonly affix?: ReactNode;
}

/** An integer field, not a slider: a seed or a node count is a value, not a range. */
export function NumberField({ label, hint, error, affix, disabled, className, ...rest }: NumberFieldProps) {
  const id = useId();
  return (
    <Shell label={label} hint={hint} error={error} id={id}>
      <div className={[styles.surface, className].filter(Boolean).join(' ')} data-disabled={disabled === true} data-invalid={error !== undefined}>
        <input
          id={id}
          type="number"
          className={styles.input}
          disabled={disabled}
          inputMode="numeric"
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...rest}
        />
        {affix !== undefined && <span className={styles.affix}>{affix}</span>}
      </div>
    </Shell>
  );
}

// ── range ───────────────────────────────────────────────────────────────────────────────────

export interface RangeFieldProps extends FieldShell, Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'value'> {
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export function RangeField({ label, hint, error, value, min, max, disabled, className, ...rest }: RangeFieldProps) {
  const id = useId();
  const fill = `${((value - min) / Math.max(1, max - min)) * 100}%`;
  return (
    <Shell label={label} hint={hint} error={error} id={id}>
      <input
        id={id}
        type="range"
        className={[styles.range, className].filter(Boolean).join(' ')}
        style={{ ['--_fill' as string]: fill }}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </Shell>
  );
}

export interface DualRangeProps extends FieldShell {
  readonly min: number;
  readonly max: number;
  readonly low: number;
  readonly high: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly lowLabel: string;
  readonly highLabel: string;
  readonly onChange: (next: { readonly low: number; readonly high: number }) => void;
}

/**
 * Two native range inputs over one track (the reference's latency control). Each thumb keeps
 * its own accessible name and native keyboard behaviour; the pair is kept ordered here.
 */
export function DualRangeField({ label, hint, error, min, max, low, high, step = 1, disabled, lowLabel, highLabel, onChange }: DualRangeProps) {
  const id = useId();
  const pct = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;
  return (
    <div className={styles.row} role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy(id, hint, error)}>
      <span className={styles.label} id={`${id}-label`}>
        {label}
      </span>
      <div className={styles.dual}>
        <div className={styles.dualTrack} aria-hidden="true" />
        <div className={styles.dualFill} style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} aria-hidden="true" />
        <input
          type="range"
          className={styles.range}
          aria-label={lowLabel}
          min={min}
          max={max}
          step={step}
          value={low}
          disabled={disabled}
          onChange={(e) => onChange({ low: Math.min(Number(e.currentTarget.value), high), high })}
        />
        <input
          type="range"
          className={styles.range}
          aria-label={highLabel}
          min={min}
          max={max}
          step={step}
          value={high}
          disabled={disabled}
          onChange={(e) => onChange({ low, high: Math.max(Number(e.currentTarget.value), low) })}
        />
      </div>
      {hint !== undefined && error === undefined && (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// ── switch ──────────────────────────────────────────────────────────────────────────────────

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  readonly label: ReactNode;
  /** Puts the label before the track, as the reference's invariant cards do. */
  readonly labelFirst?: boolean;
}

/** A real checkbox: Space toggles it, forms see it, screen readers announce its state. */
export function Switch({ label, labelFirst = false, disabled, className, ...rest }: SwitchProps) {
  const id = useId();
  const track = (
    <span className={styles.switchControl}>
      <input id={id} type="checkbox" role="switch" className={styles.switchInput} disabled={disabled} {...rest} />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </span>
  );
  return (
    <label className={[styles.switch, className].filter(Boolean).join(' ')} htmlFor={id} data-disabled={disabled === true}>
      {labelFirst && <span>{label}</span>}
      {track}
      {!labelFirst && <span>{label}</span>}
    </label>
  );
}

// ── segmented ───────────────────────────────────────────────────────────────────────────────

export interface SegmentedProps<T extends string> {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

/**
 * Radio buttons in a row. Native radios inside one `name` give arrow-key navigation and a
 * single tab stop for free — behaviour a div-based version would have to re-implement.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className={[styles.segmented, className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        return (
          <span className={styles.segment} key={o.value}>
            <input
              className={styles.segmentInput}
              type="radio"
              id={id}
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <label className={styles.segmentLabel} htmlFor={id}>
              {o.label}
            </label>
          </span>
        );
      })}
    </div>
  );
}
