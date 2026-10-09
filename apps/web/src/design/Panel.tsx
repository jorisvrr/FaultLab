import type { HTMLAttributes, ReactNode } from 'react';
import raw from './Panel.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'panel' | 'glass' | 'matte' | 'card' | 'header' | 'title' | 'bead' | 'body' | 'divider', string>;

export type PanelMaterial = 'glass' | 'matte';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /**
   * `matte` is mandatory for a panel that overlaps the live 3D stage: a backdrop blur over a
   * canvas that repaints every frame re-blurs every frame. Default `glass`.
   */
  readonly material?: PanelMaterial;
  readonly title?: ReactNode | undefined;
  /** Shown at the right of the title row. */
  readonly actions?: ReactNode | undefined;
  /** false removes the body padding, for panels that own their own layout. */
  readonly padded?: boolean;
  readonly as?: 'section' | 'aside' | 'div';
}

export function Panel({ material = 'glass', title, actions, padded = true, as: Tag = 'section', children, className, ...rest }: PanelProps) {
  return (
    <Tag className={[styles.panel, styles[material], className].filter(Boolean).join(' ')} {...rest}>
      {title !== undefined && (
        <header className={styles.header}>
          <span className={styles.bead} aria-hidden="true" />
          <h2 className={styles.title}>{title}</h2>
          {actions !== undefined && <span style={{ marginLeft: 'auto' }}>{actions}</span>}
        </header>
      )}
      {padded ? <div className={styles.body}>{children}</div> : children}
    </Tag>
  );
}

export function Card({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

export function Divider(props: HTMLAttributes<HTMLHRElement>) {
  return <hr className={styles.divider} {...props} />;
}
