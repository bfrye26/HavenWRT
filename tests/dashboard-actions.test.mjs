import assert from 'node:assert/strict';
import DashboardModule from '../moci/js/modules/dashboard.js';
import SystemModule from '../moci/js/modules/system.js';

// The redesigned dashboard puts quick actions in a menu and routes them through
// runQuickAction(action). Stub the DOM so the constructor's menu wiring is a no-op.
globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.window = { location: {} };
const calls = [], toasts = [];
let response = [0, { code: 0 }], allowed = false;
globalThis.confirm = () => allowed;
const core = {
	registerRoute() {}, showToast: (...args) => toasts.push(args),
	ubusCall: async (...args) => { calls.push(args); return response; },
	serviceReload: async service => { calls.push(service); return response; },
	logout() {}
};
const dash = new DashboardModule(core);

await dash.runQuickAction('reboot');
assert.equal(calls.length, 0, 'Cancelled reboot sends no request');

await dash.runQuickAction('firewall');
assert.equal(calls.at(-1), 'firewall');
assert.equal(toasts.at(-1)[1], 'success');

response = [0, { code: 1 }];
await dash.runQuickAction('network');
assert.equal(toasts.at(-1)[1], 'error', 'A failed command must not announce success');

response = [6, {}]; allowed = true;
await dash.runQuickAction('reboot');
assert.equal(toasts.at(-1)[1], 'error', 'Rejected reboot must not announce success');

const systemHandlers = SystemModule.prototype.setupHandlers?.toString() || '';
assert.doesNotMatch(systemHandlers, /dash-menu|runQuickAction/, 'System navigation must not add dashboard handlers');
console.log('Dashboard quick-action regression checks passed');