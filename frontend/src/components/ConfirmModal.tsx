import type { ComponentChildren } from 'preact';

export function ConfirmModal(props: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: ComponentChildren;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label={props.title}>
      <div class="modal-card">
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>{props.title}</h3>
        {props.message && (
          <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '13.5px' }}>{props.message}</p>
        )}
        {props.children}
        <div class="modal-actions">
          <button class="btn" onClick={props.onCancel} disabled={props.busy}>
            {props.cancelLabel || '取消'}
          </button>
          <button
            class={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? '处理中...' : props.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
