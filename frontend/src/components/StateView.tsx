import type { ComponentChildren } from 'preact';
import { IconError, IconInfo, IconShield } from './Icons';

export function StateView(props: {
  kind: 'loading' | 'empty' | 'error' | 'unauthorized';
  title?: string;
  message?: string;
  actionLabel?: string;
  primaryAction?: boolean;
  onAction?: () => void;
  children?: ComponentChildren;
}) {
  const defaults = {
    loading: { title: '正在加载...', message: '正在从路由器获取实时数据' },
    empty: { title: '暂无内容', message: '当前没有可显示的记录' },
    error: { title: '加载失败', message: '无法连接路由器或后端返回错误，数据没有丢失。' },
    unauthorized: { title: '无权限访问', message: '当前会话无权执行该操作，请使用路由器管理员账号重新登录。' }
  }[props.kind];

  const isError = props.kind === 'error' || props.kind === 'unauthorized';

  return (
    <div class="card state-box" role="status" aria-busy={props.kind === 'loading' ? true : undefined}>
      {props.kind === 'loading' ? (
        <>
          <h3 class="state-title">{props.title || defaults.title}</h3>
          <p class="state-desc">{props.message || defaults.message}</p>
          <div class="skeleton-list" aria-hidden="true">
            <div class="skeleton-row">
              <span class="sk" style={{ width: '28px', height: '28px', borderRadius: '999px', flexShrink: 0 }} />
              <span class="sk" style={{ width: '42%', height: '14px' }} />
              <span class="sk" style={{ width: '22%', height: '14px', marginLeft: 'auto' }} />
            </div>
            <div class="skeleton-row">
              <span class="sk" style={{ width: '28px', height: '28px', borderRadius: '999px', flexShrink: 0 }} />
              <span class="sk" style={{ width: '34%', height: '14px' }} />
              <span class="sk" style={{ width: '18%', height: '14px', marginLeft: 'auto' }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <span class={`state-icon ${isError ? 'state-icon-error' : ''}`} aria-hidden="true">
            {props.kind === 'error' ? <IconError /> : props.kind === 'unauthorized' ? <IconShield /> : <IconInfo />}
          </span>
          <h3 class="state-title">{props.title || defaults.title}</h3>
          <p class="state-desc">{props.message || defaults.message}</p>
          {props.children}
          {props.actionLabel && props.onAction && (
            <button
              type="button"
              class={`btn state-action ${props.primaryAction ? 'btn-primary' : ''}`}
              onClick={props.onAction}
            >
              {props.actionLabel}
            </button>
          )}
        </>
      )}
    </div>
  );
}
