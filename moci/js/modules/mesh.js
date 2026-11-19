// Mesh — 802.11s mesh join, capability-gated. The shipped RT3070/RT5370 USB radio
// (rt2800usb) does NOT support mesh point; this module detects mesh-capable radios
// via `iw phy` and only offers configuration when one is present. batman-adv
// (layer-2 multi-hop) is an optional install-on-demand step.
export default class MeshModule{
	constructor(core){this.core=core;this.core.registerRoute('/mesh',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(value,placeholder,type='text'){const i=this.el('input');i.className='form-input';i.type=type;i.value=value||'';i.placeholder=placeholder||'';return i;}
	field(label,control,hint){const w=this.el('label',undefined,'wan-field');w.append(this.el('span',label,'wan-field-label'),control);if(hint)w.append(this.el('small',hint,'wan-field-hint'));return w;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('mesh-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#mesh-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Detecting mesh-capable radios…','page-loading'));
		try{
			const [iw,wireless]=await Promise.all([
				this.exec('/usr/sbin/iw',['phy']).catch(()=>({stdout:''})),
				this.core.uciGet('wireless').catch(()=>[1,{values:{}}])
			]);
			this.meshPhys=this.detectMeshPhys(String(iw.stdout||''));
			this.wireless=(wireless[0]===0&&wireless[1]?.values)?wireless[1].values:{};
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to detect mesh capability: '+e.message,'page-error'));}
	}
	detectMeshPhys(text){
		// Split `iw phy` output per phy; "mesh point" only appears under a phy's
		// supported interface modes, so its presence in the block means mesh support.
		const phys=[];
		const blocks=text.split(/^Wiphy /m).slice(1);
		for(const b of blocks){
			const name=(b.split('\n')[0]||'').trim();
			if(/mesh point/i.test(b))phys.push(name);
		}
		return phys;
	}
	meshIfaces(){return Object.entries(this.wireless).filter(([,v])=>v?.['.type']==='wifi-iface'&&v.mode==='mesh');}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','802.11s mesh lets radios form a self-healing wireless backbone. Mesh requires a radio that supports "mesh point" mode.','page-note'));
		if(!this.meshPhys.length){
			const card=this.el('div',undefined,'stat-card');
			card.append(this.el('div','No mesh-capable radio','section-title'),
				this.el('p','None of the detected radios support 802.11s mesh point. The commonly shipped RT3070/RT5370 USB adapter (rt2800usb) cannot mesh. To use mesh, attach a mesh-capable adapter — e.g. an MT7612U (mt76) or AR9271 (ath9k) — and its driver will expose mesh point mode.','dmz-warning'));
			root.append(card);
			this.batmanCard(root);
			return;
		}
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Mesh-capable radios: '+this.meshPhys.join(', '),'section-title'));
		const existing=this.meshIfaces();
		if(existing.length){
			const t=this.el('table',undefined,'data-table');
			const rows=existing.map(([id,v])=>`<tr><td class="dev-mono">${esc(id)}</td><td>${esc(v.mesh_id||'')}</td><td>${esc(v.device||'')}</td></tr>`).join('');
			t.innerHTML='<thead><tr><th>Interface</th><th>Mesh ID</th><th>Radio</th></tr></thead><tbody>'+rows+'</tbody>';
			card.append(t);
		}
		const form=this.el('div',undefined,'wan-fields');form.style.marginTop='14px';
		const meshId=this.input('','haven-mesh');
		const key=this.input('','mesh password (SAE, ≥8 chars)','password');
		const radio=this.el('select');radio.className='form-input';
		for(const [id,v] of Object.entries(this.wireless)){if(v?.['.type']==='wifi-device'){const o=this.el('option',id);o.value=id;radio.append(o);}}
		form.append(this.field('Mesh ID (name)',meshId),this.field('SAE password',key),this.field('Radio',radio));
		const join=this.el('button','CREATE MESH INTERFACE','action-btn');join.type='button';join.style.marginTop='12px';
		join.addEventListener('click',()=>this.createMesh(meshId.value.trim(),key.value,radio.value));
		card.append(form,join);root.append(card);
		this.batmanCard(root);
	}
	batmanCard(root){
		const card=this.el('div',undefined,'stat-card');card.style.marginTop='24px';
		card.append(this.el('div','Multi-hop mesh (batman-adv)','section-title'),
			this.el('p','For layer-2 mesh across multiple hops/radii, install batman-adv (optional). It runs on top of the mesh interfaces.','page-note'));
		const btn=this.el('button','INSTALL BATMAN-ADV','action-btn');btn.type='button';
		btn.addEventListener('click',async()=>{
			if(!confirm('Install batman-adv kernel module and batctl?'))return;
			btn.disabled=true;btn.textContent='INSTALLING…';
			try{await this.exec('/usr/libexec/moci-pkg-call',['install-general','kmod-batman-adv','batctl']);this.core.showToast('batman-adv installed','success');}
			catch(e){this.core.showToast('Install failed: '+e.message,'error');}
			finally{btn.disabled=false;btn.textContent='INSTALL BATMAN-ADV';}
		});
		card.append(btn);root.append(card);
	}
	async createMesh(meshId,key,radio){
		if(!meshId){this.core.showToast('Enter a mesh ID','error');return;}
		if(key&&key.length<8){this.core.showToast('SAE password must be ≥8 characters','error');return;}
		if(!confirm('Create a mesh interface on '+radio+'? Wi-Fi will briefly restart.'))return;
		try{
			const r=await this.core.uciAdd('wireless','wifi-iface');
			const sec=r?.section;if(!sec)throw new Error('create failed');
			const values={device:radio,mode:'mesh',mesh_id:meshId,mesh_fwding:'1',network:'lan'};
			if(key){values.encryption='sae';values.key=key;}
			await this.core.uciSet('wireless',sec,values);
			await this.core.uciApplyConfig('wireless');
			this.core.showToast('Mesh interface created','success');await this.show();
		}catch(e){this.core.showToast('Create failed: '+e.message,'error');}
	}
}