// Devices — connected clients and static DHCP reservations. Live leases come from
// moci.getDHCPLeases; reservations are dhcp 'host' sections. Reservation edits are
// low-risk (no management path change) so they commit and reload dnsmasq directly.
const MAC=/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPV4=/^(\d{1,3}\.){3}\d{1,3}$/;
const validIP=v=>IPV4.test(v)&&v.split('.').every(n=>Number(n)<=255);
const normMac=v=>String(v||'').trim().toLowerCase();
// Vendor identity uses the full IEEE MA-L OUI registry (oui-data.js, lazy-loaded in show()).
// A few well-known virtualization prefixes are locally administered but not random, so they
// are recognised before the randomized-MAC check.
const LOCAL_OUI={'52:54:00':'QEMU/KVM','00:0c:29':'VMware','00:50:56':'VMware','00:05:69':'VMware','08:00:27':'VirtualBox','00:1c:42':'Parallels','00:15:5d':'Microsoft Hyper-V','00:16:3e':'Xen','00:1c:14':'VMware'};
// Locally-administered bit (bit 1 of the first octet) marks private/randomized MACs.
const isRandomMac=mac=>{const o=parseInt(normMac(mac).split(":")[0],16);return Number.isFinite(o)&&(o&0x02)!==0;};
export default class DevicesModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/devices',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(o,m,a={}){const [s,r]=await this.core.ubusCall(o,m,a,{timeout:30000});if(s!==0)throw new Error(o+'.'+m+' failed ('+s+')');return r||{};}
	async uci(m,a){return this.rpc('uci',m,a);}
	async show(){
		this.page=document.getElementById('devices-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#devices-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Discovering devices on your network…','page-loading'));
		try{
			const [leases,dhcp,network,firewall,arp,oui,v6]=await Promise.all([
				this.rpc('moci','getDHCPLeases').catch(()=>({dhcp_leases:[]})),
				this.uci('get',{config:'dhcp'}),
				this.uci('get',{config:'network'}).catch(()=>({values:{}})),
				this.uci('get',{config:'firewall'}).catch(()=>({values:{}})),
				this.rpc('file','read',{path:'/proc/net/arp'}).catch(()=>({data:''})),
				import('./oui-data.js?v=1.3.0r1').then(m=>m.default).catch(()=>({})),
				this.rpc('dhcp','ipv6leases').catch(()=>({}))
			]);
			this.oui=oui||{};
			this.leases=Array.isArray(leases.dhcp_leases)?leases.dhcp_leases:[];
			this.dhcp=dhcp.values||{};
			this.network=network.values||{};
			this.firewall=firewall.values||{};
			this.reservations=Object.entries(this.dhcp).filter(([,v])=>v?.['.type']==='host');
			this.connected=this.buildConnected(arp.data);
			this.v6ByMac=this.buildV6Map(v6);
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read devices: '+e.message,'page-error'));}
	}
	resForMac(mac){return this.reservations.find(([,v])=>normMac(v.mac)===normMac(mac));}
	// Map device MAC -> global IPv6 address from odhcpd leases (DUID-LL embeds the MAC).
	buildV6Map(v6){
		const map={};
		const containers=Object.values(v6?.device||v6||{});
		for(const c of containers){
			for(const lease of (c?.leases||[])){
				const duid=String(lease.duid||'');
				const m=/^00030001([0-9a-f]{12})$/i.exec(duid);
				if(!m)continue;
				const mac=m[1].match(/../g).join(':');
				const addr=(lease['ipv6-addr']||[]).map(a=>a.address).find(Boolean);
				if(addr)map[normMac(mac)]=addr;
			}
		}
		return map;
	}
	ipCell(dev){
		const td=this.el('td',undefined,'dev-mono');
		td.append(this.el('div',dev.ipaddr));
		const v6=this.v6ByMac?.[normMac(dev.macaddr)];
		if(v6)td.append(this.el('div',v6,'dev-res-meta'));
		return td;
	}
	// Internet pause = one named firewall REJECT rule keyed by MAC (survives IP changes).
	blockRuleForMac(mac){
		const name='moci_block_'+normMac(mac);
		return Object.entries(this.firewall||{}).find(([,v])=>v?.['.type']==='rule'&&v.name===name)||null;
	}
	isBlocked(mac){
		const r=this.blockRuleForMac(mac);
		return !!(r&&r[1].enabled!=='0'&&String(r[1].target||'').toUpperCase()==='REJECT');
	}
	isQuotaBlocked(mac){
		const name='moci_quota_'+normMac(mac);
		const r=Object.entries(this.firewall||{}).find(([,v])=>v?.['.type']==='rule'&&v.name===name);
		return !!(r&&r[1].enabled!=='0'&&String(r[1].target||'').toUpperCase()==='REJECT');
	}
	async toggleBlock(dev){
		if(this.busy)return;
		const mac=normMac(dev.macaddr);
		if(!MAC.test(mac)){this.core.showToast('This device has no usable MAC address to pause','error');return;}
		this.busy=true;
		try{
			const existing=this.blockRuleForMac(mac);
			if(existing){
				await this.core.uciDelete('firewall',existing[0]);
				await this.core.uciApplyConfig('firewall');
				this.core.showToast('Internet access restored','success');
			}else{
				const [,res]=await this.core.uciAdd('firewall','rule');
				if(!res?.section)throw new Error('Failed to create rule');
				await this.core.uciSet('firewall',res.section,{name:'moci_block_'+mac,src:'lan',src_mac:mac,dest:'wan',proto:'all',target:'REJECT',enabled:'1'});
				await this.core.uciApplyConfig('firewall');
				this.core.showToast('Internet paused for this device','success');
			}
			await this.show();
		}catch(e){
			this.core.showToast('Could not change device access: '+e.message,'error');
		}finally{this.busy=false;}
	}
	async showQuota(dev){
		document.querySelector('.dev-modal-overlay')?.remove();
		const mac=normMac(dev.macaddr);
		const trigger=document.activeElement;
		let quotaCfg={};let usage=null;let existing=null;
		try{const [s,r]=await this.core.uciGet('moci_quota');if(s===0&&r?.values){quotaCfg=r.values;existing=Object.entries(quotaCfg).find(([,v])=>v?.['.type']==='device'&&normMac(v.mac)===mac)||null;}}catch{}
		try{
			const [s,r]=await this.core.ubusCall('file','exec',{command:'/usr/libexec/nlbwmon-action',params:['download','-f','json']},{timeout:30000});
			if(s===0&&r?.code===0){const obj=JSON.parse(r.stdout);const idx={};(obj.columns||[]).forEach((c,i)=>idx[c]=i);let tot=0;for(const row of obj.data||[]){if(normMac(row[idx.mac])===mac)tot+=(Number(row[idx.rx_bytes])||0)+(Number(row[idx.tx_bytes])||0);}usage=tot;}
		}catch{}
		const overlay=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');
		card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','dev-quota-title');
		const head=this.el('div',undefined,'dev-modal-head');
		const title=this.el('h3','Daily quota — '+(dev.hostname||dev.ipaddr));title.id='dev-quota-title';
		const close=this.el('button','Close','dev-action');close.type='button';
		head.append(title,close);
		const body=this.el('div',undefined,'dev-modal-body');
		body.append(this.el('p','Cap this device’s internet usage per day. When the cap is reached it is paused until the next day. Enforcement runs every few minutes and requires Bandwidth Monitor (nlbwmon).','page-note'));
		if(usage!=null)body.append(this.el('p','Used today (approx.): '+this.core.formatBytes(usage),'page-note'));
		const capInput=this.el('input');capInput.type='number';capInput.min='1';capInput.className='form-input';capInput.placeholder='e.g. 2048';capInput.value=existing?(existing[1].limit_mb||''):'';
		const capField=this.el('label',undefined,'advanced-field');capField.append(this.el('span','Daily cap (MB)'),capInput);
		const enCheck=this.el('input');enCheck.type='checkbox';enCheck.checked=existing?existing[1].enabled!=='0':true;
		const enLabel=this.el('label',undefined,'profiles-check');enLabel.append(enCheck,this.el('span','Enable quota'));
		body.append(capField,enLabel);
		const foot=this.el('div',undefined,'dev-modal-foot');
		const remove=this.el('button','Remove','dev-action danger');remove.type='button';
		const save=this.el('button','SAVE QUOTA','action-btn');save.type='button';
		foot.append(remove,save);
		card.append(head,body,foot);overlay.append(card);document.body.append(overlay);
		const dismiss=()=>{overlay.remove();trigger?.focus?.();};
		close.addEventListener('click',dismiss);
		overlay.addEventListener('click',e=>{if(e.target===overlay)dismiss();});
		remove.addEventListener('click',async()=>{
			try{if(existing){await this.core.uciDelete('moci_quota',existing[0]);await this.core.uciCommit('moci_quota');}this.core.showToast('Quota removed','success');dismiss();await this.show();}
			catch(e){this.core.showToast('Could not remove quota: '+e.message,'error');}
		});
		save.addEventListener('click',async()=>{
			const mb=Number(capInput.value);
			if(!Number.isFinite(mb)||mb<=0){this.core.showToast('Enter a daily cap in MB','error');return;}
			save.disabled=true;
			try{
				let sec=existing?existing[0]:null;
				if(!sec){const [,res]=await this.core.uciAdd('moci_quota','device');sec=res?.section;if(!sec)throw new Error('create failed');}
				await this.core.uciSet('moci_quota',sec,{mac:mac,limit_mb:String(mb),enabled:enCheck.checked?'1':'0'});
				await this.core.uciSet('moci_quota','settings',{enabled:'1'});
				await this.core.uciCommit('moci_quota');
				await this.core.ubusCall('file','exec',{command:'/etc/init.d/nlbwmon',params:['enable']},{timeout:15000}).catch(()=>{});
				await this.core.ubusCall('file','exec',{command:'/etc/init.d/nlbwmon',params:['start']},{timeout:15000}).catch(()=>{});
				this.core.showToast('Quota saved','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Could not save quota: '+e.message,'error');save.disabled=false;}
		});
		capInput.focus();
	}
	vendorForMac(mac){
		const p=normMac(mac).split(':').slice(0,3).join(':');
		if(LOCAL_OUI[p])return LOCAL_OUI[p];
		if(isRandomMac(mac))return 'Private / randomized MAC';
		return this.oui[p]||'Unknown vendor';
	}
	// Every device seen on the LAN (ARP table), not just ones this router gave a
	// DHCP lease to — other DHCP servers (e.g. a mesh system) may serve clients.
	buildConnected(arpData){
		const leaseByMac=new Map(this.leases.map(l=>[normMac(l.macaddr),l]));
		const resByMac=new Map(this.reservations.map(([id,v])=>[normMac(v.mac),{id,...v}]));
		const clean=h=>(h&&h!=='*')?h:'';
		const seen=new Set();const out=[];
		const push=(ip,mac)=>{
			const key=normMac(mac);if(seen.has(key))return;seen.add(key);
			const lease=leaseByMac.get(key);const res=resByMac.get(key);
			out.push({ipaddr:ip,macaddr:mac,
				hostname:clean(lease?.hostname)||clean(res?.name)||'',
				expires:lease?lease.expires:0,hasLease:!!lease,isStatic:!!res});
		};
		for(const line of String(arpData||'').split('\n').slice(1)){
			const p=line.trim().split(/\s+/);
			if(p.length<6)continue;
			const [ip,,flags,mac,,device]=p;
			if(flags==='0x0'||device!=='br-lan')continue;
			if(!validIP(ip)||!MAC.test(mac))continue;
			push(ip,mac);
		}
		for(const l of this.leases){if(validIP(l.ipaddr)&&MAC.test(l.macaddr))push(l.ipaddr,l.macaddr);}
		const ipNum=ip=>ip.split('.').reduce((a,o)=>a*256+Number(o),0);
		out.sort((a,b)=>ipNum(a.ipaddr)-ipNum(b.ipaddr));
		return out;
	}
	profileForIp(ip){
		if(!validIP(ip))return '—';
		const octets=ip.split('.').map(Number);
		for(const [name,v] of Object.entries(this.network)){
			if(v?.['.type']!=='interface'||!v.ipaddr)continue;
			const net=String(v.ipaddr).split('.').map(Number);
			const mask=String(v.netmask||'255.255.255.0').split('.').map(Number);
			if(net.length!==4||mask.length!==4)continue;
			const inSubnet=octets.every((o,i)=>(o&mask[i])===(net[i]&mask[i]));
			if(!inSubnet)continue;
			if(['lan','wan','wan6','loopback'].includes(name))return name==='lan'?'Main LAN':name.toUpperCase();
			for(const z of Object.values(this.firewall)){
				if(z?.['.type']!=='zone')continue;
				const nets=Array.isArray(z.network)?z.network:String(z.network||'').split(/\s+/);
				if(nets.includes(name)&&String(z.name||'').startsWith('moci_'))return z.name.replace(/^moci_/,'');
			}
			return name;
		}
		return '—';
	}
	async commitReload(){
		await this.uci('commit',{config:'dhcp'});
		try{await this.rpc('file','exec',{command:'/etc/init.d/dnsmasq',params:['reload']});}
		catch(e){this.core.showToast('Saved, but dnsmasq reload may be needed: '+e.message,'info');}
	}
	render(){
		const root=this.root;root.replaceChildren();
		const resByMac=new Map(this.reservations.map(([id,v])=>[normMac(v.mac),{id,...v}]));

		// Summary
		const summary=this.el('div',undefined,'dev-summary');
		const stat=(n,label)=>{const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',String(n),'dev-stat-n'),this.el('span',label,'dev-stat-l'));return c;};
		summary.append(stat(this.connected.length,'Connected now'),stat(this.reservations.length,'Static reservations'));
		root.append(summary);

		// Connected devices
		root.append(this.el('h3','Connected devices'));
		root.append(this.el('p','Every device seen on your LAN, whether or not this router handed out its address (another DHCP server, e.g. a mesh system, may serve some). Make a device’s address static so it never changes — useful for servers, printers and port forwarding.','page-note'));
		const toolbar=this.el('div',undefined,'page-toolbar');
		const search=this.el('input');search.type='search';search.className='form-input';search.placeholder='Search by name, IP or MAC';search.setAttribute('aria-label','Search devices');search.style.maxWidth='320px';
		const count=this.el('span',undefined,'page-note');count.style.margin='0';
		toolbar.append(search,count);root.append(toolbar);
		const table=this.el('table',undefined,'data-table dev-table');
		const thead=this.el('thead');const hr=this.el('tr');
		for(const h of ['Device','Vendor','IP address','Profile','Lease','Type',''])hr.append(this.el('th',h));
		thead.append(hr);table.append(thead);
		const tbody=this.el('tbody');table.append(tbody);root.append(table);
		const renderRows=()=>{
			const q=(search.value||'').trim().toLowerCase();
			const list=this.connected.filter(d=>!q||(d.hostname||'').toLowerCase().includes(q)||d.ipaddr.toLowerCase().includes(q)||normMac(d.macaddr).includes(q));
			count.textContent=list.length+' of '+this.connected.length+' devices';
			tbody.replaceChildren();
			if(!list.length){
				const tr=this.el('tr');const td=this.el('td',this.connected.length?'No devices match your search.':'No devices are currently connected.','page-note');td.colSpan=7;tr.append(td);tbody.append(tr);return;
			}
			for(const dev of list){
				const tr=this.el('tr');
				const name=dev.hostname||'Unknown device';
				const res=resByMac.get(normMac(dev.macaddr));
				const blocked=this.isBlocked(dev.macaddr);
				const nameCell=this.el('td');
				const identity=this.el('div',undefined,'dev-identity');
				identity.append(this.el('span',name,'dev-name'),this.el('span',dev.macaddr,'dev-mono dev-res-meta'));
				nameCell.append(identity);
				const profile=this.profileForIp(dev.ipaddr);
				tr.append(nameCell,this.el('td',this.vendorForMac(dev.macaddr)),this.ipCell(dev),
					this.el('td',profile),this.el('td',dev.expires>0?this.fmtLease(dev.expires):'—'));
				const typeCell=this.el('td');
				const typeLabel=dev.isStatic?'Static':(dev.hasLease?'DHCP':'Other');
				typeCell.append(this.el('span',typeLabel,'dev-badge '+(dev.isStatic?'static':'dynamic')));
				if(blocked)typeCell.append(this.el('span','Paused','dev-badge dynamic'));
				if(this.isQuotaBlocked(dev.macaddr))typeCell.append(this.el('span','Quota paused','dev-badge dynamic'));
				tr.append(typeCell);
				const act=this.el('td');
				const row=this.el('div',undefined,'action-row');
				if(res){
					const b=this.el('button','Reserved','dev-action');b.type='button';b.disabled=true;row.append(b);
				}else{
					const b=this.el('button','Make static','dev-action');b.type='button';
					b.addEventListener('click',()=>this.makeStatic(dev));
					row.append(b);
				}
				const pause=this.el('button',blocked?'Resume':'Pause','dev-action'+(blocked?'':' danger'));pause.type='button';
				pause.title=blocked?'Restore internet access for this device':'Cut internet access for this device';
				pause.addEventListener('click',()=>this.toggleBlock(dev));
				row.append(pause);
				const quota=this.el('button','Quota','dev-action');quota.type='button';
				quota.title='Set a daily bandwidth cap for this device';
				quota.addEventListener('click',()=>this.showQuota(dev));
				row.append(quota);
				const perm=this.el('button','Permissions','dev-action');perm.type='button';
				perm.addEventListener('click',()=>this.showPermissions(dev,profile));
				row.append(perm);
				act.append(row);tr.append(act);tbody.append(tr);
			}
		};
		search.addEventListener('input',renderRows);
		renderRows();

		// Static reservations
		root.append(this.el('h3','Static IP reservations'));
		if(!this.reservations.length){
			root.append(this.el('p','No static reservations yet. Use “Make static” above, or add one manually below.','page-note'));
		}else{
			const list=this.el('div',undefined,'dev-res-list');
			for(const [id,v] of this.reservations){
				const card=this.el('div',undefined,'dev-res-card stat-card');
				const info=this.el('div',undefined,'dev-res-info');
				info.append(this.el('strong',v.name||'(unnamed)','dev-name'),
					this.el('span',(v.ip||'—')+'  ·  '+(v.mac||'—'),'dev-mono dev-res-meta'));
				const online=this.connected.some(d=>normMac(d.macaddr)===normMac(v.mac));
				const actions=this.el('div',undefined,'dev-res-actions');
				actions.append(this.el('span',online?'Online':'Offline','dev-badge '+(online?'static':'dynamic')));
				const edit=this.el('button','Edit','dev-action');edit.type='button';
				edit.addEventListener('click',()=>this.editReservation(id,v));
				const del=this.el('button','Remove','dev-action danger');del.type='button';
				del.addEventListener('click',()=>this.removeReservation(id,v));
				actions.append(edit,del);
				card.append(info,actions);list.append(card);
			}
			root.append(list);
		}

		// Add reservation form
		root.append(this.el('h3','Add a reservation'));
		const form=this.el('form',undefined,'dev-form stat-card');
		const name=this.input('dev-name','Living-room TV','text');
		const mac=this.input('dev-mac','aa:bb:cc:dd:ee:ff','text');
		const ip=this.input('dev-ip','192.168.50.50','text');
		form.append(this.field('Device name',name),this.field('MAC address',mac),this.field('Static IPv4',ip));
		const add=this.el('button','ADD RESERVATION','action-btn');add.type='submit';
		form.append(add);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.saveReservation(null,{name:name.value.trim(),mac:normMac(mac.value),ip:ip.value.trim()},add);
		});
		root.append(form);
		root.append(this.el('p','A reservation ties a MAC address to a fixed IP. The device receives that address the next time it reconnects or renews its lease.','page-note'));
	}
	fmtLease(sec){
		if(sec>=3600)return Math.floor(sec/3600)+'h '+Math.floor((sec%3600)/60)+'m';
		if(sec>=60)return Math.floor(sec/60)+'m';
		return sec+'s';
	}
	showPermissions(lease,profile){
		document.querySelector('.dev-modal-overlay')?.remove();
		const trigger=document.activeElement;
		const overlay=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');
		card.setAttribute('role','dialog');
		card.setAttribute('aria-modal','true');
		card.setAttribute('aria-labelledby','dev-perm-title');
		const head=this.el('div',undefined,'dev-modal-head');
		const title=this.el('h3',lease.hostname||'Device permissions');title.id='dev-perm-title';
		const close=this.el('button','Close','dev-action');close.type='button';
		head.append(title,close);
		const meta=this.el('p',this.vendorForMac(lease.macaddr)+'  ·  '+lease.ipaddr+'  ·  profile: '+profile,'page-note');
		const note=this.el('p','Permissions are opt-in and off by default. Delegate an inbound port to this device, or publish a DNS name for it. Profile-wide internet, DNS and LAN access are managed on the Security Profiles page.','page-note');
		const actions=this.el('div',undefined,'dev-modal-actions');
		const port=this.el('button','Delegate a port','action-btn');port.type='button';
		const dns=this.el('button','Publish a DNS name','action-btn');dns.type='button';
		const prof=this.el('button','Manage profile access','action-btn');prof.type='button';
		actions.append(port,dns,prof);
		card.append(head,meta,note,actions);
		overlay.append(card);
		const closeDialog=()=>{overlay.remove();document.removeEventListener('keydown',onKey);if(trigger&&trigger.focus)trigger.focus();};
		const onKey=e=>{
			if(e.key==='Escape'){e.preventDefault();closeDialog();return;}
			if(e.key==='Tab'){
				const f=[...card.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')];
				if(!f.length)return;
				const first=f[0],last=f[f.length-1];
				if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
				else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
			}
		};
		close.addEventListener('click',closeDialog);
		overlay.addEventListener('click',e=>{if(e.target===overlay)closeDialog();});
		port.addEventListener('click',()=>{closeDialog();this.core.navigate('/published-ports');});
		dns.addEventListener('click',()=>{closeDialog();this.core.navigate('/network/dns');});
		prof.addEventListener('click',()=>{closeDialog();this.core.navigate('/profiles');});
		document.addEventListener('keydown',onKey);
		document.body.append(overlay);
		close.focus();
	}
	input(id,ph,type){const i=this.el('input');i.id=id;i.type=type;i.placeholder=ph;i.className='form-input';i.autocomplete='off';return i;}
	field(label,input){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),input);return w;}
	validate(name,mac,ip,excludeId){
		if(!MAC.test(mac)){this.core.showToast('Enter a valid MAC address (aa:bb:cc:dd:ee:ff)','error');return false;}
		if(!validIP(ip)){this.core.showToast('Enter a valid IPv4 address','error');return false;}
		for(const [id,v] of this.reservations){
			if(id===excludeId)continue;
			if(normMac(v.mac)===mac){this.core.showToast('That MAC already has a reservation','error');return false;}
			if(v.ip===ip){this.core.showToast('That IP is already reserved for another device','error');return false;}
		}
		return true;
	}
	async makeStatic(lease){
		const name=lease.hostname||('device-'+lease.ipaddr.split('.').pop());
		await this.saveReservation(null,{name,mac:normMac(lease.macaddr),ip:lease.ipaddr},null,true);
	}
	async editReservation(id,v){
		const name=window.prompt('Device name',v.name||'');if(name===null)return;
		const ip=window.prompt('Static IPv4 address',v.ip||'');if(ip===null)return;
		await this.saveReservation(id,{name:name.trim(),mac:normMac(v.mac),ip:ip.trim()},null);
	}
	async removeReservation(id,v){
		if(!window.confirm('Remove the static reservation for '+(v.name||v.mac)+' ('+v.ip+')? The device will fall back to a dynamic address.'))return;
		this.busy=true;
		try{
			await this.uci('delete',{config:'dhcp',section:id});
			await this.commitReload();
			this.core.showToast('Reservation removed','success');
			await this.show();
		}catch(e){this.core.showToast('Could not remove reservation: '+e.message,'error');}
		finally{this.busy=false;}
	}
	async saveReservation(id,{name,mac,ip},btn,fromLease=false){
		if(!this.validate(name,mac,ip,id))return;
		if(!fromLease&&!window.confirm('Reserve '+ip+' for '+(name||mac)+'?'))return;
		this.busy=true;if(btn){btn.disabled=true;}
		try{
			let section=id;
			if(!section){const r=await this.uci('add',{config:'dhcp',type:'host'});section=r.section;}
			await this.uci('set',{config:'dhcp',section,values:{name:name||mac,mac,ip}});
			await this.commitReload();
			this.core.showToast(id?'Reservation updated':'Static reservation added','success');
			await this.show();
		}catch(e){this.core.showToast('Could not save reservation: '+e.message,'error');}
		finally{this.busy=false;if(btn)btn.disabled=false;}
	}
}
