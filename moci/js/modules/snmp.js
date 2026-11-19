// SNMP — native snmpd setup (v2c community + optional v3 user). Uses the snmpd
// UCI shortcut sections. Off by default; warns about the stock public community.
export default class SnmpModule{
	constructor(core){this.core=core;this.core.registerRoute('/snmp',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(value,placeholder,type='text'){const i=this.el('input');i.className='form-input';i.type=type;i.value=value||'';i.placeholder=placeholder||'';return i;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async show(){
		this.page=document.getElementById('snmp-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#snmp-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading SNMP…','page-loading'));
		try{
			const cfg=await this.core.uciGet('snmpd').catch(()=>[1,{values:{}}]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read SNMP: '+e.message,'page-error'));}
	}
	sec(type){return Object.entries(this.cfg).find(([,v])=>v?.['.type']===type);}
	render(){
		const root=this.root;root.replaceChildren();
		const general=this.sec('general')?.[1]||{};
		const enabled=general.enabled==='1';
		root.append(this.el('p','Expose router metrics to an SNMP manager (v2c community or v3 user). Off by default. Restrict the source to your management network — the stock "public" community is read-only but widely known.','dmz-warning'));
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','SNMP agent','section-title'));
		const row=this.el('div',undefined,'dmz-status');
		const bw=this.el('div');bw.innerHTML=this.core.renderBadge(enabled?'success':'neutral',enabled?'ENABLED':'OFF');row.append(bw);
		card.append(row);
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='14px';
		const community=this.input(this.sec('access_default')?.[1]?.CommunityName||'','public');
		const source=this.input(this.sec('access_default')?.[1]?.IPMask||'','192.168.68.0/24');
		const mode=this.el('select');mode.className='form-input';
		for(const [v,l] of [['ro','Read-only'],['rw','Read-write']]){const o=this.el('option',l);o.value=v;mode.append(o);}
		mode.value=this.sec('access_default')?.[1]?.Mode||'ro';
		form.append(this.field('v2c community',community),this.field('Allowed source (IP/CIDR)',source,'Leave empty to allow any source (not recommended).'),this.field('Access mode',mode));
		card.append(form);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const save=this.el('button','SAVE & ENABLE','action-btn');save.type='button';
		save.addEventListener('click',()=>this.save(community.value,source.value,mode.value,true));
		const off=this.el('button','DISABLE','action-btn danger');off.type='button';
		off.addEventListener('click',()=>this.save(community.value,source.value,mode.value,false));
		actions.append(save,off);card.append(actions);root.append(card);
	}
	async save(community,source,mode,enable){
		if(enable&&!community.trim()){this.core.showToast('Enter a community string','error');return;}
		try{
			const gsec=this.sec('general')?.[0];
			if(!gsec)await this.core.uciAdd('snmpd','general','general');
			await this.core.uciSet('snmpd',gsec||'general',{enabled:enable?'1':'0',network:['lan']});
			if(enable){
				const asec=this.sec('access_default')?.[0];
				if(!asec)await this.core.uciAdd('snmpd','access_default','default');
				await this.core.uciSet('snmpd',asec||'default',{Mode:mode,CommunityName:community.trim(),IPMask:source.trim()||'default',RestrictOID:'.1'});
			}
			await this.core.uciCommit('snmpd');
			await this.core.serviceReload('snmpd');
			this.core.showToast(enable?'SNMP enabled':'SNMP disabled','success');await this.show();
		}catch(e){this.core.showToast('Save failed: '+e.message,'error');}
	}
}