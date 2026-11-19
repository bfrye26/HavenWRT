// Captive portal — openNDS (nftables/firewall4-native). Manages the splash gateway
// on a chosen bridge interface: enable, login mode, session timeout, walled garden,
// and a live client list via ndsctl. The package installs a firewall include hook.
export default class PortalModule{
	constructor(core){this.core=core;this.core.registerRoute('/portal',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('portal-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#portal-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading captive portal…','page-loading'));
		try{
			const [cfg,net]=await Promise.all([
				this.core.uciGet('opennds').catch(()=>[1,{values:{}}]),
				this.core.uciGet('network').catch(()=>[1,{values:{}}])
			]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.network=(net[0]===0&&net[1]?.values)?net[1].values:{};
			this.setup=Object.entries(this.cfg).find(([,v])=>v?.['.type']==='opennds');
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read captive portal: '+e.message,'page-error'));}
	}
	setupVals(){return this.setup?this.setup[1]:{};}
	enabled(){const v=this.setupVals();return v.enabled==='1'&&v.auto_run==='1';}
	bridges(){return Object.entries(this.network).filter(([,v])=>v?.['.type']==='interface'&&v.ipaddr).map(([k])=>k);}
	render(){
		const root=this.root;root.replaceChildren();
		const v=this.setupVals();
		root.append(this.el('p','A captive portal shows a splash page before devices on the chosen network can reach the internet. Use it for guest networks. openNDS integrates with firewall4/nftables.','dmz-warning'));
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Captive portal','section-title'));
		const row=this.el('div',undefined,'dmz-status');
		const bw=this.el('div');bw.innerHTML=this.core.renderBadge(this.enabled()?'success':'neutral',this.enabled()?'ACTIVE':'OFF');row.append(bw);
		row.append(this.el('span',this.enabled()?'Portal is gating '+(v.gatewayinterface||'the configured interface')+'.':'Portal is off.','dmz-status-text'));
		card.append(row);
		// Settings form
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='14px';
		const iface=this.el('select');iface.className='form-input';
		for(const b of this.bridges()){const o=this.el('option',b);o.value=b;iface.append(o);}
		iface.value=v.gatewayinterface||'br-lan';
		const mode=this.el('select');mode.className='form-input';
		for(const [val,l] of [['1','Click to continue'],['2','Name / email login'],['3','Custom theme']]){const o=this.el('option',l);o.value=val;mode.append(o);}
		mode.value=v.login_option_enabled||'1';
		const timeout=this.el('input');timeout.className='form-input';timeout.type='number';timeout.value=v.sessiontimeout||'1440';
		const port=this.el('input');port.className='form-input';port.type='number';port.value=v.gatewayport||'2050';
		form.append(this.field('Gateway interface',iface,'The bridge whose clients see the splash page.'),
			this.field('Login mode',mode),this.field('Session timeout (minutes)',timeout),this.field('Gateway port',port,'Port 80 is reserved; default 2050.'));
		card.append(form);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const save=this.el('button','SAVE SETTINGS','action-btn');save.type='button';
		save.addEventListener('click',()=>this.saveSettings(iface.value,mode.value,timeout.value,port.value));
		const toggle=this.el('button',this.enabled()?'TURN OFF':'TURN ON','action-btn'+(this.enabled()?' danger':''));toggle.type='button';
		toggle.addEventListener('click',()=>this.toggle(iface.value));
		actions.append(save,toggle);card.append(actions);root.append(card);
		// Clients
		root.append(this.el('h3','Connected clients'));
		const box=this.el('pre',undefined,'page-note');box.style.whiteSpace='pre-wrap';box.textContent='Loading clients…';root.append(box);
		this.exec('/usr/bin/ndsctl',['status']).then(r=>{box.textContent=String(r.stdout||r.stderr||'No clients (portal may be off).');}).catch(()=>{box.textContent='Client list unavailable (portal off or ndsctl not present).';});
	}
	async saveSettings(iface,mode,timeout,port){
		try{
			const sec=this.setup?this.setup[0]:null;
			if(!sec){await this.core.uciAdd('opennds','opennds','setup');}
			const section=sec||'setup';
			await this.core.uciSet('opennds',section,{gatewayinterface:iface,login_option_enabled:mode,sessiontimeout:timeout,gatewayport:port,fwhook_enabled:'1'});
			await this.core.uciCommit('opennds');
			this.core.showToast('Portal settings saved','success');await this.show();
		}catch(e){this.core.showToast('Save failed: '+e.message,'error');}
	}
	async toggle(iface){
		const enable=!this.enabled();
		if(enable&&!confirm('Turn on the captive portal on '+iface+'? Devices on that network will see a splash page before reaching the internet.'))return;
		try{
			const sec=this.setup?this.setup[0]:null;
			if(!sec)await this.core.uciAdd('opennds','opennds','setup');
			const section=sec||'setup';
			await this.core.uciSet('opennds',section,{enabled:enable?'1':'0',auto_run:enable?'1':'0',gatewayinterface:iface,fwhook_enabled:'1'});
			await this.core.uciCommit('opennds');
			await this.exec('/etc/init.d/opennds',[enable?'enable':'disable']);
			await this.exec('/etc/init.d/opennds',[enable?'start':'stop']);
			this.core.showToast(enable?'Portal enabled':'Portal disabled','success');await this.show();
		}catch(e){this.core.showToast('Could not change portal: '+e.message,'error');}
	}
}