// vnStat — long-term traffic history from the vnstat daemon (--json). Shows
// per-interface totals plus daily and monthly breakdowns. Off by default.
export default class VnstatModule{
	constructor(core){this.core=core;this.core.registerRoute('/vnstat',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('vnstat-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#vnstat-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading traffic history…','page-loading'));
		try{
			const r=await this.exec('/usr/bin/vnstat',['--json']);
			if(r.code!==0)throw new Error(String(r.stderr||'vnstat is not running. Enable it in Features.'));
			this.data=JSON.parse(r.stdout||'{}');
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read vnStat: '+e.message,'page-error'));}
	}
	fb(b){return this.core.formatBytes(Number(b)||0);}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		const bar=this.el('div',undefined,'page-toolbar');
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';refresh.addEventListener('click',()=>this.show());bar.append(refresh);
		root.append(bar);
		root.append(this.el('p','Cumulative traffic accounting per interface (vnStat). Data persists across reboots once the daemon has collected it.','page-note'));
		const ifaces=this.data.interfaces||[];
		if(!ifaces.length){root.append(this.el('div','No interfaces tracked yet. Enable vnStat in Features and give it time to collect traffic.','addon-empty'));return;}
		for(const iface of ifaces){
			const card=this.el('div',undefined,'stat-card');card.style.marginBottom='16px';
			const total=iface.total||{};
			card.append(this.el('div',iface.name,'section-title'));
			const sum=this.el('div',undefined,'dev-summary');
			const stat=(n,l)=>{const c=this.el('div',undefined,'dev-stat stat-card');c.append(this.el('strong',n,'dev-stat-n'),this.el('span',l,'dev-stat-l'));return c;};
			sum.append(stat(this.fb(total.rx),'Downloaded'),stat(this.fb(total.tx),'Uploaded'),stat(this.fb((Number(total.rx)||0)+(Number(total.tx)||0)),'Total'));
			card.append(sum);
			const days=(iface.days||[]).slice(-7).reverse();
			if(days.length){
				const t=this.el('table',undefined,'data-table');
				const rows=days.map(d=>{const dt=d.date||{};return `<tr><td>${esc(dt.year+'-'+String(dt.month).padStart(2,'0')+'-'+String(dt.day).padStart(2,'0'))}</td><td>${esc(this.fb(d.rx))}</td><td>${esc(this.fb(d.tx))}</td></tr>`;}).join('');
				t.innerHTML='<thead><tr><th>Day</th><th>Download</th><th>Upload</th></tr></thead><tbody>'+rows+'</tbody>';
				card.append(this.el('h3','Last 7 days'),t);
			}
			const months=(iface.months||[]).slice(-6).reverse();
			if(months.length){
				const t=this.el('table',undefined,'data-table');
				const rows=months.map(m=>{const dt=m.date||{};return `<tr><td>${esc(dt.year+'-'+String(dt.month).padStart(2,'0'))}</td><td>${esc(this.fb(m.rx))}</td><td>${esc(this.fb(m.tx))}</td></tr>`;}).join('');
				t.innerHTML='<thead><tr><th>Month</th><th>Download</th><th>Upload</th></tr></thead><tbody>'+rows+'</tbody>';
				card.append(this.el('h3','Recent months'),t);
			}
			root.append(card);
		}
	}
}