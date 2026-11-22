import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

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
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !props.busy) {
        props.onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      <div class="modal-card">
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>{props.title}</h3>
        {props.message && (
          <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '13.5px' }}>{props.message}</p>
        )}
        {props.children}
        <div class="modal-actions">
          <button type="button" class="btn" onClick={props.onCancel} disabled={props.busy}>
            {props.cancelLabel || '取消'}
          </button>
          <button
            type="button"
            class={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
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
