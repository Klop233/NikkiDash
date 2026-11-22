import { useEffect, useState } from 'preact/hooks';
import { IconError, IconInfo, IconSuccess } from './Icons';

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(item.id), 4000);
    return () => clearTimeout(timer);
  }, [item.id, paused, onDismiss]);

  return (
    <div
      role="status"
      class={`toast toast-${item.kind}`}
      onClick={() => onDismiss(item.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {item.kind === 'success' ? (
        <IconSuccess className="toast-icon" />
      ) : item.kind === 'error' ? (
        <IconError className="toast-icon" />
      ) : (
        <IconInfo className="toast-icon" />
      )}
      <span>{item.message}</span>
    </div>
  );
}

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div class="toast-stack" aria-live="polite">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
