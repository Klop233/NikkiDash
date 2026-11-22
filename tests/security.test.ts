import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '../package/nikki-dash');

describe('Static security invariants for OpenWrt package', () => {
  it('ACL grants only nikki-dash methods and never generic uci/file/exec/rc/service/luci.nikki', () => {
    const acl = JSON.parse(
      readFileSync(path.join(pkgRoot, 'files/usr/share/rpcd/acl.d/nikki-dash.json'), 'utf8')
    );

    // Unauthenticated only gets auth_info
    expect(acl.unauthenticated.read.ubus).toEqual({ 'nikki-dash': ['auth_info'] });
    expect(acl.unauthenticated.write).toBeUndefined();

    // Neither nikki-dash nor nikki-dash-guest may grant forbidden generic objects
    const forbidden = ['uci', 'file', 'exec', 'rc', 'service', 'system', 'luci', 'luci.nikki'];
    for (const group of ['nikki-dash', 'nikki-dash-guest']) {
      const readObjs = Object.keys(acl[group].read.ubus);
      const writeObjs = Object.keys(acl[group].write.ubus);
      for (const f of forbidden) {
        expect(readObjs).not.toContain(f);
        expect(writeObjs).not.toContain(f);
      }
    }

    // Guest ACL must NOT include set_access
    expect(acl['nikki-dash-guest'].write.ubus['nikki-dash']).not.toContain('set_access');
  });

  it('init.d script never passes -a (no_ubusauth) or -X (CORS) and defaults to lan_auth on port 18080', () => {
    const initScript = readFileSync(path.join(pkgRoot, 'files/etc/init.d/nikki-dash'), 'utf8');
    const defaultCfg = readFileSync(path.join(pkgRoot, 'files/etc/config/nikki_dash'), 'utf8');

    expect(initScript).not.toMatch(/procd_append_param command.*\s-a(\s|$)/);
    expect(initScript).not.toMatch(/procd_append_param command.*\s-X(\s|$)/);
    expect(initScript).toContain('-S -D');
    expect(defaultCfg).toContain("option access_mode 'lan_auth'");
    expect(defaultCfg).toContain("option http_port '18080'");
    expect(defaultCfg).toContain("option wan_risk_acknowledged '0'");
  });

  it('Makefile does not depend on luci-app-nikki and never modifies /etc/config/nikki in postinst', () => {
    const mk = readFileSync(path.join(pkgRoot, 'Makefile'), 'utf8');
    const dependsMatch = mk.match(/^  DEPENDS:=.+$/m);
    expect(dependsMatch).not.toBeNull();
    expect(dependsMatch![0]).not.toContain('luci-app-nikki');
    expect(mk).toContain('PKGARCH:=all');
    expect(mk).toContain('/etc/config/nikki_dash');
    expect(mk).not.toMatch(/\/etc\/init\.d\/nikki\s+(start|restart|enable)/);
  });

  it('backend ucode never exposes a generic Mihomo passthrough method', () => {
    const rpc = readFileSync(path.join(pkgRoot, 'files/usr/share/rpcd/ucode/nikki-dash'), 'utf8');
    const mihomo = readFileSync(path.join(pkgRoot, 'files/usr/share/nikki-dash/lib/mihomo.uc'), 'utf8');
    expect(rpc).not.toMatch(/\bapi\s*:\s*\{/);
    expect(mihomo).not.toMatch(/export function mihomo_request/);
    expect(mihomo).not.toContain('popen(');
  });
});
