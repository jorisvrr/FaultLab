import type { InputHTMLAttributes } from 'react';
import raw from './Timeline.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'timeline' | 'axis' | 'tick' | 'tickLabel' | 'marker' | 'markerDot' | 'playhead' | 'playheadRing' | 'playheadLabel' | 'scrub', string>;

export type MarkerTone = 'neutral' | 'accent' | 'fault' | 'recovery' | 'violation';

export interface TimelineMarker {
  readonly id: string;
  /** Position along the axis, 0–1. */
  readonly at: number;
  readonly tone: MarkerTone;
  /** The accessible name of the marker's button, e.g. "Crash of n2 at t=400". */
  readonly label: string;
}

export interface TimelineProps {
  /** Axis labels, positioned 0–1. */
  readonly ticks: readonly { readonly at: number; readonly label?: string }[];
  readonly markers?: readonly TimelineMarker[];
  /** Playhead position, 0–1. */
  readonly position: number;
  readonly positionLabel?: string;
  readonly onSelectMarker?: (id: string) => void;
  /** Props for the native range input that scrubs; omit to render a non-interactive axis. */
  readonly scrub?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { readonly 'aria-label': string };
}

/**
 * The timeline's appearance and geometry. It knows nothing about traces, virtual time or
 * playback — positions arrive as fractions and Gate 4 supplies them from the real trace.
 * Markers are real buttons, so they are clickable and keyboard reachable; scrubbing is a
 * native range input, so arrow keys, Home and End work without any code here.
 */
export function Timeline({ ticks, markers = [], position, positionLabel, onSelectMarker, scrub }: TimelineProps) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className={styles.timeline}>
      <div className={styles.axis} aria-hidden="true" />
      {ticks.map((t, i) => (
        <span key={i} aria-hidden="true">
          <span className={styles.tick} style={{ left: pct(t.at) }} />
          {t.label !== undefined && (
            <span className={styles.tickLabel} style={{ left: pct(t.at) }}>
              {t.label}
            </span>
          )}
        </span>
      ))}
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={styles.marker}
          style={{ left: pct(m.at) }}
          data-tone={m.tone}
          aria-label={m.label}
          title={m.label}
          onClick={() => onSelectMarker?.(m.id)}
        >
          <span className={styles.markerDot} />
        </button>
      ))}
      <span className={styles.playhead} style={{ left: pct(position) }} aria-hidden="true">
        <span className={styles.playheadRing} />
        {positionLabel !== undefined && <span className={styles.playheadLabel}>{positionLabel}</span>}
      </span>
      {scrub !== undefined && <input type="range" className={styles.scrub} {...scrub} />}
    </div>
  );
}
