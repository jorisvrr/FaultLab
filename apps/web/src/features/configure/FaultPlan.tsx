import type { ReactNode } from 'react';
import type { FaultSpec, FaultType } from '@faultlab/engine';
import { describeFault, faultTone } from './FaultEditor';
import raw from './Configure.module.css';

const styles = raw as Record<
  'planChart' | 'planAxis' | 'planRule' | 'planTick' | 'planTickLabel' | 'planMark' | 'planBadge' | 'planBadgeRecovery' | 'planStem' | 'planDot' | 'planName' | 'planEmpty',
  string
>;

/**
 * The scheduled fault plan, as the reference draws it: an icon badge per fault, a dashed stem
 * down to the axis, and the fault's name beneath.
 *
 * It shows a PLAN. Nothing here is a simulation result, and the markers never use the live
 * "active fault" styling — amber for what breaks something, blue for what restores it, which is
 * the same distinction the rest of the system uses.
 */
const ICONS: Record<FaultType, ReactNode> = {
  crash: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9 1.5 4 8.5h3.2L7 14.5l5-7.2H8.8z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  recover: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.7-3.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  partition: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  ),
  heal: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.7 8h2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  link: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8h5M9 8h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11 5.5 13.5 8 11 10.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'link-restore': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11 5.5 13.5 8 11 10.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const SHORT: Record<FaultType, string> = {
  crash: 'crash',
  recover: 'recover',
  partition: 'partition',
  heal: 'heal',
  link: 'link fault',
  'link-restore': 'link restore',
};

export interface FaultPlanProps {
  readonly faults: readonly FaultSpec[];
  readonly maxTime: number;
  readonly onSelect: (index: number) => void;
}

export function FaultPlan({ faults, maxTime, onSelect }: FaultPlanProps) {
  if (faults.length === 0) {
    return <p className={styles.planEmpty}>No faults scheduled. The run will be fault-free.</p>;
  }
  const at = (t: number) => `${Math.max(0, Math.min(1, t / Math.max(1, maxTime))) * 100}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Faults in time order, so the labels read left to right as the plan does.
  const ordered = faults.map((fault, index) => ({ fault, index })).sort((a, b) => a.fault.at - b.fault.at);
  return (
    <div className={styles.planChart}>
      {ticks.map((f) => (
        <span key={f} aria-hidden="true">
          <span className={styles.planTick} style={{ left: `${f * 100}%` }} />
          <span className={styles.planTickLabel} style={{ left: `${f * 100}%` }}>
            t {Math.round(f * maxTime)}
          </span>
        </span>
      ))}
      <span className={styles.planRule} aria-hidden="true" />
      <span className={styles.planAxis} aria-hidden="true" />
      {ordered.map(({ fault, index }) => (
        <button
          key={index}
          type="button"
          className={styles.planMark}
          style={{ left: at(fault.at) }}
          onClick={() => onSelect(index)}
          aria-label={`${describeFault(fault)} at t=${fault.at}. Open the fault schedule.`}
          data-testid={`plan-marker-${index}`}
          data-tone={faultTone(fault.type)}
        >
          <span className={[styles.planBadge, faultTone(fault.type) === 'recovery' ? styles.planBadgeRecovery : null].filter(Boolean).join(' ')}>{ICONS[fault.type]}</span>
          <span className={styles.planStem} aria-hidden="true" />
          <span className={styles.planDot} aria-hidden="true" />
          <span className={styles.planName}>{SHORT[fault.type]}</span>
        </button>
      ))}
    </div>
  );
}
