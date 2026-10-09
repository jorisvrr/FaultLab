import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';
import raw from './Overlay.module.css';

/** Typed class names: a dot-access typo is a compile error, not a silently missing class. */
const styles = raw as Record<'tooltipWrap' | 'tooltip' | 'tooltipOpen' | 'dialog' | 'drawer' | 'drawerBottom' | 'head' | 'heading' | 'close' | 'content' | 'foot', string>;

/**
 * Tooltip: describes the control it wraps. It is `aria-describedby`, never the accessible
 * name, so a control still needs its own label. Opens on hover AND on keyboard focus, and Esc
 * dismisses it while focus stays put (WCAG 2.2 "content on hover or focus").
 */
export function Tooltip({ content, children }: { readonly content: ReactNode; readonly children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <span
      className={styles.tooltipWrap}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      <span className={[styles.tooltip, open ? styles.tooltipOpen : null].filter(Boolean).join(' ')} id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}

export type DialogVariant = 'dialog' | 'drawer' | 'drawer-bottom';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly variant?: DialogVariant;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Modal dialog built on the native `<dialog>` element with `showModal()`.
 *
 * The browser then provides, correctly and for free: the top layer, the `::backdrop`, focus
 * containment, Esc to close, `inert` on the rest of the document (so background content is
 * neither clickable nor reachable by screen reader), and scroll blocking. We add only what
 * the platform leaves to us:
 *
 * - focus restoration to the element that was focused before opening;
 * - closing on a click on the backdrop (the element fills the viewport, so we test the point);
 * - keeping React's `open` prop and the element's own state in step, including Esc.
 */
export function Dialog({ open, onClose, title, variant = 'dialog', footer, children }: DialogProps) {
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (open && !el.open) {
      restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Unmounting while open would leave the document inert, so close on the way out.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.open === true) el.close();
    };
  }, []);

  const handleClose = () => {
    // Fires for Esc and for close() alike, so it is the single place that restores focus.
    const target = restoreTo.current;
    restoreTo.current = null;
    target?.focus();
    // WebKit moves focus itself after the close event and overwrites the line above, so the
    // restore is repeated once the engine has finished. Found by the cross-engine test.
    if (target !== null) requestAnimationFrame(() => target.isConnected && target.focus());
    onClose();
  };

  const classes = [styles.dialog, variant === 'drawer' ? styles.drawer : null, variant === 'drawer-bottom' ? styles.drawerBottom : null].filter(Boolean).join(' ');

  return (
    <dialog
      ref={ref}
      className={classes}
      aria-labelledby={headingId}
      onClose={handleClose}
      onCancel={(e) => {
        // Let the native Esc close happen; onClose above does the restoring.
        e.preventDefault();
        ref.current?.close();
      }}
      onClick={(e) => {
        // The dialog box fills the element, so a click outside its rectangle is the backdrop.
        const box = ref.current?.getBoundingClientRect();
        if (box === undefined) return;
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        if (outside) ref.current?.close();
      }}
    >
      <div className={styles.head}>
        <h2 className={styles.heading} id={headingId}>
          {title}
        </h2>
        <IconButton label="Close" variant="ghost" className={styles.close} onClick={() => ref.current?.close()}>
          ✕
        </IconButton>
      </div>
      <div className={styles.content}>{children}</div>
      {footer !== undefined && <div className={styles.foot}>{footer}</div>}
    </dialog>
  );
}
