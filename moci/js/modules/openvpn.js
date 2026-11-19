// OpenVPN — native client import (.ovpn) and server creation (openssl PKI via the
// moci-openvpn helper, EC DH to avoid slow dhparam). Mirrors vpn-policies.js for
// the server firewall zone + WAN ingress. Software crypto on J4125 (no AES-NI).
export default class OpenvpnModule{
	constructor(core){this.core=core;this.busy=false;this.core.registerRoute('/openvpn',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(value,placeholder,type='text'){const i=this.el('input');i.className='form-input';i.type=type;i.value=value||'';i.placeholder=placeholder||'';return i;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:60000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('openvpn-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#openvpn-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading OpenVPN…','page-loading'));
		try{
			const cfg=await this.core.uciGet('openvpn').catch(()=>[1,{values:{}}]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read OpenVPN: '+e.message,'page-error'));}
	}
	instances(){return Object.entries(this.cfg).filter(([,v])=>v?.['.type']==='openvpn');}
	render(){
		const root=this.root;root.replaceChildren();
		root.append(this.el('p','Run OpenVPN clients (route traffic through a VPN provider) or a server (reach your network remotely). OpenVPN uses software encryption on this hardware — expect lower throughput than WireGuard.','dmz-warning'));
		const bar=this.el('div',undefined,'page-toolbar');
		const imp=this.el('button','IMPORT CLIENT (.ovpn)','action-btn');imp.type='button';imp.addEventListener('click',()=>this.importClient());bar.append(imp);
		const srv=this.el('button','CREATE SERVER','action-btn');srv.type='button';srv.addEventListener('click',()=>this.createServer());bar.append(srv);
		root.append(bar);
		const inst=this.instances();
		if(!inst.length){root.append(this.el('div','No OpenVPN instances yet. Import a client profile or create a server.','addon-empty'));return;}
		const list=this.el('div',undefined,'wifi-net-list');
		for(const [id,v] of inst){
			const isServer=!!v.server;
			const card=this.el('div',undefined,'stat-card');
			const info=this.el('div',undefined,'wifi-net-info');
			info.append(this.el('strong',id,'dev-name'),
				this.el('span',(isServer?'Server':'Client')+'  ·  '+(v.proto||'udp')+'  ·  '+(isServer?('port '+v.port):((v.config||'').split('/').pop()||'inline')),'dev-mono wifi-net-meta'));
			const actions=this.el('div',undefined,'dev-res-actions');
			const enabled=v.enabled!=='0';
			actions.append(this.el('span',enabled?'Enabled':'Disabled','dev-badge '+(enabled?'static':'dynamic')));
			const toggle=this.el('button',enabled?'Disable':'Enable','dev-action');toggle.type='button';toggle.addEventListener('click',()=>this.toggle(id,v));
			const del=this.el('button','Remove','dev-action danger');del.type='button';del.addEventListener('click',()=>this.remove(id));
			actions.append(toggle,del);card.append(info,actions);list.append(card);
		}
		root.append(list);
	}
	async reload(){await this.core.uciCommit('openvpn');await this.core.serviceReload('openvpn');}
	async toggle(id,v){
		try{await this.core.uciSet('openvpn',id,{enabled:v.enabled==='0'?'1':'0'});await this.reload();this.core.showToast('Updated','success');await this.show();}
		catch(e){this.core.showToast('Failed: '+e.message,'error');}
	}
	async remove(id){
		if(!confirm('Remove OpenVPN instance "'+id+'"?'))return;
		try{await this.core.uciDelete('openvpn',id);await this.reload();this.core.showToast('Removed','success');await this.show();}
		catch(e){this.core.showToast('Failed: '+e.message,'error');}
	}
	importClient(){
		const ov=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
		const dismiss=()=>ov.remove();
		const head=this.el('div',undefined,'dev-modal-head');
		const close=this.el('button','Close','dev-action');close.type='button';close.addEventListener('click',dismiss);
		head.append(this.el('h3','Import OpenVPN client'),close);
		const body=this.el('div',undefined,'dev-modal-body');
		const name=this.input('','provider');
		const file=this.el('input');file.type='file';file.accept='.ovpn,.conf';file.className='form-input';
		body.append(this.el('p','Upload a .ovpn profile from your VPN provider. Inline certificates are supported; external file references must be embedded.','page-note'),
			this.field('Instance name',name),this.field('Profile file',file));
		const foot=this.el('div',undefined,'dev-modal-foot');
		const save=this.el('button','IMPORT','action-btn');save.type='button';foot.append(save);
		card.append(head,body,foot);ov.append(card);document.body.append(ov);
		ov.addEventListener('click',e=>{if(e.target===ov)dismiss();});
		save.addEventListener('click',async()=>{
			const nm=name.value.trim().replace(/[^a-zA-Z0-9_-]/g,'');const f=file.files?.[0];
			if(!nm||!f){this.core.showToast('Name and .ovpn file required','error');return;}
			save.disabled=true;
			try{
				const text=await f.text();
				const path='/etc/openvpn/moci_'+nm+'.ovpn';
				await this.core.ubusCall('file','write',{path,data:text},{timeout:30000});
				const sec='moci_'+nm;
				await this.core.uciAdd('openvpn','openvpn',sec);
				await this.core.uciSet('openvpn',sec,{enabled:'1',config:path});
				await this.reload();this.core.showToast('Client imported','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Import failed: '+e.message,'error');save.disabled=false;}
		});
	}
	createServer(){
		const ov=this.el('div',undefined,'dev-modal-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
		const dismiss=()=>ov.remove();
		const head=this.el('div',undefined,'dev-modal-head');
		const close=this.el('button','Close','dev-action');close.type='button';close.addEventListener('click',dismiss);
		head.append(this.el('h3','Create OpenVPN server'),close);
		const body=this.el('div',undefined,'dev-modal-body');
		const name=this.input('','server');
		const port=this.input('1194','1194','number');
		const subnet=this.input('10.8.0.0 255.255.255.0','10.8.0.0 255.255.255.0');
		const internet=this.el('input');internet.type='checkbox';internet.checked=true;
		const internetLabel=this.el('label',undefined,'profiles-check');internetLabel.append(internet,this.el('span','Route client traffic to the internet'));
		body.append(this.el('p','Generates a CA and server certificate (openssl), opens the WAN port, and creates an isolated VPN zone. Clients need a certificate signed by this CA.','page-note'),
			this.field('Server name',name),this.field('UDP port',port),this.field('VPN subnet',subnet),internetLabel);
		const foot=this.el('div',undefined,'dev-modal-foot');
		const save=this.el('button','CREATE','action-btn');save.type='button';foot.append(save);
		card.append(head,body,foot);ov.append(card);document.body.append(ov);
		ov.addEventListener('click',e=>{if(e.target===ov)dismiss();});
		save.addEventListener('click',async()=>{
			const nm=name.value.trim().replace(/[^a-zA-Z0-9_-]/g,'');
			if(!nm){this.core.showToast('Server name required','error');return;}
			save.disabled=true;save.textContent='GENERATING PKI…';
			try{
				const gen=await this.exec('/usr/libexec/moci-openvpn',['gen-server',nm]);
				let info={};try{info=JSON.parse(gen.stdout||'{}');}catch{}
				if(!info.ok)throw new Error(info.error||'PKI generation failed');
				const sec='moci_'+nm;const zone='moci_ovpnzone_'+nm;const zname='moci_vpn_'+nm;
				await this.core.uciAdd('openvpn','openvpn',sec);
				await this.core.uciSet('openvpn',sec,{enabled:'1',dev:'tun',proto:'udp',port:port.value||'1194',
					ca:info.ca,cert:info.cert,key:info.key,ecdh_curve:'prime256v1',server:subnet.value||'10.8.0.0 255.255.255.0',
					keepalive:'10 120',persist_key:'1',persist_tun:'1',cipher:'AES-256-GCM',data_ciphers:'AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305',client_to_client:'1',verb:'3'});
				await this.core.uciAdd('firewall','zone',zone);
				await this.core.uciSet('firewall',zone,{name:zname,input:'REJECT',output:'ACCEPT',forward:'REJECT',masq:'1',mtu_fix:'1',device:'tun+'});
				await this.core.uciAdd('firewall','rule','moci_ovpnport_'+nm);
				await this.core.uciSet('firewall','moci_ovpnport_'+nm,{name:'Haven OpenVPN '+nm,src:'wan',proto:'udp',dest_port:port.value||'1194',target:'ACCEPT'});
				if(internet.checked){
					await this.core.uciAdd('firewall','forwarding','moci_ovpninet_'+nm);
					await this.core.uciSet('firewall','moci_ovpninet_'+nm,{src:zname,dest:'wan'});
				}
				await this.core.uciCommit('openvpn');
				await this.core.uciApplyConfig('firewall');
				await this.core.serviceReload('openvpn');
				this.core.showToast('Server created','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Create failed: '+e.message,'error');save.disabled=false;save.textContent='CREATE';}
		});
	}
}