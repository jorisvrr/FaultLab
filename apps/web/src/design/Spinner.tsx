import type { HTMLAttributes } from 'react';
import raw from './Spinner.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'spinner', string>;

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** An accessible name when the spinner stands alone; omit inside a button that has one. */
  readonly label?: string;
}

/**
 * Loading indicator: a thin accent arc. Under `prefers-reduced-motion` it stops rotating and
 * becomes a static ring — the state is still visible, it just does not move.
 */
export function Spinner({ label, className, ...rest }: SpinnerProps) {
  return (
    <span
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      role={label === undefined ? 'presentation' : 'status'}
      aria-label={label}
      {...rest}
    />
  );
}
