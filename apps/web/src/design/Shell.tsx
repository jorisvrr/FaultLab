import type { HTMLAttributes, ReactNode } from 'react';
import raw from './Shell.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'shell' | 'backdrop' | 'grid' | 'atmosphere' | 'orbits' | 'header' | 'brand' | 'brandMark' | 'brandPlaceholder' | 'wordmark' | 'nav' | 'navLink' | 'headerEnd' | 'main' | 'dock' | 'tabs' | 'tab', string>;

/**
 * Backdrop: the void, an ultra-thin structural grid and decorative orbit arcs.
 * Static and passive — nothing here encodes simulation state, so nothing here can be
 * mistaken for data.
 */
export function Backdrop({ orbits = true }: { readonly orbits?: boolean }) {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.atmosphere} />
      <div className={styles.grid} />
      {orbits && (
        <svg className={styles.orbits} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="50%" cy="46%" r="320" />
            <circle cx="50%" cy="46%" r="470" />
            <circle cx="12%" cy="86%" r="190" />
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * Branding slot.
 *
 * The final FaultLab logo is being designed separately and will be supplied as an asset. Until
 * then this renders a temporary placeholder inside a box whose size is fixed by the
 * `--brand-mark-*` tokens, so dropping in the real mark needs no layout change. Nothing here
 * is a designed identity and nothing here is generated.
 */
export function BrandMark({ href = '#/', mark }: { readonly href?: string; readonly mark?: ReactNode }) {
  return (
    <a className={styles.brand} href={href} data-brand-slot="true">
      <span className={styles.brandMark}>{mark ?? <span className={styles.brandPlaceholder} data-placeholder="true" aria-hidden="true" />}</span>
      <span className={styles.wordmark}>FaultLab</span>
    </a>
  );
}

export interface HeaderProps {
  readonly nav?: readonly { readonly id: string; readonly label: string; readonly href: string; readonly current?: boolean; readonly testId?: string }[];
  readonly end?: ReactNode;
  readonly mark?: ReactNode;
}

export function Header({ nav = [], end, mark }: HeaderProps) {
  return (
    <header className={styles.header}>
      <BrandMark mark={mark} />
      {nav.length > 0 && (
        <nav className={styles.nav} aria-label="Modes">
          {nav.map((item) => (
            <a key={item.id} className={styles.navLink} href={item.href} aria-current={item.current === true ? 'page' : undefined} data-testid={item.testId}>
              {item.label}
            </a>
          ))}
        </nav>
      )}
      {end !== undefined && <div className={styles.headerEnd}>{end}</div>}
    </header>
  );
}

export interface AppShellProps {
  readonly header: ReactNode;
  readonly dock?: ReactNode;
  readonly children: ReactNode;
  readonly backdrop?: boolean;
  /**
   * The content region is the page's `main` landmark. An embedded demo (the gallery) passes
   * `div`, because a `main` nested inside another landmark is an accessibility error.
   */
  readonly contentAs?: 'main' | 'div';
}

export function AppShell({ header, dock, children, backdrop = true, contentAs: Content = 'main' }: AppShellProps) {
  return (
    <div className={styles.shell}>
      {backdrop && <Backdrop />}
      {header}
      <Content className={styles.main} id={Content === 'main' ? 'main' : undefined}>
        {children}
      </Content>
      {dock !== undefined && <div className={styles.dock}>{dock}</div>}
    </div>
  );
}

export interface TabsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly tabs: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}

/**
 * Tabs with the ARIA tab pattern: one tab stop for the list, arrow keys move between tabs,
 * Home and End jump to the ends. Panels are rendered by the caller with `role="tabpanel"`.
 */
export function Tabs<T extends string>({ label, value, tabs, onChange }: TabsProps<T>) {
  const move = (delta: number) => {
    const i = tabs.findIndex((t) => t.value === value);
    const next = tabs[(i + delta + tabs.length) % tabs.length]!;
    onChange(next.value);
    document.getElementById(`tab-${next.value}`)?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          id={`tab-${t.value}`}
          className={styles.tab}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          aria-controls={`panel-${t.value}`}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(1);
            else if (e.key === 'ArrowLeft') move(-1);
            else if (e.key === 'Home') onChange(tabs[0]!.value);
            else if (e.key === 'End') onChange(tabs.at(-1)!.value);
            else return;
            e.preventDefault();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel<T extends string>({ value, active, children, ...rest }: HTMLAttributes<HTMLDivElement> & { value: T; active: boolean }) {
  return (
    <div id={`panel-${value}`} role="tabpanel" aria-labelledby={`tab-${value}`} hidden={!active} tabIndex={0} {...rest}>
      {active && children}
    </div>
  );
}
