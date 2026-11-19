import assert from 'node:assert/strict';
import DevicesModule from '../moci/js/modules/devices.js';
import SystemModule from '../moci/js/modules/system.js';
import MultiwanModule from '../moci/js/modules/multiwan.js';
import SecureDnsModule from '../moci/js/modules/securedns.js';

// ---- Minimal DOM shim (mirrors dmz.test.mjs) ----
function makeEl(tag) {
	const classes = new Set();
	return {
		tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {},
		textContent: '', innerHTML: '', className: '', id: '', value: '', disabled: false, parentNode: null,
		classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c) },
		append(...ns) { ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
		replaceChildren(...ns) { this.children = []; ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
		addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
		removeEventListener() {}, focus() {}, remove() {},
		querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
	};
}
function docWith(els) {
	return {
		createElement: t => makeEl(t),
		getElementById: id => els[id] || null,
		querySelector: () => null,
		body: { append() {} },
		activeElement: { focus() {} },
		addEventListener() {}, removeEventListener() {}
	};
}

// ---- Per-device pause: detection + block rule creation/removal ----
{
	const dev = Object.create(DevicesModule.prototype);
	dev.firewall = {
		r1: { '.type': 'rule', name: 'moci_block_aa:bb:cc:dd:ee:ff', target: 'REJECT', enabled: '1' },
		r2: { '.type': 'rule', name: 'moci_quota_11:22:33:44:55:66', target: 'REJECT', enabled: '1' },
		r3: { '.type': 'rule', name: 'moci_block_99:99:99:99:99:99', target: 'REJECT', enabled: '0' }
	};
	assert.equal(dev.isBlocked('aa:bb:cc:dd:ee:ff'), true, 'active manual block detected');
	assert.equal(dev.isBlocked('99:99:99:99:99:99'), false, 'disabled block is not paused');
	assert.equal(dev.isQuotaBlocked('11:22:33:44:55:66'), true, 'quota block detected');
	assert.equal(dev.isQuotaBlocked('aa:bb:cc:dd:ee:ff'), false, 'manual block is not a quota block');

	// Pause a new device -> creates a MAC-keyed REJECT rule.
	const sets = []; const adds = []; const deletes = []; const applied = [];
	dev.core = {
		uciAdd: async (cfg, type) => { adds.push({ cfg, type }); return [0, { section: 'cfgNew' }]; },
		uciSet: async (cfg, sec, vals) => { sets.push({ cfg, sec, vals }); return [0]; },
		uciDelete: async (cfg, sec) => { deletes.push({ cfg, sec }); return [0]; },
		uciApplyConfig: async cfg => { applied.push(cfg); },
		showToast: () => {}
	};
	dev.busy = false; dev.show = async () => {};
	dev.firewall = {};
	await dev.toggleBlock({ macaddr: 'AA:BB:CC:DD:EE:FF', hostname: 'tv' });
	assert.equal(adds.length, 1, 'pause creates a firewall rule');
	assert.equal(sets[0].vals.name, 'moci_block_aa:bb:cc:dd:ee:ff', 'rule keyed by normalized MAC');
	assert.equal(sets[0].vals.src_mac, 'aa:bb:cc:dd:ee:ff', 'matches by MAC');
	assert.equal(sets[0].vals.target, 'REJECT');
	assert.equal(sets[0].vals.dest, 'wan', 'cuts internet, not LAN');
	assert.deepEqual(applied, ['firewall'], 'rollback-safe firewall apply');

	// Resume -> deletes the existing rule.
	dev.firewall = { rX: { '.type': 'rule', name: 'moci_block_aa:bb:cc:dd:ee:ff', target: 'REJECT', enabled: '1' } };
	await dev.toggleBlock({ macaddr: 'aa:bb:cc:dd:ee:ff' });
	assert.deepEqual(deletes, [{ cfg: 'firewall', sec: 'rX' }], 'resume removes the block rule');
}

// ---- Backup restore: requires a file; uploads then runs sysupgrade --restore ----
{
	const toasts = []; const execs = []; const uploads = [];
	const sys = Object.create(SystemModule.prototype);
	sys.core = { showToast: (m, t) => toasts.push({ m, t }), ubusCall: async (o, m, p) => { if (o === 'file' && m === 'exec') execs.push(p); return [0, { code: 0 }]; }, logout: () => {} };
	sys.uploadFileChunked = async (file, path) => { uploads.push(path); };
	globalThis.confirm = () => true;

	// No file selected -> error, no upload.
	globalThis.document = docWith({ 'restore-file': { files: [] }, 'restore-btn': makeEl('button') });
	await sys.restoreBackup();
	assert.equal(uploads.length, 0, 'no file -> no upload');
	assert.ok(toasts.some(t => t.t === 'error'), 'no file raises an error toast');

	// Valid file -> upload to /tmp/restore.tar.gz then sysupgrade --restore.
	globalThis.document = docWith({ 'restore-file': { files: [{ name: 'backup.tar.gz', size: 10 }] }, 'restore-btn': makeEl('button') });
	await sys.restoreBackup();
	assert.deepEqual(uploads, ['/tmp/restore.tar.gz'], 'uploads to the restore path');
	assert.ok(execs.some(p => p.command === '/sbin/sysupgrade' && p.params[0] === '--restore' && p.params[1] === '/tmp/restore.tar.gz'), 'runs sysupgrade --restore');
}

// ---- Scheduled reboot + NTP: writes cron line and timeserver servers ----
{
	const sets = []; const writes = [];
	const sys = Object.create(SystemModule.prototype);
	sys.core = {
		uciSet: async (cfg, sec, vals) => { sets.push({ cfg, sec, vals }); return [0]; },
		uciCommit: async () => [0],
		serviceReload: async () => [0, {}],
		ubusCall: async (o, m, p) => {
			if (o === 'file' && m === 'read') return [0, { data: '0 0 * * * /etc/init.d/acme renew\n' }];
			if (o === 'file' && m === 'write') { writes.push(p); return [0]; }
			return [0, {}];
		},
		showToast: () => {}
	};
	const ntp = makeEl('input'); ntp.value = '0.pool.ntp.org 1.pool.ntp.org';
	const en = makeEl('select'); en.value = '1';
	const rt = makeEl('input'); rt.value = '04:30';
	globalThis.document = docWith({ 'ntp-servers': ntp, 'ntp-enabled': en, 'reboot-time': rt, 'save-time-btn': makeEl('button') });
	await sys.saveTime();
	assert.ok(sets.some(s => s.cfg === 'system' && Array.isArray(s.vals.server) && s.vals.server.length === 2), 'NTP servers written as a list');
	assert.ok(writes.some(w => w.path === '/etc/crontabs/root' && w.data.includes('30 4 * * * /sbin/reboot # moci-scheduled-reboot')), 'daily reboot cron line written');
	assert.ok(writes.every(w => w.data.includes('acme')), 'preserves unrelated cron entries');

	// Empty time -> no reboot line.
	writes.length = 0; rt.value = '';
	await sys.saveTime();
	assert.ok(writes.every(w => !w.data.includes('moci-scheduled-reboot')), 'empty time removes the reboot line');
}

// ---- Multi-WAN: status parsing, section filtering, delete ----
{
	const mw = Object.create(MultiwanModule.prototype);
	const status = mw.parseStatus('Interface status:\n interface wan is online\n interface wan2 is offline\nCurrent ipv4 policies:\n balanced:\n  wan (100%)\n');
	assert.equal(status.interfaces.length, 2);
	assert.equal(status.interfaces[0].state, 'online');
	assert.equal(status.policies[0].name, 'balanced');
	mw.cfg = { wan: { '.type': 'interface' }, balanced: { '.type': 'policy' }, r1: { '.type': 'rule' } };
	assert.equal(mw.sections('policy').length, 1);
	assert.equal(mw.sections('interface').length, 1);
	const deletes = []; const reloads = [];
	mw.core = { uciDelete: async (c, s) => { deletes.push(s); return [0]; }, uciCommit: async () => [0], serviceReload: async s => { reloads.push(s); return [0, {}]; }, showToast: () => {} };
	mw.show = async () => {};
	globalThis.confirm = () => true;
	await mw.deleteSection('balanced', 'policy balanced');
	assert.deepEqual(deletes, ['balanced']);
	assert.deepEqual(reloads, ['mwan3'], 'reloads mwan3 after delete');
}

// ---- Secure DNS: state helpers + enable + preset ----
{
	const sd = Object.create(SecureDnsModule.prototype);
	sd.main = ['@smartdns[0]', { enabled: '0' }];
	sd.dnsmasq = ['@dnsmasq[0]', { dnssec: '0' }];
	sd.smartdns = { '@smartdns[0]': { '.type': 'smartdns', enabled: '0' }, s1: { '.type': 'server', name: 'cf', ip: 'https://x', type: 'https' } };
	assert.equal(sd.enabled(), false);
	assert.equal(sd.dnssec(), false);
	assert.equal(sd.servers().length, 1);

	const sets = []; const execs = []; const adds = []; const reloads = [];
	sd.core = {
		uciSet: async (c, s, v) => { sets.push({ c, s, v }); return [0]; },
		uciAdd: async (c, t) => { adds.push({ c, t }); return [0, { section: 'srvNew' }]; },
		uciCommit: async () => [0],
		serviceReload: async s => { reloads.push(s); return [0, {}]; },
		ubusCall: async (o, m, p) => { if (o === 'file' && m === 'exec') execs.push(p); return [0, { code: 0 }]; },
		showToast: () => {}
	};
	sd.show = async () => {};
	globalThis.confirm = () => true;
	await sd.toggleSmartDns();
	assert.ok(sets.some(s => s.c === 'smartdns' && s.v.enabled === '1'), 'enables smartdns');
	assert.ok(execs.some(p => p.command === '/etc/init.d/smartdns' && p.params[0] === 'start'), 'starts smartdns');
	await sd.addPreset({ name: 'Cloudflare (DoH)', ip: 'https://cloudflare-dns.com/dns-query', type: 'https' });
	assert.ok(adds.some(a => a.c === 'smartdns' && a.t === 'server'), 'preset adds a server section');
	assert.ok(sets.some(s => s.v.ip === 'https://cloudflare-dns.com/dns-query' && s.v.type === 'https'), 'preset writes DoH upstream');
}

console.log('Trust & Control checks passed (pause, restore, scheduled reboot/NTP, multi-WAN, secure DNS)');