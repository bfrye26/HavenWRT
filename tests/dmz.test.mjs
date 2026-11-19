import assert from 'node:assert/strict';
import NetworkModule from '../moci/js/modules/network.js';

// ---- Minimal DOM shim (mirrors ui-audit-regressions, plus classList for renderDmz) ----
function findById(node, id) {
	if (node.id === id) return node;
	for (const c of node.children || []) { const hit = findById(c, id); if (hit) return hit; }
	return null;
}
function makeEl(tag) {
	const classes = new Set();
	return {
		tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {},
		textContent: '', innerHTML: '', className: '', id: '', value: '', disabled: false, parentNode: null,
		classList: {
			add: (...c) => c.forEach(x => classes.add(x)),
			remove: (...c) => c.forEach(x => classes.delete(x)),
			contains: c => classes.has(c)
		},
		append(...ns) { ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
		replaceChildren(...ns) { this.children = []; ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
		addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
		removeEventListener() {}, focus() {}, remove() {},
		querySelector(sel) { return sel.startsWith('#') ? findById(this, sel.slice(1)) : null; },
		querySelectorAll() { return []; }, closest() { return null; }
	};
}
function makeDoc() {
	const els = {};
	return {
		els,
		createElement: t => makeEl(t),
		getElementById: id => els[id] || (els[id] = makeEl('div')),
		querySelector: () => null,
		body: { append() {} },
		activeElement: { focus() {} },
		addEventListener() {}, removeEventListener() {}
	};
}
const filterUciSections = (config, type) => Object.entries(config)
	.filter(([, v]) => v['.type'] === type)
	.map(([k, v]) => ({ section: k, ...v }));

// ---- 1: An all-ports redirect is detected as the DMZ and excluded from the port-forward table ----
{
	globalThis.document = makeDoc();
	const rendered = [];
	const core = {
		isFeatureEnabled: () => true,
		uciGet: async () => [0, { values: {
			fwd: { '.type': 'redirect', name: 'Plex', src_dport: '32400', dest_ip: '192.168.68.100', dest_port: '32400', enabled: '1' },
			dmz: { '.type': 'redirect', name: 'DMZ Host', dest_ip: '192.168.68.50', enabled: '1' },
			rule: { '.type': 'rule', name: 'allow', target: 'ACCEPT' }
		} }],
		filterUciSections,
		renderTable: (sel, items, cs, msg) => rendered.push({ sel, items, msg }),
		renderBadge: (t, x) => `<span class="badge badge-${t}">${x}</span>`,
		renderStatusBadge: c => (c ? 'ENABLED' : 'DISABLED'),
		renderActionButtons: () => '',
		escapeHtml: s => String(s),
		loadResource: async (id, cs, feat, fetcher) => { await fetcher(); }
	};
	const net = Object.create(NetworkModule.prototype);
	net.core = core;
	net.renderFwDefaults = () => {};
	net.renderZones = () => {};
	net.renderNatRules = () => {};
	await net.loadFirewall();

	assert.equal(net._dmz?.section, 'dmz', 'the port-less redirect is recognised as the DMZ host');
	assert.equal(net._dmz?.dest_ip, '192.168.68.50', 'DMZ host IP captured');
	const fwTable = rendered.find(r => r.sel === '#firewall-table');
	assert.equal(fwTable.items.length, 1, 'port-forward table excludes the DMZ redirect');
	assert.equal(fwTable.items[0].name, 'Plex', 'only the real port forward remains');
	assert.match(globalThis.document.els['dmz-status'].innerHTML, /192\.168\.68\.50/, 'DMZ status renders the host');
	assert.equal(globalThis.document.els['dmz-set-btn'].textContent, 'CHANGE HOST', 'button offers change when a DMZ exists');
	assert.equal(globalThis.document.els['dmz-remove-btn'].classList.contains('hidden'), false, 'remove button visible when a DMZ exists');
}

// ---- 1b: With no DMZ, the card shows the neutral OFF state ----
{
	globalThis.document = makeDoc();
	const core = {
		isFeatureEnabled: () => true,
		uciGet: async () => [0, { values: { fwd: { '.type': 'redirect', name: 'Plex', src_dport: '32400', dest_ip: '192.168.68.100' } } }],
		filterUciSections,
		renderTable: () => {},
		renderBadge: (t, x) => `<span class="badge badge-${t}">${x}</span>`,
		renderStatusBadge: () => '',
		renderActionButtons: () => '',
		escapeHtml: s => String(s),
		loadResource: async (id, cs, feat, fetcher) => { await fetcher(); }
	};
	const net = Object.create(NetworkModule.prototype);
	net.core = core;
	net.renderFwDefaults = () => {}; net.renderZones = () => {}; net.renderNatRules = () => {};
	await net.loadFirewall();
	assert.equal(net._dmz, null, 'no DMZ when every redirect has a port');
	assert.match(globalThis.document.els['dmz-status'].innerHTML, /badge-neutral/, 'OFF uses the neutral badge');
	assert.equal(globalThis.document.els['dmz-set-btn'].textContent, 'SET DMZ HOST', 'button offers set when no DMZ');
	assert.equal(globalThis.document.els['dmz-remove-btn'].classList.contains('hidden'), true, 'remove button hidden when no DMZ');
}

// ---- 2: saveDmz rejects invalid / out-of-subnet / router IPs without saving ----
{
	globalThis.document = makeDoc();
	globalThis.window = { confirm: () => true };
	const toasts = [];
	const saves = [];
	const core = { showToast: (m, t) => toasts.push({ m, t }), uciSave: opts => saves.push(opts) };
	const net = Object.create(NetworkModule.prototype);
	net.core = core;
	net._lanNet = { ipaddr: '192.168.68.1', netmask: '255.255.255.0' };

	for (const bad of ['999.1.1.1', '10.0.0.5', '192.168.68.1', 'not-an-ip']) {
		globalThis.document.els['edit-dmz-dest-ip'] = makeEl('input');
		globalThis.document.els['edit-dmz-dest-ip'].value = bad;
		net.saveDmz();
	}
	assert.equal(saves.length, 0, 'no invalid IP is ever saved');
	assert.equal(toasts.length, 4, 'each invalid IP raises an error toast');
	assert.ok(toasts.every(t => t.t === 'error'), 'validation failures are error toasts');
	assert.match(toasts[1].m, /LAN subnet/, 'out-of-subnet IP is rejected');
	assert.match(toasts[2].m, /router itself/, 'the router IP is rejected');
}

// ---- 3: A valid save writes an all-ports redirect (no port fields) with safe defaults ----
{
	globalThis.document = makeDoc();
	globalThis.window = { confirm: () => true };
	const saves = [];
	const core = { showToast: () => {}, uciSave: opts => saves.push(opts) };
	const net = Object.create(NetworkModule.prototype);
	net.core = core;
	net._lanNet = { ipaddr: '192.168.68.1', netmask: '255.255.255.0' };
	globalThis.document.els['edit-dmz-dest-ip'] = makeEl('input');
	globalThis.document.els['edit-dmz-dest-ip'].value = '192.168.68.50';
	net.saveDmz();

	assert.equal(saves.length, 1, 'a valid DMZ host is saved');
	const opts = saves[0];
	assert.equal(opts.config, 'firewall');
	assert.equal(opts.uciType, 'redirect', 'DMZ is a firewall redirect (DNAT)');
	assert.equal(opts.defaults.src, 'wan');
	assert.equal(opts.defaults.dest, 'lan');
	assert.equal(opts.defaults.target, 'DNAT');
	assert.equal(opts.defaults.proto, 'tcpudp');
	const uciKeys = Object.values(opts.fieldMap);
	assert.ok(uciKeys.includes('dest_ip') && uciKeys.includes('enabled'), 'maps host IP and enabled');
	assert.ok(!uciKeys.includes('src_dport') && !uciKeys.includes('dest_port'), 'no port fields => forwards all ports');
	assert.ok(!('src_dport' in opts.defaults) && !('dest_port' in opts.defaults), 'defaults add no ports either');

	// Declining the exposure confirm must not save.
	saves.length = 0;
	globalThis.window = { confirm: () => false };
	net.saveDmz();
	assert.equal(saves.length, 0, 'declining the exposure warning cancels the save');
}

// ---- 4: The device picker is populated from DHCP leases, sorted, with a manual option ----
{
	globalThis.document = makeDoc();
	const opened = [];
	const core = {
		resetModal: () => {},
		openModal: id => opened.push(id),
		ubusCall: async (obj, method) => {
			if (obj === 'moci' && method === 'getDHCPLeases') {
				return [0, { dhcp_leases: [
					{ ipaddr: '192.168.68.20', macaddr: 'aa:bb:cc:dd:ee:01', hostname: 'tv' },
					{ ipaddr: '192.168.68.3', macaddr: 'aa:bb:cc:dd:ee:02', hostname: '' }
				] }];
			}
			return [6, {}];
		},
		uciGet: async () => [0, { values: { lan: { '.type': 'interface', ipaddr: '192.168.68.1', netmask: '255.255.255.0', proto: 'static' } } }]
	};
	const net = Object.create(NetworkModule.prototype);
	net.core = core;
	net._dmz = null;
	await net.openDmzModal();

	assert.equal(net._lanNet?.ipaddr, '192.168.68.1', 'LAN subnet fetched for validation');
	assert.deepEqual(opened, ['dmz-modal'], 'the DMZ modal opens');
	const select = globalThis.document.els['dmz-device-select'];
	assert.equal(select.children.length, 3, 'manual option + two leases');
	assert.equal(select.children[0].value, '', 'first option is manual entry');
	assert.match(select.children[0].textContent, /manually/i);
	assert.equal(select.children[1].value, '192.168.68.3', 'leases sorted numerically by IP');
	assert.equal(select.children[2].value, '192.168.68.20');
	assert.match(select.children[2].textContent, /tv \(192\.168\.68\.20\)/, 'hostname shown with IP');
}

console.log('DMZ host checks passed (detection, validation, all-ports save, device picker)');