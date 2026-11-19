// Secure DNS — encrypted upstreams (DoH/DoT) via smartdns plus DNSSEC validation
// via dnsmasq-full. Opt-in. Enabling smartdns makes it dnsmasq's upstream (the
// smartdns init wires that automatically), so changes affect name resolution for
// the whole LAN — hence the explicit warning and a post-enable connectivity note.
const PRESETS=[
	{name:'Cloudflare (DoH)',ip:'https://cloudflare-dns.com/dns-query',type:'https'},
	{name:'Google (DoH)',ip:'https://dns.google/dns-query',type:'https'},
	{name:'Quad9 (DoH)',ip:'https://dns.quad9.net/dns-query',type:'https'},
	{name:'Cloudflare (DoT)',ip:'tls://1dot1dot1dot1.cloudflare-dns.com',type:'tls'}
];
export default class SecureDnsModule{
	constructor(core){this.core=core;this.core.registerRoute('/securedns',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(type,value,placeholder){const i=this.el('input');i.type=type;i.className='form-input';if(value!=null)i.value=value;if(placeholder)i.placeholder=placeholder;return i;}
	field(label,control){const l=this.el('label',undefined,'advanced-field');l.append(this.el('span',label),control);return l;}
	async show(){
		this.page=document.getElementById('securedns-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#securedns-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading Secure DNS settings…','page-loading'));
		try{
			const [sd,dhcp]=await Promise.all([
				this.core.uciGet('smartdns').catch(()=>[1,{values:{}}]),
				this.core.uciGet('dhcp').catch(()=>[1,{values:{}}])
			]);
			this.smartdns=(sd[0]===0&&sd[1]?.values)?sd[1].values:{};
			this.dhcp=(dhcp[0]===0&&dhcp[1]?.values)?dhcp[1].values:{};
			this.main=Object.entries(this.smartdns).find(([,v])=>v?.['.type']==='smartdns');
			this.dnsmasq=Object.entries(this.dhcp).find(([,v])=>v?.['.type']==='dnsmasq');
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read Secure DNS settings: '+e.message,'page-error'));}
	}
	enabled(){return this.main?.[1]?.enabled==='1';}
	dnssec(){return this.dnsmasq?.[1]?.dnssec==='1';}
	servers(){return Object.entries(this.smartdns).filter(([,v])=>v?.['.type']==='server');}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','Encrypt DNS lookups (DNS-over-HTTPS / DNS-over-TLS) and optionally validate DNSSEC. Enabling SmartDNS makes it the resolver for your whole network — verify browsing still works after turning it on.','dmz-warning'));
		// Status + enable
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Encrypted DNS (SmartDNS)','section-title'));
		const statusRow=this.el('div',undefined,'dmz-status');
		const wrap=this.el('div');wrap.innerHTML=this.core.renderBadge(this.enabled()?'success':'neutral',this.enabled()?'ENABLED':'OFF');statusRow.append(wrap);
		statusRow.append(this.el('span',this.enabled()?'SmartDNS is resolving your DNS queries.':'SmartDNS is off; DNS uses your normal upstreams.','dmz-status-text'));
		card.append(statusRow);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const toggle=this.el('button',this.enabled()?'TURN OFF':'TURN ON','action-btn'+(this.enabled()?' danger':''));toggle.type='button';
		toggle.addEventListener('click',()=>this.toggleSmartDns());
		actions.append(toggle);card.append(actions);
		root.append(card);
		// DNSSEC
		const dnssecCard=this.el('div',undefined,'stat-card');dnssecCard.style.marginTop='24px';
		dnssecCard.append(this.el('div','DNSSEC validation','section-title'));
		dnssecCard.append(this.el('p','Validate DNS answers cryptographically (dnsmasq-full). Use with DNSSEC-valid upstreams; some networks break if upstreams strip signatures.','page-note'));
		const dsRow=this.el('div',undefined,'action-row');
		const dsWrap=this.el('div');dsWrap.innerHTML=this.core.renderBadge(this.dnssec()?'success':'neutral',this.dnssec()?'ON':'OFF');dsRow.append(dsWrap);
		const dsBtn=this.el('button',this.dnssec()?'DISABLE DNSSEC':'ENABLE DNSSEC','action-btn');dsBtn.type='button';
		dsBtn.addEventListener('click',()=>this.toggleDnssec());dsRow.append(dsBtn);
		dnssecCard.append(dsRow);root.append(dnssecCard);
		// Upstreams
		root.append(this.el('h3','Encrypted upstream servers'));
		const bar=this.el('div',undefined,'page-toolbar');
		const add=this.el('button','ADD SERVER','action-btn');add.type='button';add.addEventListener('click',()=>this.editServer());bar.append(add);
		for(const p of PRESETS){const b=this.el('button',p.name,'dev-action');b.type='button';b.addEventListener('click',()=>this.addPreset(p));bar.append(b);}
		root.append(bar);
		const servers=this.servers();
		const t=this.el('table',undefined,'data-table');
		t.innerHTML='<thead><tr><th>Name</th><th>Server</th><th>Type</th><th></th></tr></thead>';
		const tb=this.el('tbody');
		if(!servers.length){const tr=this.el('tr');const td=this.el('td','No upstream servers yet. Add one or use a preset above.','page-note');td.colSpan=4;tr.append(td);tb.append(tr);}
		for(const [id,v] of servers){
			const tr=this.el('tr');
			tr.innerHTML=`<td><strong>${esc(v.name||id)}</strong></td><td class="dev-mono">${esc(v.ip||'—')}</td><td>${esc(v.type||'udp')}</td>`;
			const act=this.el('td');const row=this.el('div',undefined,'action-row');
			const e=this.el('button','Edit','dev-action');e.type='button';e.addEventListener('click',()=>this.editServer(id));
			const d=this.el('button','Delete','dev-action danger');d.type='button';d.addEventListener('click',()=>this.deleteServer(id));
			row.append(e,d);act.append(row);tr.append(act);tb.append(tr);
		}
		t.append(tb);root.append(t);
	}
	async reloadSmartDns(){await this.core.uciCommit('smartdns');await this.core.serviceReload('smartdns');}
	async toggleSmartDns(){
		const enable=!this.enabled();
		if(enable&&!confirm('Turn on SmartDNS encrypted DNS? It becomes the resolver for your whole network. Verify browsing works afterwards.'))return;
		try{
			const sec=this.main?.[0];if(!sec)throw new Error('SmartDNS config missing');
			await this.core.uciSet('smartdns',sec,{enabled:enable?'1':'0'});
			await this.core.uciCommit('smartdns');
			await this.core.ubusCall('file','exec',{command:'/etc/init.d/smartdns',params:[enable?'start':'stop']},{timeout:20000});
			this.core.showToast(enable?'SmartDNS enabled':'SmartDNS disabled','success');
			await this.show();
		}catch(e){this.core.showToast('Could not change SmartDNS: '+e.message,'error');}
	}
	async toggleDnssec(){
		const enable=!this.dnssec();
		if(enable&&!confirm('Enable DNSSEC validation? If your upstreams do not support DNSSEC, name resolution may fail for some sites.'))return;
		try{
			const sec=this.dnsmasq?.[0];if(!sec)throw new Error('dnsmasq config missing');
			await this.core.uciSet('dhcp',sec,{dnssec:enable?'1':'0'});
			await this.core.uciCommit('dhcp');
			await this.core.serviceReload('dnsmasq');
			this.core.showToast(enable?'DNSSEC enabled':'DNSSEC disabled','success');
			await this.show();
		}catch(e){this.core.showToast('Could not change DNSSEC: '+e.message,'error');}
	}
	async addPreset(p){
		try{
			const [,res]=await this.core.uciAdd('smartdns','server');const sec=res?.section;if(!sec)throw new Error('create failed');
			await this.core.uciSet('smartdns',sec,{name:p.name,ip:p.ip,type:p.type});
			await this.reloadSmartDns();this.core.showToast('Added '+p.name,'success');await this.show();
		}catch(e){this.core.showToast('Could not add preset: '+e.message,'error');}
	}
	async deleteServer(id){
		if(!confirm('Delete this upstream server?'))return;
		try{await this.core.uciDelete('smartdns',id);await this.reloadSmartDns();this.core.showToast('Server deleted','success');await this.show();}
		catch(e){this.core.showToast('Delete failed: '+e.message,'error');}
	}
	editServer(id){
		const v=id?this.smartdns[id]:null;
		document.querySelector('.sdns-overlay')?.remove();
		const trigger=document.activeElement;
		const ov=this.el('div',undefined,'dev-modal-overlay sdns-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
		const dismiss=()=>{ov.remove();trigger?.focus?.();};
		const head=this.el('div',undefined,'dev-modal-head');
		const close=this.el('button','Close','dev-action');close.type='button';close.addEventListener('click',dismiss);
		head.append(this.el('h3',id?'Edit upstream server':'Add upstream server'),close);
		const body=this.el('div',undefined,'dev-modal-body');
		const name=this.input('text',v?.name||'','Cloudflare');
		const ip=this.input('text',v?.ip||'','https://cloudflare-dns.com/dns-query');
		const type=this.el('select');type.className='form-input';
		for(const [val,label] of [['https','DoH (https://)'],['tls','DoT (tls://)'],['udp','Plain UDP'],['tcp','Plain TCP']]){const o=this.el('option',label);o.value=val;type.append(o);}
		type.value=v?.type||'https';
		body.append(this.el('p','Use a full URL for DoH (https://…) or DoT (tls://…). Plain UDP/TCP take an IP address.','page-note'),
			this.field('Name',name),this.field('Server URL / IP',ip),this.field('Type',type));
		const foot=this.el('div',undefined,'dev-modal-foot');
		const save=this.el('button','SAVE','action-btn');save.type='button';foot.append(save);
		card.append(head,body,foot);ov.append(card);document.body.append(ov);
		ov.addEventListener('click',e=>{if(e.target===ov)dismiss();});
		save.addEventListener('click',async()=>{
			const nm=name.value.trim();const server=ip.value.trim();
			if(!nm||!server){this.core.showToast('Name and server are required','error');return;}
			save.disabled=true;
			try{
				let sec=id;
				if(!sec){const [,res]=await this.core.uciAdd('smartdns','server');sec=res?.section;if(!sec)throw new Error('create failed');}
				await this.core.uciSet('smartdns',sec,{name:nm,ip:server,type:type.value});
				await this.reloadSmartDns();this.core.showToast('Server saved','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Save failed: '+e.message,'error');save.disabled=false;}
		});
		name.focus();
	}
}