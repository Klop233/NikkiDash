import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function ConfirmModal(props: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  children?: ComponentChildren;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = requestAnimationFrame(() => {
      const firstBtn = cardRef.current?.querySelector<HTMLElement>('button, select, input, [tabindex]');
      firstBtn?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !props.busy) {
        props.onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus?.();
    };
  }, [props.open, props.busy, props.onCancel]);

  if (!props.open) return null;
  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={(e) => {
        if (e.target === e.currentTarget && !props.busy) props.onCancel();
      }}
    >
      <div class="modal-card" ref={cardRef}>
        <h3 class="modal-title">{props.title}</h3>
        {props.message && <p class="modal-message">{props.message}</p>}
        {props.children}
        <div class="modal-actions">
          <button type="button" class="btn" onClick={props.onCancel} disabled={props.busy}>
            {props.cancelLabel || '取消'}
          </button>
          <button
            type="button"
            class={`btn ${props.danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={props.onConfirm}
            disabled={props.busy || props.confirmDisabled}
          >
            {props.busy ? '处理中...' : props.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
