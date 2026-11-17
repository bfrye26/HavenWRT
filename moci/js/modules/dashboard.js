// Dashboard — answers one question at a glance: "is my network OK right now?"
// Status strip leads, uniform KPI cards, an honest throughput graph (real axis,
// correct 3-minute window, legend matching the lines), a quiet "needs attention"
// panel, and compact system bullets. Quick actions live in a menu, not loud buttons.
const NS = 'http://www.w3.org/2000/svg';
const POLL_SECONDS = 3;
const HISTORY_LEN = 60; // 60 samples x 3s = 3 minutes

export default class DashboardModule {
	constructor(core) {
		this.core = core;
		this.history = { down: [], up: [], devices: [] };
		this.lastNet = null;
		this.lastCpu = null;
		this.wanOnline = null;
		this.attention = [];
		this.setupMenu();
		this.core.registerRoute('/dashboard', () => this.load());
	}

	el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
	svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
	set(id, text) { const e = document.getElementById(id); if (e) e.textContent = text; }

	setupMenu() {
		const btn = document.getElementById('dash-menu-btn');
		const pop = document.getElementById('dash-menu-pop');
		if (!btn || !pop) return;
		btn.addEventListener('click', e => { e.stopPropagation(); pop.classList.toggle('hidden'); });
		document.addEventListener('click', () => pop.classList.add('hidden'));
		pop.addEventListener('click', e => {
			const b = e.target.closest('[data-action]');
			if (!b) return;
			pop.classList.add('hidden');
			this.runQuickAction(b.dataset.action);
		});
	}

	async runQuickAction(action) {
		if (action === 'reboot') {
			if (!confirm('Reboot the router? You will be disconnected briefly.')) return;
			const [status] = await this.core.ubusCall('system', 'reboot', {});
			if (status !== 0) { this.core.showToast('Reboot request was rejected', 'error'); return; }
			this.core.showToast('Reboot requested. Reconnect after the router starts.', 'success');
			setTimeout(() => this.core.logout(), 2000);
			return;
		}
		try {
			const [status, result] = await this.core.serviceReload(action);
			if (status !== 0 || result?.code !== 0) throw new Error('reload not confirmed');
			this.core.showToast(`${action === 'network' ? 'Network' : 'Firewall'} reloaded`, 'success');
		} catch (err) {
			this.core.showToast(`Could not reload ${action}: ${err.message}`, 'error');
		}
	}

	async load() {
		document.getElementById('dashboard-page')?.classList.remove('hidden');
		try {
			const [sys, board] = await Promise.all([
				this.core.ubusCall('system', 'info', {}).then(r => r[0] === 0 ? r[1] : null).catch(() => null),
				this.core.ubusCall('system', 'board', {}).then(r => r[0] === 0 ? r[1] : null).catch(() => null)
			]);
			this.set('dash-hostname', board?.hostname || 'router');
			if (sys) {
				this.uptimeStr = this.core.formatUptime(sys.uptime);
				this.renderMemory(sys.memory);
			}
			this.updateFooter();
			this.loadVersion();
			await this.updateCpu();
			await this.updateNetwork();
			await this.updateWAN();
			await this.updateDevices();
			await this.updateAttention();
			this.renderGraph();
			this.renderStatus();
			this.set('dash-updated', 'Updated just now');
		} catch (err) {
			console.error('Dashboard load failed:', err);
			this.core.showToast('Failed to load system information', 'error');
		}
	}

	updateFooter() {
		this.set('dash-sys-foot', `Up ${this.uptimeStr || '—'}${this.version ? ' · ' + this.version : ''}`);
	}

	async loadVersion() {
		try {
			const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/moci-release' });
			if (s === 0 && r?.data) {
				const m = r.data.match(/MOCI_VERSION=(.+)/);
				if (m) { this.version = 'Haven ' + m[1].trim(); this.updateFooter(); }
			}
		} catch {}
	}

	// Polling entry point (core.startPolling calls this every 3s).
	async update() {
		await this.updateCpu();
		await this.updateNetwork();
		await this.updateWAN();
		await this.updateDevices();
		this.renderStatus();
		this.set('dash-updated', 'Updated just now');
	}

	async updateCpu() {
		try {
			const [s, r] = await this.core.ubusCall('file', 'read', { path: '/proc/stat' });
			if (s !== 0 || !r?.data) throw new Error('no data');
			const v = r.data.split('\n')[0].split(/\s+/).slice(1).map(Number);
			const cur = { idle: v[3], total: v.reduce((a, b) => a + b, 0) };
			if (this.lastCpu) {
				const dTotal = cur.total - this.lastCpu.total;
				const usage = dTotal > 0 ? (1 - (cur.idle - this.lastCpu.idle) / dTotal) * 100 : 0;
				this.renderCpu(usage);
			}
			this.lastCpu = cur;
		} catch { this.set('cpu', '—'); }
	}

	renderCpu(usage) {
		const pct = Math.max(0, Math.min(100, usage));
		this.set('cpu', pct.toFixed(0) + '%');
		const bar = document.getElementById('cpu-bar');
		if (bar) { bar.style.width = pct + '%'; bar.className = 'fill' + (pct > 90 ? ' bad' : pct > 70 ? ' warn' : ''); }
	}

	renderMemory(mem) {
		if (!mem) return;
		const total = mem.total || 1;
		const avail = Number(mem.available ?? mem.free ?? 0);
		const pct = Math.max(0, Math.min(100, ((total - avail) / total) * 100));
		const el = document.getElementById('memory');
		if (el) { el.textContent = pct.toFixed(0) + '%'; el.title = this.core.formatMemory(mem); }
		const bar = document.getElementById('memory-bar');
		if (bar) { bar.style.width = pct + '%'; bar.className = 'fill' + (pct > 90 ? ' bad' : pct > 75 ? ' warn' : ''); }
	}

	async updateNetwork() {
		try {
			const [s, r] = await this.core.ubusCall('file', 'read', { path: '/proc/net/dev' });
			if (s !== 0 || !r?.data) throw new Error('no data');
			let rx = 0, tx = 0;
			r.data.split('\n').slice(2).forEach(line => {
				const p = line.trim().split(/\s+/);
				if (!p[0] || p[0].startsWith('lo:')) return;
				rx += parseInt(p[1]) || 0; tx += parseInt(p[9]) || 0;
			});
			const now = Date.now();
			if (this.lastNet) {
				const dt = (now - this.lastNet.t) / 1000;
				if (dt > 0) {
					// Honest bit-rate: bytes * 8 / 1000 -> kbps (the old code showed byte-rate as Mbps).
					const downKbps = Math.max(0, rx - this.lastNet.rx) * 8 / 1000 / dt;
					const upKbps = Math.max(0, tx - this.lastNet.tx) * 8 / 1000 / dt;
					this.pushHistory('down', downKbps);
					this.pushHistory('up', upKbps);
					this.renderRateKpis(downKbps, upKbps);
					this.renderGraph();
				}
			}
			this.lastNet = { t: now, rx, tx };
		} catch (err) { console.error('network stats:', err); }
	}

	pushHistory(key, val) {
		this.history[key].push(val);
		if (this.history[key].length > HISTORY_LEN) this.history[key].shift();
	}

	renderRateKpis(downKbps, upKbps) {
		const down = document.getElementById('kpi-down');
		const up = document.getElementById('kpi-up');
		const fmt = kbps => {
			const mbps = kbps / 1000;
			return mbps >= 1 ? mbps.toFixed(1) : mbps.toFixed(2);
		};
		if (down) down.innerHTML = fmt(downKbps) + '<span class="unit">Mbps</span>';
		if (up) up.innerHTML = fmt(upKbps) + '<span class="unit">Mbps</span>';
		const peak = arr => arr.length ? Math.max(...arr) / 1000 : 0;
		this.set('kpi-down-sub', `peak ${peak(this.history.down).toFixed(0)} Mbps last 3 min`);
		this.set('kpi-up-sub', `peak ${peak(this.history.up).toFixed(0)} Mbps last 3 min`);
		this.sparkline('spark-down', this.history.down);
		this.sparkline('spark-up', this.history.up);
	}

	async updateDevices() {
		try {
			const [s, r] = await this.core.ubusCall('file', 'read', { path: '/proc/net/arp' });
			let count = 0;
			if (s === 0 && r?.data) {
				count = r.data.split('\n').slice(1).filter(l => {
					const p = l.trim().split(/\s+/);
					return p.length >= 4 && p[2] !== '0x0';
				}).length;
			}
			this.set('kpi-devices', String(count));
			this.pushHistory('devices', count);
			this.sparkline('spark-devices', this.history.devices);
		} catch { this.set('kpi-devices', '—'); }
	}

	async updateWAN() {
		try {
			const [s, r] = await this.core.ubusCall('network.interface', 'dump', {});
			if (s !== 0 || !r?.interface) throw new Error('no data');
			const ifaces = r.interface;
			let lan = ifaces.find(i => i.interface === 'lan' || i.device === 'br-lan');
			if (!lan) lan = ifaces.find(i => i.up && i['ipv4-address']?.length && i.interface !== 'loopback');
			let wan = null, gateway = null;
			for (const i of ifaces) {
				if (!i.up || i.interface === 'loopback') continue;
				const dr = i.route?.find(x => x.target === '0.0.0.0');
				if (dr) { wan = i; gateway = dr.nexthop; break; }
			}
			this.wanOnline = !!wan;
			this.lanIp = lan?.['ipv4-address']?.[0]?.address || '—';
			this.wanIp = wan?.['ipv4-address']?.[0]?.address || (gateway ? `gw ${gateway}` : '—');
		} catch { this.wanOnline = null; }
	}

	renderStatus() {
		const strip = document.getElementById('dash-status');
		if (!strip) return;
		const online = this.wanOnline === true;
		strip.classList.toggle('offline', this.wanOnline === false);
		this.set('dash-status-text', this.wanOnline === null ? 'Checking…' : online ? 'Internet online' : 'Internet offline');
		this.set('dash-status-meta', `WAN ${this.wanIp || '—'}  ·  LAN ${this.lanIp || '—'}`);
		const n = this.attention.length;
		this.set('dash-status-right', this.wanOnline === false ? '⚠ Needs attention' : n ? `⚠ ${n} issue${n > 1 ? 's' : ''}` : '✓ No issues');
	}

	async updateAttention() {
		const items = [];
		if (this.wanOnline === false) items.push({ sev: 'error', msg: 'Internet is offline', action: 'Check WAN', href: '#/wan' });
		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', { command: '/sbin/logread', params: [] });
			if (s === 0 && r?.stdout) {
				const lines = r.stdout.split('\n').slice(-150);
				const count = re => lines.filter(l => re.test(l)).length;
				const auth = count(/bad password|authentication fail/i);
				const hang = count(/tx unit hang|link is down|carrier lost/i);
				const oom = count(/out of memory|oom-kill/i);
				const errs = count(/\berr(or)?\b|failed|panic/i);
				if (auth) items.push({ sev: 'error', msg: `${auth} failed login attempt${auth > 1 ? 's' : ''}`, action: 'View log', href: '#/system/logs' });
				if (hang) items.push({ sev: 'warn', msg: 'Network link / driver warning', action: 'View log', href: '#/system/logs' });
				if (oom) items.push({ sev: 'error', msg: 'Memory pressure detected', action: 'View log', href: '#/system/logs' });
				if (!auth && !hang && !oom && errs) items.push({ sev: 'warn', msg: `${errs} error${errs > 1 ? 's' : ''} in system log`, action: 'View log', href: '#/system/logs' });
			}
		} catch {}
		this.attention = items.slice(0, 4);
		this.renderAttention();
	}

	renderAttention() {
		const box = document.getElementById('dash-attention');
		if (!box) return;
		box.replaceChildren();
		if (!this.attention.length) {
			const d = this.el('div', undefined, 'all-clear');
			d.innerHTML = '<span class="tick">&#10003;</span>All clear — nothing needs action';
			box.append(d);
			return;
		}
		for (const it of this.attention) {
			const row = this.el('div', undefined, 'attn-item' + (it.sev === 'error' ? ' error' : ''));
			row.append(this.el('span', it.sev === 'error' ? '⚠' : '⚠', 'attn-ico'));
			row.append(this.el('span', it.msg, 'attn-msg'));
			const a = this.el('button', it.action, 'attn-action');
			a.type = 'button';
			a.addEventListener('click', () => { window.location.hash = it.href; });
			row.append(a);
			box.append(row);
		}
	}

	sparkline(id, data) {
		const host = document.getElementById(id);
		if (!host) return;
		host.replaceChildren();
		if (data.length < 2) return;
		const cs = getComputedStyle(document.documentElement);
		const accent = cs.getPropertyValue('--accent').trim() || '#6b9eff';
		const w = 260, h = 30, max = Math.max(...data, 1);
		const svg = this.svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%', preserveAspectRatio: 'none' });
		const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 2 - (v / max) * (h - 6)]);
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
		svg.append(this.svgEl('path', { d: `${line} L${w} ${h} L0 ${h} Z`, fill: accent, 'fill-opacity': '0.14', stroke: 'none' }));
		svg.append(this.svgEl('path', { d: line, fill: 'none', stroke: accent, 'stroke-width': '1.5' }));
		host.append(svg);
	}

	renderGraph() {
		const svg = document.getElementById('dash-graph');
		if (!svg) return;
		const down = this.history.down, up = this.history.up;
		const cs = getComputedStyle(document.documentElement);
		const accent = cs.getPropertyValue('--accent').trim() || '#6b9eff';
		const faint = cs.getPropertyValue('--faint').trim() || '#5c6470';
		const muted = cs.getPropertyValue('--muted').trim() || '#8b93a3';
		svg.replaceChildren();
		const W = 640, H = 230, L = 46, R = 12, T = 12, B = 26;
		if (down.length < 2) {
			const t = this.svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: muted, 'font-size': '13' });
			t.textContent = 'Collecting network samples…';
			svg.append(t);
			return;
		}
		const rawMaxMbps = Math.max(...down, ...up, 1) / 1000;
		const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
		const max = steps.find(s => s >= rawMaxMbps) || Math.ceil(rawMaxMbps / 1000) * 1000;
		const X = i => L + i / (HISTORY_LEN - 1) * (W - L - R);
		const Y = mbps => T + (1 - mbps / max) * (H - T - B);
		for (let g = 0; g <= 4; g++) {
			const val = max * g / 4, y = Y(val);
			svg.append(this.svgEl('line', { x1: L, y1: y, x2: W - R, y2: y, stroke: faint, 'stroke-opacity': '0.22', 'stroke-width': '1' }));
			const lbl = this.svgEl('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', fill: muted, 'font-size': '10' });
			lbl.textContent = val >= 1 ? val.toFixed(0) : val.toFixed(1);
			svg.append(lbl);
		}
		const n = down.length;
		const xAt = i => L + (i + (HISTORY_LEN - n)) / (HISTORY_LEN - 1) * (W - L - R);
		const dPath = down.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + Y(v / 1000).toFixed(1)).join(' ');
		svg.append(this.svgEl('path', { d: `${dPath} L${xAt(n - 1).toFixed(1)} ${Y(0)} L${xAt(0).toFixed(1)} ${Y(0)} Z`, fill: accent, 'fill-opacity': '0.14', stroke: 'none' }));
		svg.append(this.svgEl('path', { d: dPath, fill: 'none', stroke: accent, 'stroke-width': '2' }));
		const uPath = up.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + Y(v / 1000).toFixed(1)).join(' ');
		svg.append(this.svgEl('path', { d: uPath, fill: 'none', stroke: faint, 'stroke-width': '1.5', 'stroke-dasharray': '4 3' }));
		['-3m', '-2m', '-1m', 'now'].forEach((s, i) => {
			const t = this.svgEl('text', { x: L + i / 3 * (W - L - R), y: H - 8, 'text-anchor': i === 3 ? 'end' : i === 0 ? 'start' : 'middle', fill: muted, 'font-size': '10' });
			t.textContent = s;
			svg.append(t);
		});
	}
}