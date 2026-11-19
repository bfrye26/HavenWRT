// IPsec / IKEv2 — strongswan site-to-site tunnels (stroke UCI connections + PSK).
// Software crypto on J4125 (no AES-NI): prefer AES-GCM / ChaCha20 proposals and
// expect lower throughput than WireGuard. Connections live in /etc/config/ipsec;
// pre-shared keys are written to /etc/ipsec.secrets.
export default class IpsecModule{
	constructor(core){this.core=core;this.core.registerRoute('/ipsec',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(value,placeholder,type='text'){const i=this.el('input');i.className='form-input';i.type=type;i.value=value||'';i.placeholder=placeholder||'';return i;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:30000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('ipsec-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#ipsec-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading IPsec…','page-loading'));
		try{
			const cfg=await this.core.uciGet('ipsec').catch(()=>[1,{values:{}}]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.installed=await this.exec('/usr/sbin/ipsec',['version']).then(()=>true).catch(()=>false);
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read IPsec: '+e.message,'page-error'));}
	}
	async installStrongswan(btn){
		if(!confirm('Install strongSwan (IPsec daemon) now? This downloads packages from the OpenWrt repository.'))return;
		btn.disabled=true;btn.textContent='INSTALLING…';
		try{
			await this.exec('/usr/libexec/moci-pkg-call',['install-general','strongswan-default','strongswan-mod-openssl','swanctl']);
			this.core.showToast('strongSwan installed','success');await this.show();
		}catch(e){this.core.showToast('Install failed: '+e.message,'error');btn.disabled=false;btn.textContent='INSTALL STRONGSWAN';}
	}
	connections(){return Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='connection');}
	render(){
		const root=this.root;root.replaceChildren();
		if(!this.installed){
			const card=this.el('div',undefined,'stat-card');
			card.append(this.el('div','IPsec requires strongSwan','section-title'),
				this.el('p','The strongSwan daemon is not installed. It is offered on demand (rather than baked into the image) because its kernel plugins need crypto options the default x86 kernel config hides. Install it below, or from System → Packages.','page-note'));
			const btn=this.el('button','INSTALL STRONGSWAN','action-btn');btn.type='button';
			btn.addEventListener('click',()=>this.installStrongswan(btn));
			card.append(btn);root.append(card);
			return;
		}
		root.append(this.el('p','IKEv2 site-to-site tunnels to another router or firewall (strongSwan). This hardware encrypts in software — expect reduced throughput versus WireGuard. Pre-shared-key auth is supported here; certificate auth can be configured in Advanced Config.','dmz-warning'));
		const bar=this.el('div',undefined,'page-toolbar');
		const add=this.el('button','ADD TUNNEL','action-btn');add.type='button';add.addEventListener('click',()=>this.addTunnel());bar.append(add);
		root.append(bar);
		const conns=this.connections();
		if(!conns.length){root.append(this.el('div','No IPsec tunnels yet. Add a site-to-site tunnel.','addon-empty'));}
		else{
			const list=this.el('div',undefined,'wifi-net-list');
			for(const [id,v] of conns){
				const card=this.el('div',undefined,'stat-card');
				const info=this.el('div',undefined,'wifi-net-info');
				info.append(this.el('strong',id,'dev-name'),
					this.el('span',(v.keyexchange||'ikev2')+'  ·  '+(v.leftsubnet||'local')+' ↔ '+(v.rightsubnet||'remote')+'  ·  peer '+(v.right||'?'),'dev-mono wifi-net-meta'));
				const actions=this.el('div',undefined,'dev-res-actions');
				actions.append(this.el('span',v.auto==='start'?'Auto-start':'Manual','dev-badge '+(v.auto==='start'?'static':'dynamic')));
				const del=this.el('button','Remove','dev-action danger');del.type='button';del.addEventListener('click',()=>this.remove(id));
				actions.append(del);card.append(info,actions);list.append(card);
			}
			root.append(list);
		}
		root.append(this.el('h3','Runtime status'));
		const box=this.el('pre',undefined,'page-note');box.style.whiteSpace='pre-wrap';box.textContent='Loading status…';root.append(box);
		this.exec('/usr/sbin/ipsec',['statusall']).then(r=>{box.textContent=String(r.stdout||r.stderr||'No active SAs.');}).catch(()=>{box.textContent='Status unavailable (IPsec service may be off).';});
	}
	async reload(){await this.core.uciCommit('ipsec');await this.core.serviceReload('ipsec');}
	async remove(id){
		if(!confirm('Remove IPsec tunnel "'+id+'"?'))return;
		try{await this.core.uciDelete('ipsec',id);await this.reload();this.core.showToast('Removed','success');await this.show();}
		catch(e){this.core.showToast('Failed: '+e.message,'error');}
	}
	addTunnel(){
		const ov=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
		const dismiss=()=>ov.remove();
		const head=this.el('div',undefined,'dev-modal-head');
		const close=this.el('button','Close','dev-action');close.type='button';close.addEventListener('click',dismiss);
		head.append(this.el('h3','Add IPsec tunnel'),close);
		const body=this.el('div',undefined,'dev-modal-body');
		const name=this.input('','site1');
		const right=this.input('','198.51.100.1');
		const leftsubnet=this.input('','192.168.68.0/24');
		const rightsubnet=this.input('','10.0.0.0/24');
		const psk=this.input('','pre-shared key','password');
		const ike=this.input('aes256gcm16-prfsha384-ecp384','aes256gcm16-prfsha384-ecp384');
		const esp=this.input('aes256gcm16-ecp384','aes256gcm16-ecp384');
		body.append(this.el('p','IKEv2 with a pre-shared key. Local address uses the WAN default route. Proposals use AES-GCM (software-friendly).','page-note'),
			this.field('Tunnel name',name),this.field('Remote gateway',right),this.field('Local subnet',leftsubnet),this.field('Remote subnet',rightsubnet),
			this.field('Pre-shared key',psk),this.field('IKE proposal',ike),this.field('ESP proposal',esp));
		const foot=this.el('div',undefined,'dev-modal-foot');
		const save=this.el('button','CREATE','action-btn');save.type='button';foot.append(save);
		card.append(head,body,foot);ov.append(card);document.body.append(ov);
		ov.addEventListener('click',e=>{if(e.target===ov)dismiss();});
		save.addEventListener('click',async()=>{
			const nm=name.value.trim().replace(/[^a-zA-Z0-9_-]/g,'');
			if(!nm||!right.value.trim()||!psk.value){this.core.showToast('Name, remote gateway and PSK are required','error');return;}
			save.disabled=true;
			try{
				await this.core.uciAdd('ipsec','connection',nm);
				await this.core.uciSet('ipsec',nm,{type:'tunnel',keyexchange:'ikev2',authby:'psk',left:'%defaultroute',leftsubnet:leftsubnet.value.trim(),right:right.value.trim(),rightsubnet:rightsubnet.value.trim(),ike:ike.value.trim(),esp:esp.value.trim(),auto:'start'});
				const secrets=await this.core.ubusCall('file','read',{path:'/etc/ipsec.secrets'},{timeout:15000}).catch(()=>[1,{data:''}]);
				let txt=(secrets[0]===0&&secrets[1]?.data)||'';
				txt=txt.split('\n').filter(l=>!l.includes('# moci-ipsec-'+nm)).join('\n');
				txt+=`\n%any ${right.value.trim()} : PSK "${psk.value}" # moci-ipsec-${nm}\n`;
				await this.core.ubusCall('file','write',{path:'/etc/ipsec.secrets',data:txt},{timeout:15000});
				await this.reload();this.core.showToast('Tunnel created','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Create failed: '+e.message,'error');save.disabled=false;}
		});
	}
}