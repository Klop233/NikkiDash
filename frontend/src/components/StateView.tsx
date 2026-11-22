import type { ComponentChildren } from 'preact';

export function StateView(props: {
  kind: 'loading' | 'empty' | 'error' | 'unauthorized';
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ComponentChildren;
}) {
  const defaults = {
    loading: { title: '正在加载...', message: '正在从路由器获取实时数据' },
    empty: { title: '暂无数据', message: '当前没有可显示的记录' },
    error: { title: '请求失败', message: '无法连接路由器或后端返回错误' },
    unauthorized: { title: '无权限访问', message: '当前会话无权执行该操作，请使用管理员账号重新登录' }
  }[props.kind];

  return (
    <div class="card state-box" role="status">
      <div style={{ fontSize: '16px', fontWeight: 650, color: props.kind === 'error' ? 'var(--red)' : 'var(--text)' }}>
        {props.title || defaults.title}
      </div>
      <div style={{ maxWidth: '480px', fontSize: '13px' }}>{props.message || defaults.message}</div>
      {props.children}
      {props.actionLabel && props.onAction && (
        <button class="btn btn-primary" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      )}
    </div>
  );
}
