import { useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import type { CapabilitiesResponse, ProfilesResponse } from '../api/types';

export function OnboardingPage(props: {
  capabilities: CapabilitiesResponse | null;
  profiles: ProfilesResponse | null;
  onRefreshAll: () => void;
  onDone: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [subName, setSubName] = useState('我的订阅');
  const [subUrl, setSubUrl] = useState('');
  const [yamlName, setYamlName] = useState('custom.yaml');
  const [yamlContent, setYamlContent] = useState('');
  const [busy, setBusy] = useState(false);

  const deps = props.capabilities?.dependencies;
  const conflicts = props.capabilities?.conflicts ?? [];

  const handleAddSub = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await nikkiApi.saveSubscription({
        name: subName.trim(),
        url: subUrl.trim(),
        user_agent: 'clash.meta',
        prefer: 'remote'
      });
      await nikkiApi.switchProfile(`subscription:${saved.id}`, false);
      await nikkiApi.updateSubscription(saved.id, false);
      props.notify('success', '订阅已保存并开始拉取，可在总览或配置页查看进度');
      props.onRefreshAll();
      props.onDone();
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleImportYaml = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await nikkiApi.importProfile(yamlName.trim(), yamlContent, true);
      props.notify('success', `配置 ${yamlName} 已导入并设为当前活动配置`);
      props.onRefreshAll();
      props.onDone();
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkRow = (label: string, ok?: boolean, hint?: string) => (
    <div class="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hint}</div>}
      </div>
      <span class={`badge ${ok ? 'badge-green' : 'badge-red'}`}>{ok ? '就绪' : '缺失 / 异常'}</span>
    </div>
  );

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">环境检测与首次配置向导</h2>
          <p class="page-desc">检查 OpenWrt 路由器的 Nikki / Mihomo / firewall4 依赖并快速导入首个订阅或配置文件</p>
        </div>
        <button class="btn" onClick={props.onRefreshAll}>
          重新检测
        </button>
      </div>

      {conflicts.length > 0 && (
        <div class="alert alert-danger">
          <div>
            <strong>检测到潜在透明代理冲突：</strong>
            {conflicts.map((c) => c.message).join(' ')}
            <div style={{ marginTop: '4px', fontSize: '12px' }}>
              NikkiDash 不会自动卸载或停止其他代理插件，请先手动停用冲突服务后再启动 Nikki。
            </div>
          </div>
        </div>
      )}

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">系统依赖与版本</h3>
            <span class="badge badge-accent">OpenWrt {props.capabilities?.versions.openwrt || '未知'}</span>
          </div>
          {checkRow('Nikki 服务包 (/etc/init.d/nikki)', deps?.nikki_installed, `版本: ${props.capabilities?.versions.nikki || '未安装'}`)}
          {checkRow('Mihomo 核心 (/usr/bin/mihomo)', deps?.mihomo_installed, `版本: ${props.capabilities?.versions.core || '未安装'}`)}
          {checkRow('firewall4 / nftables', deps?.fw4_available, '透明代理规则引擎')}
          {checkRow('yq YAML 处理工具', deps?.yq_available, '用于配置校验与 mixin 合并')}
          {checkRow('curl 网络工具', deps?.curl_available, '用于 Mihomo 控制器通信与订阅下载')}
          {checkRow('TLS / HTTPS 支持 (libustream-ssl)', deps?.https_available, '仅 WAN HTTPS 模式必需')}
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">方式一：添加订阅链接</h3>
          </div>
          <form class="stack" onSubmit={handleAddSub}>
            <div class="field">
              <label class="field-label">订阅名称</label>
              <input class="input" value={subName} onInput={(e) => setSubName((e.currentTarget as HTMLInputElement).value)} required />
            </div>
            <div class="field">
              <label class="field-label">订阅 URL (http/https)</label>
              <input
                class="input"
                type="url"
                placeholder="https://example.com/subscribe?token=..."
                value={subUrl}
                onInput={(e) => setSubUrl((e.currentTarget as HTMLInputElement).value)}
                required
              />
              {subUrl.toLowerCase().startsWith('http://') && (
                <span class="field-hint" style={{ color: 'var(--amber)' }}>
                  提示：明文 HTTP 订阅可能泄露凭据，建议优先使用 HTTPS。
                </span>
              )}
            </div>
            <button class="btn btn-primary" type="submit" disabled={busy || !subUrl.trim()}>
              保存并更新订阅
            </button>
          </form>
        </div>
      </div>

      <div class="card" style={{ marginTop: '14px' }}>
        <div class="card-header">
          <h3 class="card-title">方式二：直接导入 Clash / Mihomo YAML 配置文件</h3>
        </div>
        <form class="stack" onSubmit={handleImportYaml}>
          <div class="field" style={{ maxWidth: '320px' }}>
            <label class="field-label">文件名 (.yaml / .yml)</label>
            <input class="input" value={yamlName} onInput={(e) => setYamlName((e.currentTarget as HTMLInputElement).value)} required />
          </div>
          <div class="field">
            <label class="field-label">YAML 内容（需包含 proxies 或 proxy-providers）</label>
            <textarea
              class="textarea"
              placeholder="proxies:\n  - name: ..."
              value={yamlContent}
              onInput={(e) => setYamlContent((e.currentTarget as HTMLTextAreaElement).value)}
              required
            />
          </div>
          <div class="row">
            <button class="btn btn-primary" type="submit" disabled={busy || !yamlContent.trim()}>
              校验并导入为活动配置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
