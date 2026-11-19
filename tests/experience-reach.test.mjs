import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import MeshModule from '../moci/js/modules/mesh.js';

// ---- Mesh capability detection from `iw phy` ----
{
	const m = Object.create(MeshModule.prototype);
	const iw = [
		'Wiphy phy0',
		'\tSupported interface modes:',
		'\t\t * IBSS',
		'\t\t * managed',
		'\t\t * AP',
		'\t\t * monitor',
		'Wiphy phy1',
		'\tSupported interface modes:',
		'\t\t * managed',
		'\t\t * AP',
		'\t\t * mesh point',
		'\tSupported commands:',
		'\t\t * new_interface'
	].join('\n');
	assert.deepEqual(m.detectMeshPhys(iw), ['phy1'], 'only the mesh-capable phy is detected');
	assert.deepEqual(m.detectMeshPhys('Wiphy phy0\n\tSupported interface modes:\n\t\t * managed\n'), [], 'RT3070-style radio (no mesh) yields empty');
	assert.deepEqual(m.detectMeshPhys(''), [], 'no radios yields empty');
}

// ---- PWA manifest installability fields ----
{
	const manifest = JSON.parse(readFileSync('moci/manifest.json', 'utf8'));
	assert.ok(manifest.id, 'manifest has id');
	assert.ok(manifest.scope, 'manifest has scope');
	assert.equal(manifest.display, 'standalone');
	assert.ok(manifest.icons.some(i => i.sizes === '192x192'), '192 icon present');
	assert.ok(manifest.icons.some(i => i.sizes === '512x512'), '512 icon present');
	assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'maskable icon present');
}

// ---- Service worker must never cache RPC/auth ----
{
	const sw = readFileSync('moci/sw.js', 'utf8');
	assert.ok(sw.includes("url.pathname.startsWith('/ubus')"), 'SW excludes /ubus from caching');
	assert.ok(sw.includes("req.method !== 'GET'"), 'SW excludes non-GET from caching');
	assert.ok(sw.includes('/cgi-bin'), 'SW excludes /cgi-bin from caching');
}

console.log('Experience & Reach checks passed (mesh capability, PWA manifest, SW RPC safety)');