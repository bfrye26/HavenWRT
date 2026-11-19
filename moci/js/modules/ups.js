// UPS — status from Network UPS Tools (upsc). Lists configured UPSes and shows
// charge/runtime/load/voltage. Configure the driver in Advanced Config (nut).
export default class UpsModule{
	constructor(core){this.core=core;this.core.registerRoute('/ups',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:15000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('ups-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#ups-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading UPS status…','page-loading'));
		try{
			const list=await this.exec('/usr/bin/upsc',['-l']);
			this.names=String(list.stdout||'').split('\n').map(s=>s.trim()).filter(Boolean);
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read UPS: '+e.message,'page-error'));}
	}
	async render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		const bar=this.el('div',undefined,'page-toolbar');
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';refresh.addEventListener('click',()=>this.show());bar.append(refresh);
		root.append(bar);
		root.append(this.el('p','Uninterruptible power supply status (Network UPS Tools). Configure the UPS driver under Advanced Config → nut, then its live state appears here.','page-note'));
		if(!this.names.length){root.append(this.el('div','No UPS configured. Add a driver in Advanced Config (nut) — e.g. usbhid-ups for a USB UPS.','addon-empty'));return;}
		for(const name of this.names){
			const card=this.el('div',undefined,'stat-card');card.style.marginBottom='16px';
			card.append(this.el('div',name,'section-title'));
			try{
				const r=await this.exec('/usr/bin/upsc',[name]);
				const kv={};
				for(const line of String(r.stdout||'').split('\n')){const i=line.indexOf(':');if(i>0)kv[line.slice(0,i).trim()]=line.slice(i+1).trim();}
				const status=kv['ups.status']||'';
				const online=status.includes('OL');
				const badge=this.el('div');badge.innerHTML=this.core.renderBadge(online?'success':(status.includes('OB')?'warning':'info'),online?'ON LINE':(status.includes('OB')?'ON BATTERY':status||'UNKNOWN'));
				card.append(badge);
				const facts=this.el('div',undefined,'wan-facts');facts.style.marginTop='12px';
				const fact=(k,v)=>{const f=this.el('div',undefined,'wan-fact');f.append(this.el('span',k,'wan-fact-k'),this.el('span',v||'—','wan-fact-v'));return f;};
				facts.append(
					fact('Model',(kv['ups.mfr']||'')+' '+(kv['ups.model']||'')),
					fact('Battery charge',kv['battery.charge']?kv['battery.charge']+'%':'—'),
					fact('Runtime',kv['battery.runtime']?Math.round(Number(kv['battery.runtime'])/60)+' min':'—'),
					fact('Load',kv['ups.load']?kv['ups.load']+'%':'—'),
					fact('Input voltage',kv['input.voltage']?kv['input.voltage']+' V':'—'),
					fact('Output voltage',kv['output.voltage']?kv['output.voltage']+' V':'—')
				);
				card.append(facts);
			}catch(e){card.append(this.el('p','Could not read this UPS: '+e.message,'page-note'));}
			root.append(card);
		}
	}
}