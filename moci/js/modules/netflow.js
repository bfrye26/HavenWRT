// NetFlow — softflowd flow exporter (NetFlow v5/v9/IPFIX). Sends flow records to a
// collector for traffic analysis. Off by default. (softflowd does not export sFlow.)
export default class NetflowModule{
	constructor(core){this.core=core;this.core.registerRoute('/netflow',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(value,placeholder,type='text'){const i=this.el('input');i.className='form-input';i.type=type;i.value=value||'';i.placeholder=placeholder||'';return i;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async show(){
		this.page=document.getElementById('netflow-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#netflow-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading NetFlow exporter…','page-loading'));
		try{
			const cfg=await this.core.uciGet('softflowd').catch(()=>[1,{values:{}}]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.sec=Object.entries(this.cfg).find(([,v])=>v?.['.type']==='softflowd');
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read NetFlow: '+e.message,'page-error'));}
	}
	render(){
		const root=this.root;root.replaceChildren();
		const v=this.sec?this.sec[1]:{};
		const enabled=v.enabled==='1';
		root.append(this.el('p','Export flow records (NetFlow v5/v9/IPFIX) to a collector such as nfdump, Elastiflow, or ntopng. Off by default.','dmz-warning'));
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Flow exporter','section-title'));
		const row=this.el('div',undefined,'dmz-status');
		const bw=this.el('div');bw.innerHTML=this.core.renderBadge(enabled?'success':'neutral',enabled?'ENABLED':'OFF');row.append(bw);card.append(row);
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='14px';
		const iface=this.input(v.interface||'br-lan','br-lan');
		const collector=this.input(v.host_port||'','192.168.68.10:2055');
		const version=this.el('select');version.className='form-input';
		for(const [val,l] of [['5','NetFlow v5'],['9','NetFlow v9'],['10','IPFIX (v10)']]){const o=this.el('option',l);o.value=val;version.append(o);}
		version.value=v.export_version||'9';
		form.append(this.field('Interface',iface,'The interface whose traffic is exported.'),this.field('Collector host:port',collector),this.field('Export version',version));
		card.append(form);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const save=this.el('button','SAVE & ENABLE','action-btn');save.type='button';
		save.addEventListener('click',()=>this.save(iface.value,collector.value,version.value,true));
		const off=this.el('button','DISABLE','action-btn danger');off.type='button';
		off.addEventListener('click',()=>this.save(iface.value,collector.value,version.value,false));
		actions.append(save,off);card.append(actions);root.append(card);
	}
	async save(iface,collector,version,enable){
		if(enable&&!collector.trim()){this.core.showToast('Enter a collector host:port','error');return;}
		try{
			const sec=this.sec?this.sec[0]:null;
			if(!sec)await this.core.uciAdd('softflowd','softflowd');
			const section=sec||'@softflowd[0]';
			await this.core.uciSet('softflowd',section,{enabled:enable?'1':'0',interface:iface.trim()||'br-lan',host_port:collector.trim(),export_version:version});
			await this.core.uciCommit('softflowd');
			await this.core.serviceReload('softflowd');
			this.core.showToast(enable?'NetFlow exporter enabled':'NetFlow exporter disabled','success');await this.show();
		}catch(e){this.core.showToast('Save failed: '+e.message,'error');}
	}
}