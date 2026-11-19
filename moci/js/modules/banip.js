// BanIP threat blocking — native UI over banIP 1.x (nftables-native). Manages the
// global enable, feed selection (from /etc/banip/banip.feeds), the local allowlist,
// and shows runtime status. banIP is not a daemon; the init script applies sets.
export default class BanipModule{
	constructor(core){this.core=core;this.core.registerRoute('/banip',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:30000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async read(path){const [s,r]=await this.core.ubusCall('file','read',{path},{timeout:15000});return (s===0&&r?.data)||'';}
	async show(){
		this.page=document.getElementById('banip-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#banip-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading BanIP settings…','page-loading'));
		try{
			const [cfg,feedsTxt]=await Promise.all([
				this.core.uciGet('banip').catch(()=>[1,{values:{}}]),
				this.read('/etc/banip/banip.feeds').catch(()=>'')
			]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.global=this.cfg.global||{};
			try{this.feeds=JSON.parse(feedsTxt||'{}');}catch{this.feeds={};}
			this.allowlist=await this.read('/etc/banip/banip.allowlist').catch(()=>'');
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read BanIP: '+e.message,'page-error'));}
	}
	enabled(){return this.global.ban_enabled==='1';}
	selectedFeeds(){const f=this.global.ban_feed;return Array.isArray(f)?f:(f?[f]:[]);}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		root.append(this.el('p','Block known malicious IPs at the firewall using curated threat feeds (nftables sets). Off by default; enabling fetches feeds and inserts blocking rules.','dmz-warning'));
		// Enable card
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Threat blocking','section-title'));
		const row=this.el('div',undefined,'dmz-status');
		const bw=this.el('div');bw.innerHTML=this.core.renderBadge(this.enabled()?'success':'neutral',this.enabled()?'ENABLED':'OFF');row.append(bw);
		row.append(this.el('span',this.enabled()?'BanIP is blocking listed IPs.':'BanIP is off.','dmz-status-text'));
		card.append(row);
		const actions=this.el('div',undefined,'action-row');actions.style.marginTop='14px';
		const toggle=this.el('button',this.enabled()?'TURN OFF':'TURN ON','action-btn'+(this.enabled()?' danger':''));toggle.type='button';
		toggle.addEventListener('click',()=>this.toggleBanip());actions.append(toggle);
		const reload=this.el('button','REFRESH FEEDS','action-btn');reload.type='button';reload.addEventListener('click',()=>this.reloadFeeds());actions.append(reload);
		card.append(actions);root.append(card);
		// Feeds
		root.append(this.el('h3','Threat feeds'));
		root.append(this.el('p','Select the feeds to block. Changes apply on the next feed refresh.','page-note'));
		const feedWrap=this.el('div',undefined,'stat-card');feedWrap.style.marginTop='12px';
		const selected=new Set(this.selectedFeeds());
		this.feedChecks=[];
		const names=Object.keys(this.feeds).sort();
		if(!names.length)feedWrap.append(this.el('p','Feed catalogue unavailable.','page-note'));
		for(const name of names){
			const f=this.feeds[name]||{};
			const label=this.el('label',undefined,'profiles-check');
			const cb=this.el('input');cb.type='checkbox';cb.checked=selected.has(name);cb.value=name;
			label.append(cb,this.el('span',`${name} — ${f.descr||''}`));
			feedWrap.append(label);this.feedChecks.push(cb);
		}
		const saveFeeds=this.el('button','SAVE FEEDS','action-btn');saveFeeds.type='button';saveFeeds.style.marginTop='12px';
		saveFeeds.addEventListener('click',()=>this.saveFeeds());
		feedWrap.append(saveFeeds);root.append(feedWrap);
		// Allowlist
		root.append(this.el('h3','Allowlist (never block)'));
		root.append(this.el('p','One IP, CIDR, MAC or domain per line. These are exempt from blocking.','page-note'));
		const alCard=this.el('div',undefined,'stat-card');alCard.style.marginTop='12px';
		const al=this.el('textarea');al.className='form-input';al.rows=6;al.value=this.allowlist||'';al.style.width='100%';al.style.fontFamily='var(--font-mono)';
		const saveAl=this.el('button','SAVE ALLOWLIST','action-btn');saveAl.type='button';saveAl.style.marginTop='12px';
		saveAl.addEventListener('click',()=>this.saveAllowlist(al.value));
		alCard.append(al,saveAl);root.append(alCard);
		// Status
		root.append(this.el('h3','Runtime status'));
		const statusBox=this.el('pre',undefined,'page-note');statusBox.style.whiteSpace='pre-wrap';statusBox.textContent='Loading status…';
		root.append(statusBox);
		this.exec('/etc/init.d/banip',['status']).then(r=>{statusBox.textContent=String(r.stdout||r.stderr||'No runtime information (BanIP may be off).');}).catch(()=>{statusBox.textContent='Status unavailable.';});
	}
	async toggleBanip(){
		const enable=!this.enabled();
		if(enable&&!confirm('Turn on BanIP threat blocking? It fetches threat feeds and inserts firewall blocking rules.'))return;
		try{
			await this.core.uciSet('banip','global',{ban_enabled:enable?'1':'0'});
			await this.core.uciCommit('banip');
			await this.exec('/etc/init.d/banip',[enable?'enable':'disable']);
			await this.exec('/etc/init.d/banip',[enable?'start':'stop']);
			this.core.showToast(enable?'BanIP enabled':'BanIP disabled','success');await this.show();
		}catch(e){this.core.showToast('Could not change BanIP: '+e.message,'error');}
	}
	async saveFeeds(){
		const feeds=this.feedChecks.filter(c=>c.checked).map(c=>c.value);
		try{
			await this.core.uciSet('banip','global',{ban_feed:feeds});
			await this.core.uciCommit('banip');
			this.core.showToast('Feeds saved — refreshing','success');
			await this.reloadFeeds();
		}catch(e){this.core.showToast('Could not save feeds: '+e.message,'error');}
	}
	async reloadFeeds(){
		try{await this.exec('/etc/init.d/banip',['reload']);this.core.showToast('Feeds refreshed','success');await this.show();}
		catch(e){this.core.showToast('Feed refresh failed: '+e.message,'error');}
	}
	async saveAllowlist(text){
		try{
			await this.core.ubusCall('file','write',{path:'/etc/banip/banip.allowlist',data:text.endsWith('\n')?text:text+'\n'},{timeout:15000});
			this.core.showToast('Allowlist saved','success');
			if(this.enabled())await this.exec('/etc/init.d/banip',['reload']);
			await this.show();
		}catch(e){this.core.showToast('Could not save allowlist: '+e.message,'error');}
	}
}