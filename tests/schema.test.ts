import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import schema from '../schema/nikki-schema.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Nikki UCI Schema completeness & sync', () => {
  it('matches the packaged runtime schema copy verbatim', () => {
    const src = readFileSync(path.resolve(__dirname, '../schema/nikki-schema.json'), 'utf8');
    const pkg = readFileSync(
      path.resolve(__dirname, '../package/nikki-dash/files/usr/share/nikki-dash/schema.json'),
      'utf8'
    );
    expect(JSON.parse(pkg)).toEqual(JSON.parse(src));
  });

  it('covers all locked OpenWrt-nikki v1.26.2 named sections', () => {
    expect(Object.keys(schema.named_sections).sort()).toEqual([
      'config',
      'core',
      'log',
      'mixin',
      'procd',
      'proxy',
      'routing'
    ]);
  });

  it('covers all locked OpenWrt-nikki v1.26.2 repeatable sections', () => {
    expect(Object.keys(schema.repeatable_sections).sort()).toEqual([
      'authentication',
      'hosts',
      'lan_access_control',
      'nameserver',
      'nameserver_policy',
      'proxy_server_nameserver_policy',
      'router_access_control',
      'rule',
      'rule_provider',
      'sniff',
      'subscription'
    ]);
  });

  it('marks secret fields properly and includes upstream avaliable spelling on subscription', () => {
    expect(schema.named_sections.mixin.options.api_secret.secret).toBe(true);
    expect(schema.repeatable_sections.authentication.options.password.secret).toBe(true);
    expect(schema.repeatable_sections.subscription.options.avaliable.readonly).toBe(true);
  });

  it('tracks valid upstream Nikki & Mihomo versions and vendored Nikki core files', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../upstream/versions.json'), 'utf8'));
    expect(manifest.nikki.tag).toBe(schema.upstream.tag);
    expect(manifest.mihomo.tag).toBe(schema.upstream.mihomo_tag);
    expect(manifest.nikki.files.length).toBeGreaterThanOrEqual(15);
    expect(manifest.mihomo.assets.x86_64.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.mihomo.assets.aarch64_generic.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const f of manifest.nikki.files) {
      const content = readFileSync(path.resolve(__dirname, '../upstream/nikki', f.path));
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
