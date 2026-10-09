/**
 * The documented semantic tokens, mirrored in TypeScript.
 *
 * This list exists for two reasons: the gallery renders it as the token overview, and a unit
 * test asserts that every name here actually resolves in `tokens.css`. That assertion is what
 * stops the documentation and the stylesheet drifting apart — a design system's most common
 * quiet failure.
 *
 * Components must not read values from here; they use `var(--token)` in CSS.
 */
export const TOKENS = {
  colour: [
    ['--color-void', 'Page background, outside every panel'],
    ['--color-surface-stage', 'The centre stage behind the nodes'],
    ['--color-surface-panel', 'Panel body'],
    ['--color-surface-raised', 'Card inside a panel'],
    ['--color-surface-control', 'Control surface: select, field, button'],
    ['--color-surface-control-hover', 'Control surface, hovered'],
    ['--color-text', 'Primary text'],
    ['--color-text-strong', 'Emphasised text and key figures'],
    ['--color-text-muted', 'Labels and fact keys'],
    ['--color-text-subtle', 'Supporting and micro text'],
    ['--color-text-disabled', 'Disabled control text'],
    ['--color-text-on-accent', 'Text on the accent fill'],
    ['--color-border', 'Hairline border'],
    ['--color-border-strong', 'Hairline border, emphasised'],
    ['--color-border-lit', 'The lit top edge of a panel'],
    ['--color-divider', 'Divider inside a surface'],
    ['--color-accent', 'Selection, focus, interactive'],
    ['--color-accent-bright', 'Accent highlight'],
    ['--color-accent-dim', 'Accent at low emphasis'],
    ['--color-accent-surface', 'Accent-tinted surface'],
    ['--color-state-fault', 'Injected faults: crash, partition, dropped message'],
    ['--color-state-fault-bright', 'Fault highlight'],
    ['--color-state-recovery', 'Recovery and healing'],
    ['--color-state-violation', 'Invariant violation, protocol error, critical error'],
    ['--color-state-violation-strong', 'Violation, emphasised'],
    ['--color-state-ok', 'No violation detected'],
  ],
  material: [
    ['--shadow-inset-panel', 'The lit inner edge of a panel'],
    ['--shadow-inset-control', 'The lit inner edge of a control'],
    ['--shadow-panel', 'A panel over the void'],
    ['--shadow-float', 'Dialogs, drawers, tooltips'],
    ['--shadow-press', 'A pressed control'],
    ['--gradient-panel', 'The faint top lift across a panel'],
    ['--gradient-stage', 'Atmospheric lighting behind the stage'],
    ['--gradient-accent', 'The primary action fill'],
    ['--blur-glass', 'Glass blur radius; 0 under reduced transparency'],
  ],
  layout: [
    ['--space-1', '4px'],
    ['--space-2', '8px'],
    ['--space-3', '12px'],
    ['--space-4', '16px'],
    ['--space-5', '24px'],
    ['--space-6', '32px'],
    ['--space-7', '48px'],
    ['--space-gutter', 'Gap between panels'],
    ['--space-margin', 'Outer page margin'],
    ['--radius-panel', 'Panel corner'],
    ['--radius-card', 'Card corner'],
    ['--radius-control', 'Control corner'],
    ['--radius-pill', 'Fully rounded'],
    ['--header-height', 'Identity row height'],
  ],
  typography: [
    ['--font-sans', 'Geist: headings, navigation, prose'],
    ['--font-mono', 'Geist Mono: labels, values, identifiers, timestamps'],
    ['--type-display-size', 'Wordmark and page titles'],
    ['--type-title-size', 'Panel titles'],
    ['--type-label-size', 'Labels and fact keys'],
    ['--type-value-size', 'Values and readouts'],
    ['--type-card-size', 'Card titles and chips'],
    ['--type-body-size', 'Prose'],
    ['--type-micro-size', 'Micro labels and captions'],
    ['--type-tracking-tight', 'Technical text'],
    ['--type-tracking-wide', 'Uppercase micro labels'],
    ['--type-leading-tight', 'Headings'],
    ['--type-leading-body', 'Prose'],
  ],
  motion: [
    ['--motion-fast', 'Press feedback'],
    ['--motion-base', 'Hover, toggle, tooltip'],
    ['--motion-slow', 'Panel, dialog, drawer'],
    ['--motion-ease', 'Standard easing'],
    ['--motion-ease-out', 'Entrances'],
  ],
  layers: [
    ['--z-background', 'Void and atmosphere'],
    ['--z-grid', 'Structural grid'],
    ['--z-orbits', 'Decorative arcs'],
    ['--z-links', 'Network links'],
    ['--z-nodes', 'Nodes'],
    ['--z-panels', 'Panels and chrome'],
    ['--z-dock', 'Docked controls'],
    ['--z-tooltip', 'Tooltips'],
    ['--z-dialog', 'Dialogs and drawers'],
    ['--z-focus', 'Focus indicators'],
  ],
  focus: [
    ['--focus-ring-width', 'Focus ring thickness'],
    ['--focus-ring-offset', 'Focus ring offset'],
    ['--focus-ring-color', 'Focus ring colour'],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;

export type TokenName = (typeof TOKENS)[keyof typeof TOKENS][number][0];

/** Every documented token name, flattened. Used by the gallery and by the drift test. */
export const tokenNames = (): string[] => Object.values(TOKENS).flatMap((group) => group.map(([name]) => name));
