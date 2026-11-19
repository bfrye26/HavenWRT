import assert from 'node:assert/strict';
import DevicesModule from '../moci/js/modules/devices.js';
import BanipModule from '../moci/js/modules/banip.js';
import OpenvpnModule from '../moci/js/modules/openvpn.js';
import IpsecModule from '../moci/js/modules/ipsec.js';
import PortalModule from '../moci/js/modules/portal.js';

// ---- IPv6 lease map: DUID-LL embeds the MAC ----
{
	const dev = Object.create(DevicesModule.prototype);
	const v6 = { device: { 'br-lan': { leases: [
		{ duid: '000300010055da5f2d86', 'ipv6-addr': [{ address: '2001:db8::40c' }] },
		{ duid: '00010001aabbccdd', 'ipv6-addr': [{ address: '2001:db8::99' }] } // DUID-LLT, no MAC match
	] } } };
	const map = dev.buildV6Map(v6);
	assert.equal(map['00:55:da:5f:2d:86'], '2001:db8::40c', 'DUID-LL MAC mapped to its IPv6 address');
	assert.equal(Object.keys(map).length, 1, 'non-LL DUIDs are skipped');
	// flat shape (no device wrapper) also handled
	const flat = { 'br-lan': { leases: [ { duid: '00030001aabbccddeeff', 'ipv6-addr': [{ address: '2001:db8::1' }] } ] } };
	assert.equal(dev.buildV6Map(flat)['aa:bb:cc:dd:ee:ff'], '2001:db8::1', 'flat lease shape handled');
}

// ---- BanIP: enable + feed selection parsing ----
{
	const b = Object.create(BanipModule.prototype);
	b.global = { ban_enabled: '1', ban_feed: ['cinsscore', 'bogon'] };
	assert.equal(b.enabled(), true);
	assert.deepEqual(b.selectedFeeds(), ['cinsscore', 'bogon']);
	b.global = { ban_enabled: '0', ban_feed: 'cinsscore' };
	assert.equal(b.enabled(), false);
	assert.deepEqual(b.selectedFeeds(), ['cinsscore'], 'single feed string normalized to array');
}

// ---- OpenVPN / IPsec / Portal: section filtering + state ----
{
	const o = Object.create(OpenvpnModule.prototype);
	o.cfg = { moci_a: { '.type': 'openvpn', config: '/etc/openvpn/moci_a.ovpn' }, moci_b: { '.type': 'openvpn', server: '10.8.0.0 255.255.255.0' }, other: { '.type': 'rule' } };
	assert.equal(o.instances().length, 2, 'only openvpn sections listed');

	const i = Object.create(IpsecModule.prototype);
	i.cfg = { site1: { '.type': 'connection', right: '198.51.100.1' }, setup: { '.type': 'setup' } };
	assert.equal(i.connections().length, 1, 'only connection sections listed');

	const p = Object.create(PortalModule.prototype);
	p.setup = ['setup', { enabled: '1', auto_run: '1', gatewayinterface: 'br-lan' }];
	assert.equal(p.enabled(), true, 'portal active requires enabled + auto_run');
	p.setup = ['setup', { enabled: '1', auto_run: '0' }];
	assert.equal(p.enabled(), false, 'auto_run off means not active');
	p.network = { lan: { '.type': 'interface', ipaddr: '192.168.68.1' }, wan: { '.type': 'interface', proto: 'dhcp' } };
	assert.deepEqual(p.bridges(), ['lan'], 'only interfaces with an IPv4 address offered');
}

console.log('Security & VPN checks passed (IPv6 leases, banIP, OpenVPN/IPsec/portal state)');