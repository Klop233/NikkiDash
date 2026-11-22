export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div class="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} class={`toast toast-${item.kind}`} onClick={() => onDismiss(item.id)}>
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
