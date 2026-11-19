import assert from 'node:assert/strict';
import DevicesModule from '../moci/js/modules/devices.js';
import DashboardModule from '../moci/js/modules/dashboard.js';
import NetworkModule from '../moci/js/modules/network.js';
import SystemModule from '../moci/js/modules/system.js';
import { OpenWrtCore } from '../moci/js/core.js';

// ---- Minimal DOM shim (insertBefore throws NotFoundError on a non-child, like browsers) ----
function findById(node, id) {
	if (node.id === id) return node;
	for (const c of node.children || []) { const hit = findById(c, id); if (hit) return hit; }
	return null;
}
function makeEl(tag) {
	return {
		tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {},
		textContent: '', innerHTML: '', className: '', id: '', hidden: false, value: '', disabled: false,
		parentNode: null, colSpan: 0,
		append(...ns) { ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
		replaceChildren(...ns) { this.children = []; ns.forEach(n => { n.parentNode = this; this.children.push(n); }); },
		setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
		addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
		removeEventListener() {}, focus() {}, remove() {},
		querySelector(sel) { return sel.startsWith('#') ? findById(this, sel.slice(1)) : null; },
		querySelectorAll() { return []; }, closest() { return null; },
		insertBefore(n, ref) {
			n.parentNode = this;
			const i = this.children.indexOf(ref);
			if (i < 0) { const e = new Error('The node before which the new node is to be inserted is not a child of this node.'); e.name = 'NotFoundError'; throw e; }
			this.children.splice(i, 0, n); return n;
		}
	};
}
function allText(node) { return (node.textContent || '') + (node.children || []).map(allText).join(''); }

// ---- BUG-01: Devices Permissions must not throw vendorForMac ReferenceError ----
{
	const appended = [];
	globalThis.document = {
		createElement: t => makeEl(t),
		querySelector: () => null,
		body: { append: n => appended.push(n) },
		activeElement: { focus() {} },
		addEventListener() {}, removeEventListener() {}
	};
	const dev = Object.create(DevicesModule.prototype);
	dev.core = { navigate() {}, escapeHtml: s => String(s) };
	dev.oui = { '00:11:22': 'Acme' };
	dev.el = function (tag, text, cls) { const e = makeEl(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
	dev.showPermissions({ macaddr: '00:11:22:33:44:55', ipaddr: '192.168.50.10', hostname: 'tv' }, 'Main LAN');
	assert.equal(appended.length, 1, 'Permissions overlay is appended (dialog opens)');
	assert.match(allText(appended[0]), /Acme/, 'vendor metadata renders via this.vendorForMac');
	const dialog = appended[0].children[0];
	assert.equal(dialog.attrs['role'], 'dialog', 'dialog has role');
	assert.equal(dialog.attrs['aria-modal'], 'true', 'dialog is aria-modal');
}

// ---- BUG-04: dashboard graph must not place the Mbps unit inside the SVG tick area ----
{
	const svg = makeEl('svg');
	globalThis.document = { getElementById: id => (id === 'dash-graph' ? svg : null), documentElement: {} };
	globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
	const dash = Object.create(DashboardModule.prototype);
	dash.history = { down: [1000, 5000, 9000], up: [200, 400, 600] };
	dash.svgEl = function (tag, attrs) { const e = makeEl(tag); Object.assign(e.attrs, attrs); return e; };
	dash.renderGraph();
	const texts = svg.children.filter(c => c.tagName === 'text').map(c => c.textContent);
	assert(!texts.includes('Mbps'), 'Mbps unit is not drawn inside the SVG (moved to header)');
	assert(texts.some(t => /^\d/.test(t)), 'Y-axis tick labels still render');
}

// ---- BUG-05: legacy QoS classify tab redirects to the shipped SQM page ----
// qos-scripts is not in the image; the dead classify UI was replaced with a
// redirect so users never edit a config whose package is absent.
{
	const navigated = [];
	const core = { navigate: path => navigated.push(path) };
	const net = Object.create(NetworkModule.prototype); net.core = core;
	await net.loadQoS();
	assert.deepEqual(navigated, ['/qos'], 'legacy QoS tab redirects to the SQM page');
}

// ---- BUG-06: Diagnostics renders into the real connections-table and finishes ----
{
	const rendered = [];
	const core = {
		isFeatureEnabled: () => true,
		ubusCall: async () => [0, { dhcp_leases: [{ ipaddr: '192.168.50.10', macaddr: 'aa:bb:cc:dd:ee:ff', hostname: 'tv', expires: 7200 }] }],
		renderTable: (sel, items, cs, msg) => rendered.push({ sel, items, msg }),
		loadResource: async (id, cs, feat, fetcher) => { await fetcher(); },
		escapeHtml: s => String(s)
	};
	const net = Object.create(NetworkModule.prototype); net.core = core;
	await net.loadDiagnostics();
	assert.equal(rendered.length, 1, 'diagnostics reaches a result (no indefinite loading)');
	assert.equal(rendered[0].sel, '#connections-table', 'targets the real table, not dhcp-clients-table');
	assert.equal(rendered[0].items.length, 1, 'renders the lease');

	core.ubusCall = async () => [6, {}];
	let threw = false;
	try { await net.loadDiagnostics(); } catch { threw = true; }
	assert.ok(threw, 'RPC failure surfaces as an error, not a silent no-op');
}

// ---- BUG-02: Software toolbar inserts without NotFoundError and is idempotent ----
{
	const card = makeEl('div'); card.className = 'stat-card';
	const tableEl = makeEl('table'); tableEl.id = 'packages-table'; card.append(tableEl);
	const tbody = makeEl('tbody'); tableEl.append(tbody);
	const tab = makeEl('div'); tab.id = 'tab-software'; tab.append(card);
	globalThis.document = {
		getElementById: id => ({ 'tab-software': tab, 'packages-table': tableEl }[id] || null),
		querySelector: sel => (sel === '#packages-table tbody' ? tbody : null),
		createElement: t => makeEl(t)
	};
	const sys = Object.create(SystemModule.prototype);
	sys.core = { showToast() {} };
	sys.packageCommand = async () => 'htop\t3.3.0';
	await sys.loadPackages();
	const toolbar1 = findById(tab, 'moci-package-toolbar');
	assert.ok(toolbar1, 'toolbar is inserted on first visit');
	assert.equal(toolbar1.parentNode, card, 'toolbar is a direct child of the card');
	await sys.loadPackages();
	const toolbars = [];
	(function walk(n) { if (n.id === 'moci-package-toolbar') toolbars.push(n); (n.children || []).forEach(walk); })(tab);
	assert.equal(toolbars.length, 1, 'repeat visit does not duplicate the toolbar');
	assert.ok(tbody.children.length > 0, 'package rows render (not stranded on Loading)');
}

// ---- BUG-03: shared address field has form-input styling + a visible label ----
{
	globalThis.document = { createElement: t => makeEl(t) };
	const core = Object.create(OpenWrtCore.prototype);
	const { form, input, button } = core.deviceAddressForm({ label: 'Trusted device IPv4', placeholder: 'e.g. 192.168.50.40', buttonText: 'Delegate device' });
	assert.equal(input.className, 'form-input', 'address input uses the shared form-input class');
	assert.equal(form.className, 'device-address-form', 'form uses the responsive address-row layout');
	const label = form.children[0];
	assert.equal(label.tagName, 'label', 'a visible label element is present');
	assert.equal(label.children[0].textContent, 'Trusted device IPv4', 'label text is visible (not placeholder-only)');
	assert.equal(button.type, 'submit', 'submit button present');
}

console.log('UI audit regression checks passed (BUG-01…BUG-06)');