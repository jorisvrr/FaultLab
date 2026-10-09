import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A list of trace entry indices of any length, rendering only the rows in view (CP6 Phase 0
 * finding: Investigate rendered every one of ≈ 8 000 causes each frame while following live,
 * freezing WebKit for seconds). Every item stays reachable by scrolling; the DOM holds at most
 * `maxRows + 2 · OVERSCAN` rows, so the cost per render no longer grows with the chain.
 *
 * Rows have a fixed height (`rowHeight`), so the scroll position maps directly to an item.
 * `resetKey` scrolls back to the first item when it changes (e.g. a different selected entry).
 */
const OVERSCAN = 4;

export function WindowedList({
  items,
  rowHeight,
  maxRows,
  label,
  testId,
  resetKey,
  renderItem,
  empty,
}: {
  items: readonly number[];
  rowHeight: number;
  maxRows: number;
  label: string;
  testId: string;
  resetKey?: unknown;
  renderItem: (item: number) => ReactNode;
  empty: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    if (ref.current !== null) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  if (items.length === 0) {
    return (
      <ol className="windowed-empty" data-testid={testId} aria-label={label}>
        {empty}
      </ol>
    );
  }
  const visible = Math.min(items.length, maxRows);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil(scrollTop / rowHeight) + visible + OVERSCAN);
  const rows: ReactNode[] = [];
  for (let k = first; k < last; k++) {
    rows.push(
      <li key={items[k]} aria-setsize={items.length} aria-posinset={k + 1} style={{ top: k * rowHeight, height: rowHeight }}>
        {renderItem(items[k]!)}
      </li>,
    );
  }
  return (
    // The scroll container is focusable so the list can be scrolled with the keyboard.
    <div ref={ref} className="windowed" data-testid={testId} tabIndex={0} role="region" aria-label={label} style={{ height: visible * rowHeight }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <ol style={{ height: items.length * rowHeight }}>{rows}</ol>
    </div>
  );
}
