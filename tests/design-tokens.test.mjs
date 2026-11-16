import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('moci/app.css', 'utf8');
const html = readFileSync('moci/index.html', 'utf8');

// 1. All six themes exist and the semantic token set is defined.
const themes = ['obsidian', 'cloud', 'ocean', 'terminal', 'amethyst', 'copper'];
for (const t of themes) assert(css.includes(`[data-theme="${t}"]`), 'Theme missing: ' + t);
for (const tok of ['--surface', '--surface-2', '--text', '--muted', '--faint', '--accent', '--ok', '--warn', '--bad', '--border', '--track', '--accent-soft', '--ok-soft', '--warn-soft', '--bad-soft']) {
	assert(new RegExp(tok.replace(/[-]/g, '\\-') + '\\s*:').test(css), 'Semantic token not defined: ' + tok);
}

// 2. No undefined CSS variables (the old dead --neon-*/--slate-*/--steel-light/
//    --error-red tokens must now be defined as aliases).
const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map(m => m[1]))];
const missing = used.filter(v => !defined.has(v));
assert.deepEqual(missing, [], 'Undefined CSS variables: ' + missing.join(', '));

// 3. Shared components use sentence-case labels and token colors (no hardcoded
//    white-alpha that breaks the light Cloud theme).
const block = sel => {
	const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
	const m = css.match(re);
	return m ? m[1] : '';
};
for (const sel of ['.stat-label', '.section-title', '.form-label', '.data-table th', '.badge', '.action-btn']) {
	assert(!/text-transform:\s*uppercase/i.test(block(sel)), sel + ' should be sentence-case');
}
for (const sel of ['.stat-label', '.data-table td', '.action-btn', '.hero-details', '.form-input']) {
	assert(!/rgba\(255,\s*255,\s*255/.test(block(sel)), sel + ' still hardcodes white');
}

// 4. The legacy dashboard noise is gone from the markup.
assert(!html.includes('hero-indicator'), 'Pulsing hero dot should be removed');
assert(!html.includes('NETWORK ACTIVITY (60s)'), 'Mislabelled 60s graph should be gone');
assert(html.includes('Last 3 min'), 'Honest 3-minute graph window present');
assert(html.includes('Needs attention'), 'Attention panel present');
assert(!/var\(--(neon|slate)-|var\(--steel-light|var\(--error-red/.test(html), 'index.html still references dead tokens');

console.log('Design-token contract passed: 6 themes, semantic tokens defined, no dead vars, calm sentence-case components.');