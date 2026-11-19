// WAN / Internet connection page. Supports DHCP, static and PPPoE uplinks with a
// live status readout. Changes are staged and protected by UCI timed rollback.
const IPV4=/^(\d{1,3}\.){3}\d{1,3}$/;
function validIP(v){return IPV4.test(v)&&v.split('.').every(n=>Number(n)<=255);}
export default class WanModule{
	constructor(core){
		this.core=core;this.busy=false;
		this.core.registerRoute('/wan',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async rpc(object,method,args={}){const [s,r]=await this.core.ubusCall(object,method,args,{timeout:30000});if(s!==0)throw new Error(object+'.'+method+' failed ('+s+')');return r||{};}
	async uci(method,args){return this.rpc('uci',method,args);}
	async show(){
		this.page=document.getElementById('wan-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#wan-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading the Internet uplink…','page-loading'));
		try{
			const [dump,net]=await Promise.all([
				this.rpc('network.interface','dump').catch(()=>({interface:[]})),
				this.uci('get',{config:'network'})
			]);
			const ifaces=Array.isArray(dump.interface)?dump.interface:[];
			this.status=ifaces.find(i=>i.interface==='wan')||{};
			this.status6=ifaces.find(i=>i.interface==='wan6')||{};
			this.network=net.values||{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read the WAN interface: '+e.message,'page-error'));}
	}
	field(label,input,hint){
		const wrap=this.el('label',undefined,'wan-field');
		wrap.append(this.el('span',label,'wan-field-label'),input);
		if(hint)wrap.append(this.el('small',hint,'wan-field-hint'));
		return wrap;
	}
	input(id,value,placeholder,type='text'){
		const i=this.el('input');i.id=id;i.type=type;i.value=value||'';i.placeholder=placeholder||'';i.className='form-input';i.autocomplete='off';
		return i;
	}
	render(){
		const root=this.root;root.replaceChildren();
		const wan=this.network.wan||{};
		const proto=wan.proto||'dhcp';
		const up=!!this.status.up;
		const ipv4=(this.status['ipv4-address']||[])[0];
		const route=(this.status.route||[]).find(r=>r.target==='0.0.0.0');
		const dns=(this.status['dns-server']||[]).join(', ');

		// Status card
		const status=this.el('section',undefined,'wan-status stat-card');
		const dot=this.el('span',undefined,'wan-dot '+(up?'up':'down'));
		const head=this.el('div',undefined,'wan-status-head');
		head.append(dot,this.el('div',undefined,'wan-status-text'));
		head.lastChild.append(this.el('strong',up?'Internet connected':'Internet disconnected'),this.el('span',up?'Your uplink is active and routing traffic.':'No active uplink. Check the cable and connection settings below.','wan-status-sub'));
		status.append(head);
		const facts=this.el('div',undefined,'wan-facts');
		const fact=(k,v)=>{const f=this.el('div',undefined,'wan-fact');f.append(this.el('span',k,'wan-fact-k'),this.el('span',v||'—','wan-fact-v'));return f;};
		facts.append(
			fact('Connection',({dhcp:'DHCP',static:'Static IP',pppoe:'PPPoE'})[proto]||proto),
			fact('IPv4 address',ipv4?ipv4.address+'/'+ipv4.mask:'—'),
			fact('Gateway',route?route.nexthop:(wan.gateway||'—')),
			fact('DNS',dns||'—')
		);
		status.append(facts);
		root.append(status);

		// Connection form
		const form=this.el('form',undefined,'wan-form stat-card');
		form.append(this.el('h3','Connection type'));
		const typeRow=this.el('div',undefined,'wan-type-row');
		const types=[['dhcp','DHCP','Automatic — most cable / fiber modems'],['static','Static IP','A fixed address from your ISP'],['pppoe','PPPoE','Username & password — many DSL / fiber ISPs']];
		let selected=proto;
		const typeButtons=[];
		for(const [value,title,desc] of types){
			const b=this.el('button',undefined,'wan-type'+(value===selected?' selected':''));
			b.type='button';b.dataset.proto=value;
			b.append(this.el('strong',title),this.el('span',desc));
			b.addEventListener('click',()=>{selected=value;typeButtons.forEach(x=>x.classList.toggle('selected',x.dataset.proto===value));this.renderFields(selected,fields);});
			typeButtons.push(b);typeRow.append(b);
		}
		form.append(typeRow);
		const fields=this.el('div',undefined,'wan-fields');
		form.append(fields);
		this.renderFields(selected,fields,wan);

		const save=this.el('button','SAVE & APPLY','action-btn wan-save');save.type='submit';
		form.append(save);
		form.addEventListener('submit',async e=>{
			e.preventDefault();if(this.busy)return;
			await this.save(selected,fields,save);
		});
		root.append(form);

		this.renderIPv6(root);

		root.append(this.el('p','Changing the connection type briefly interrupts the Internet link. MoCI applies the change with a 60-second safety rollback — if the router becomes unreachable, the previous settings are restored automatically.','page-note'));
	}
	renderIPv6(root){
		const wan6=this.network.wan6||{};
		const st=this.status6||{};
		const exists=!!this.network.wan6;
		const active=exists&&wan6.disabled!=='1';
		const up=!!st.up;
		const v6=(st['ipv6-address']||[])[0];
		const prefix=(st['ipv6-prefix']||[])[0];
		const route6=(st.route||[]).find(r=>r.target==='::');
		const card=this.el('section',undefined,'stat-card');card.style.marginTop='24px';
		card.append(this.el('div','IPv6','section-title'));
		const facts=this.el('div',undefined,'wan-facts');
		const fact=(k,v)=>{const f=this.el('div',undefined,'wan-fact');f.append(this.el('span',k,'wan-fact-k'),this.el('span',v||'—','wan-fact-v'));return f;};
		facts.append(
			fact('Status',active?(up?'Active':'Configured (no address yet)'):'Disabled'),
			fact('IPv6 address',v6?v6.address+'/'+v6.mask:'—'),
			fact('Delegated prefix',prefix?prefix.address+'/'+prefix.mask:'—'),
			fact('Gateway',route6?route6.nexthop:'—')
		);
		card.append(facts);
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='14px';
		const enabled=this.el('select');enabled.className='form-input';
		for(const [v,l] of [['1','Enabled (DHCPv6 / SLAAC)'],['0','Disabled']]){const o=this.el('option',l);o.value=v;enabled.append(o);}
		enabled.value=active?'1':'0';
		const reqaddress=this.el('select');reqaddress.className='form-input';
		for(const [v,l] of [['try','Try to obtain an address'],['force','Force an address'],['no','Do not request an address']]){const o=this.el('option',l);o.value=v;reqaddress.append(o);}
		reqaddress.value=wan6.reqaddress||'try';
		const reqprefix=this.el('select');reqprefix.className='form-input';
		for(const [v,l] of [['auto','Automatic prefix length'],['no','No prefix (address only)'],['48','/48'],['56','/56'],['60','/60'],['64','/64']]){const o=this.el('option',l);o.value=v;reqprefix.append(o);}
		reqprefix.value=wan6.reqprefix||'auto';
		form.append(this.field('IPv6 uplink',enabled,'Uses the same physical link as your IPv4 WAN.'),
			this.field('Address request',reqaddress),this.field('Prefix delegation',reqprefix,'Your ISP delegates a prefix for your LAN via RA/DHCPv6.'));
		card.append(form);
		const save=this.el('button','SAVE IPv6','action-btn');save.type='button';save.style.marginTop='12px';
		save.addEventListener('click',()=>this.saveWan6(enabled.value,reqaddress.value,reqprefix.value,save));
		card.append(save);
		root.append(card);
	}
	async saveWan6(enabled,reqaddress,reqprefix,save){
		if(!window.confirm(enabled==='1'?'Enable IPv6 on the WAN (DHCPv6/SLAAC)?':'Disable the IPv6 WAN interface?'))return;
		save.disabled=true;
		try{
			if(enabled==='1'){
				if(!this.network.wan6)await this.uci('add',{config:'network',type:'interface',name:'wan6'});
				await this.uci('set',{config:'network',section:'wan6',values:{proto:'dhcpv6',device:'@wan',reqaddress,reqprefix,disabled:'0'}});
			}else if(this.network.wan6){
				await this.uci('set',{config:'network',section:'wan6',values:{disabled:'1'}});
			}
			await this.uci('apply',{rollback:true,timeout:60});
			await new Promise(r=>setTimeout(r,2500));
			await this.rpc('system','info');
			if(!window.confirm('The router is still reachable. Keep the IPv6 settings?\nCancel to roll back automatically.'))throw new Error('Change not confirmed; rolling back.');
			await this.uci('confirm',{});
			this.core.showToast('IPv6 settings updated','success');
			await this.show();
		}catch(e){this.core.showToast('IPv6 change not applied: '+e.message,'error');}
		finally{save.disabled=false;}
	}
	renderFields(proto,fields,wan={}){
		fields.replaceChildren();
		if(proto==='static'){
			fields.append(
				this.field('IPv4 address',this.input('wan-ip',wan.ipaddr,'203.0.113.10'),'The public address assigned by your ISP.'),
				this.field('Subnet mask',this.input('wan-mask',wan.netmask||'255.255.255.0','255.255.255.0')),
				this.field('Gateway',this.input('wan-gw',wan.gateway,'203.0.113.1'),'Your ISP’s upstream router.'),
				this.field('DNS servers',this.input('wan-dns',Array.isArray(wan.dns)?wan.dns.join(' '):(wan.dns||''),'1.1.1.1 8.8.8.8'),'Space-separated. Optional — defaults to your ISP’s DNS.')
			);
		}else if(proto==='pppoe'){
			fields.append(
				this.field('Username',this.input('wan-user',wan.username,'you@isp.com')),
				this.field('Password',this.input('wan-pass',wan.password,'','password'),'Stored in the router configuration.')
			);
		}else{
			fields.append(this.el('p','DHCP requests an address automatically from your modem or ISP. No further settings are needed for most connections.','wan-dhcp-note'));
		}
	}
	async save(proto,fields,save){
		const values={proto};
		const get=id=>fields.querySelector('#'+id)?.value.trim()||'';
		if(proto==='static'){
			const ip=get('wan-ip'),mask=get('wan-mask'),gw=get('wan-gw'),dns=get('wan-dns');
			if(!validIP(ip)||!validIP(mask)||!validIP(gw)){this.core.showToast('Enter a valid IPv4 address, mask and gateway','error');return;}
			Object.assign(values,{ipaddr:ip,netmask:mask,gateway:gw});
			if(dns)values.dns=dns.split(/\s+/).filter(validIP);else values.dns='';
		}else if(proto==='pppoe'){
			const user=get('wan-user'),pass=get('wan-pass');
			if(!user){this.core.showToast('PPPoE needs a username','error');return;}
			Object.assign(values,{username:user,password:pass});
		}
		if(!window.confirm('Switch the Internet connection to '+({dhcp:'DHCP',static:'Static IP',pppoe:'PPPoE'})[proto]+'? The link will briefly reconnect.'))return;
		this.busy=true;save.disabled=true;save.textContent='APPLYING…';
		try{
			await this.uci('set',{config:'network',section:'wan',values});
			await this.uci('apply',{rollback:true,timeout:60});
			await new Promise(r=>setTimeout(r,2500));
			await this.rpc('system','info');
			if(!window.confirm('The router is still reachable. Keep the new Internet settings?\nCancel to roll back automatically.')){throw new Error('Change not confirmed; rolling back.');}
			await this.uci('confirm',{});
			this.core.showToast('Internet connection updated','success');
			await this.show();
		}catch(e){this.core.showToast('WAN change not applied: '+e.message,'error');}
		finally{this.busy=false;save.disabled=false;save.textContent='SAVE & APPLY';}
	}
}
