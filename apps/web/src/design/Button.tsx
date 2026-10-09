import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import raw from './Button.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'button' | 'primary' | 'secondary' | 'ghost' | 'icon' | 'transport' | 'transportActive' | 'busy' | 'spinner' | 'disc' | 'lg', string>;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  readonly variant?: ButtonVariant;
  /** `lg` is the Configure CTA's measured size (97 px tall, 46 px disc). */
  readonly size?: ButtonSize;
  /** Shown inside the CTA's dark disc; `primary` only. */
  readonly glyph?: ReactNode;
  /** Disables the button and shows a spinner, without changing its width. */
  readonly busy?: boolean;
  readonly type?: 'button' | 'submit' | 'reset';
}

/** A real `<button>`: native activation, native disabled semantics, keyboard for free. */
export function Button({ variant = 'secondary', size = 'md', glyph, busy = false, type = 'button', children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], size === 'lg' ? styles.lg : null, busy ? styles.busy : null, className].filter(Boolean).join(' ')}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner className={styles.spinner} />}
      {glyph !== undefined && variant === 'primary' && (
        <span className={styles.disc} aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonProps {
  /** Required: an icon button has no visible text, so it must carry its name. */
  readonly label: string;
  /** Round, with the accent ring, for the replay dock's play control. */
  readonly transport?: boolean;
  readonly active?: boolean;
}

export function IconButton({ label, transport = false, active = false, variant = 'secondary', className, children, ...rest }: IconButtonProps) {
  return (
    <Button
      variant={variant}
      aria-label={label}
      title={label}
      className={[styles.icon, transport ? styles.transport : null, active ? styles.transportActive : null, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
}
