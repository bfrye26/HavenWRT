// IDS/IPS — snort3, opt-in and off by default. Passive IDS (alerts only) is the
// safe default; inline IPS is offered behind an extra confirmation because it
// caps throughput on this CPU (J4125, no AES-NI: ~150-400 Mbps) and requires
// disabling flow offload for inspected traffic (offloaded flows bypass snort).
// snort3 is install-on-demand; detailed rules live in Advanced Config.
export default class IdsModule{
	constructor(core){this.core=core;this.core.registerRoute('/ids',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:60000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('ids-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#ids-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading IDS/IPS…','page-loading'));
		try{
			this.installed=await this.exec('/usr/bin/snort3',['-V']).then(()=>true).catch(()=>false);
			const fw=await this.core.uciGet('firewall').catch(()=>[1,{values:{}}]);
			const fwc=(fw[0]===0&&fw[1]?.values)?fw[1].values:{};
			const def=Object.entries(fwc).find(([,v])=>v?.['.type']==='defaults');
			this.offload=def?def[1].flow_offloading==='1':false;
			this.defSection=def?def[0]:null;
			const sn=await this.core.uciGet('snort3').catch(()=>[1,{values:{}}]);
			this.snort=(sn[0]===0&&sn[1]?.values)?sn[1].values:{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read IDS/IPS: '+e.message,'page-error'));}
	}
	render(){
		const root=this.root;root.replaceChildren();
		root.append(this.el('p','Intrusion detection/prevention with snort3. Passive IDS watches a copy of traffic and alerts only (safe). Inline IPS sits in the forwarding path and can block, but on this hardware it limits throughput to roughly 150–400 Mbps and requires disabling flow offload for inspected traffic.','dmz-warning'));
		if(!this.installed){
			const card=this.el('div',undefined,'stat-card');
			card.append(this.el('div','snort3 not installed','section-title'),
				this.el('p','snort3 is offered on demand. Install it to enable intrusion detection. Rulesets are configured in Advanced Config after install.','page-note'));
			const btn=this.el('button','INSTALL SNORT3','action-btn');btn.type='button';
			btn.addEventListener('click',()=>this.install(btn));
			card.append(btn);root.append(card);return;
		}
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Inspection mode','section-title'));
		const mode=this.el('select');mode.className='form-input';
		for(const [v,l] of [['ids','Passive IDS (alerts only — recommended)'],['ips','Inline IPS (blocks; reduces throughput)']]){const o=this.el('option',l);o.value=v;mode.append(o);}
		const iface=this.el('input');iface.className='form-input';iface.value='br-lan';iface.placeholder='br-lan';
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='12px';
		form.append(this.field('Mode',mode),this.field('Interface',iface,'Passive IDS monitors this interface; inline IPS bridges it.'));
		card.append(form);
		const offnote=this.el('p',this.offload?'Flow offload is ON — offloaded flows bypass inspection. Inline IPS will turn it off.':'Flow offload is OFF.','page-note');
		card.append(offnote);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const enable=this.el('button','ENABLE','action-btn');enable.type='button';
		enable.addEventListener('click',()=>this.enable(mode.value,iface.value.trim()));
		const disable=this.el('button','DISABLE','action-btn danger');disable.type='button';
		disable.addEventListener('click',()=>this.disable());
		actions.append(enable,disable);card.append(actions);root.append(card);
	}
	async install(btn){
		if(!confirm('Install snort3? This downloads packages from the OpenWrt repository.'))return;
		btn.disabled=true;btn.textContent='INSTALLING…';
		try{await this.exec('/usr/libexec/moci-pkg-call',['install-general','snort3']);this.core.showToast('snort3 installed','success');await this.show();}
		catch(e){this.core.showToast('Install failed: '+e.message,'error');btn.disabled=false;btn.textContent='INSTALL SNORT3';}
	}
	async enable(mode,iface){
		if(mode==='ips'){
			if(!confirm('Inline IPS limits throughput to ~150–400 Mbps on this hardware and disables flow offload for inspected traffic. A snort failure could interrupt forwarding. Continue?'))return;
			try{
				if(this.defSection&&this.offload){
					await this.core.uciSet('firewall',this.defSection,{flow_offloading:'0'});
					await this.core.uciApplyConfig('firewall');
				}
			}catch(e){this.core.showToast('Could not disable offload: '+e.message,'error');return;}
		}
		try{
			const sec=Object.entries(this.snort).find(([,v])=>v?.['.type']==='snort3');
			const section=sec?sec[0]:null;
			if(!section)await this.core.uciAdd('snort3','snort3');
			await this.core.uciSet('snort3',section||'@snort3[0]',{mode,interface:iface||'br-lan',enabled:'1'});
			await this.core.uciCommit('snort3');
			await this.exec('/etc/init.d/snort3',['enable']);
			await this.exec('/etc/init.d/snort3',['start']);
			this.core.showToast(mode==='ips'?'Inline IPS enabled':'Passive IDS enabled','success');await this.show();
		}catch(e){this.core.showToast('Enable failed: '+e.message,'error');}
	}
	async disable(){
		try{
			await this.exec('/etc/init.d/snort3',['stop']);
			await this.exec('/etc/init.d/snort3',['disable']);
			const sec=Object.entries(this.snort).find(([,v])=>v?.['.type']==='snort3');
			if(sec){await this.core.uciSet('snort3',sec[0],{enabled:'0'});await this.core.uciCommit('snort3');}
			this.core.showToast('IDS/IPS disabled','success');await this.show();
		}catch(e){this.core.showToast('Disable failed: '+e.message,'error');}
	}
}