/**
 * FaultLab design system (CP6 Gate 2).
 *
 * Reusable presentation only. Nothing here imports the engine, the runtime, the trace index or
 * the Session: components receive props. That is what lets the gallery render every state
 * without a simulation, and what keeps rendering decisions out of the simulation's way.
 *
 * Import `./base.css` once per page entry (it pulls in the fonts and tokens).
 */
export { Panel, Card, Divider, type PanelProps, type PanelMaterial } from './Panel';
export { Button, IconButton, type ButtonProps, type ButtonVariant, type IconButtonProps } from './Button';
export { Spinner } from './Spinner';
export { SelectField, NumberField, RangeField, DualRangeField, Switch, Segmented } from './Field';
export { Chip, StatusDot, DecorativeMotif, ValueRow, FactTable, EmptyState, Legend, type Tone } from './Status';
export { Tooltip, Dialog, type DialogProps, type DialogVariant } from './Overlay';
export { AppShell, Header, BrandMark, Backdrop, Tabs, TabPanel } from './Shell';
export { Timeline, type TimelineMarker, type MarkerTone } from './Timeline';
export { TOKENS, type TokenName } from './tokens';
