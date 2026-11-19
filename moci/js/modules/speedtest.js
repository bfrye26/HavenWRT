// Speed test — browser-based WAN test against Cloudflare's speed endpoints
// (measures this client's path), plus an iperf3 LAN test run on the router.
const CF_DOWN='https://speed.cloudflare.com/__down?bytes=';
const CF_UP='https://speed.cloudflare.com/__up';
const HIST='moci-speedtest-history';
export default class SpeedtestModule{
	constructor(core){this.core=core;this.busy=false;this.core.registerRoute('/speedtest',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:60000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	show(){
		this.page=document.getElementById('speedtest-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#speedtest-content');if(!this.root)return;
		this.render();
	}
	mbps(bytes,ms){return ms>0?(bytes*8/1e6)/(ms/1000):0;}
	render(){
		const root=this.root;root.replaceChildren();
		root.append(this.el('p','Measure your internet speed (via Cloudflare, from this browser) or test LAN/Wi-Fi throughput between the router and a device (iperf3). The WAN test reflects this client’s path, not necessarily the router’s full capacity.','page-note'));
		// WAN test
		const card=this.el('div',undefined,'stat-card');
		card.append(this.el('div','Internet speed (WAN)','section-title'));
		const results=this.el('div',undefined,'dev-summary');
		const stat=(id,label)=>{const c=this.el('div',undefined,'dev-stat stat-card');const v=this.el('strong','—','dev-stat-n');v.id=id;c.append(v,this.el('span',label,'dev-stat-l'));return c;};
		results.append(stat('st-ping','Ping (ms)'),stat('st-down','Download (Mbps)'),stat('st-up','Upload (Mbps)'));
		card.append(results);
		const run=this.el('button','RUN WAN TEST','action-btn');run.type='button';run.style.marginTop='14px';
		run.addEventListener('click',()=>this.runWan(run));
		card.append(run);root.append(card);
		// LAN iperf3
		const lan=this.el('div',undefined,'stat-card');lan.style.marginTop='24px';
		lan.append(this.el('div','LAN throughput (iperf3)','section-title'));
		lan.append(this.el('p','Run an iperf3 client on the router against an iperf3 server on your LAN (start one with `iperf3 -s` on a computer). Measures router↔device throughput.','page-note'));
		const host=this.el('input');host.className='form-input';host.placeholder='192.168.68.50 (iperf3 server)';host.style.maxWidth='320px';
		const lanRun=this.el('button','RUN LAN TEST','action-btn');lanRun.type='button';lanRun.style.marginLeft='8px';
		const lanOut=this.el('pre',undefined,'page-note');lanOut.style.whiteSpace='pre-wrap';
		lanRun.addEventListener('click',()=>this.runLan(host.value.trim(),lanRun,lanOut));
		const row=this.el('div',undefined,'action-row');row.append(host,lanRun);
		lan.append(row,lanOut);root.append(lan);
		// History
		root.append(this.el('h3','Recent WAN results'));
		const hist=this.el('div',undefined,'wifi-net-list');
		let history=[];try{history=JSON.parse(localStorage.getItem(HIST)||'[]');}catch{}
		if(!history.length)hist.append(this.el('p','No tests yet.','page-note'));
		for(const h of history.slice(0,8)){
			const c=this.el('div',undefined,'stat-card');
			c.append(this.el('strong',new Date(h.t).toLocaleString(),'dev-name'),
				this.el('span',`Ping ${h.ping} ms · ↓ ${h.down} Mbps · ↑ ${h.up} Mbps`,'dev-mono wifi-net-meta'));
			hist.append(c);
		}
		root.append(hist);
	}
	async runWan(btn){
		if(this.busy)return;this.busy=true;btn.disabled=true;btn.textContent='TESTING…';
		const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
		try{
			// ping: median of 5 tiny fetches
			const pings=[];
			for(let i=0;i<5;i++){const t0=performance.now();await fetch(CF_DOWN+'0',{cache:'no-store'});pings.push(performance.now()-t0);}
			pings.sort((a,b)=>a-b);const ping=Math.round(pings[2]);set('st-ping',ping);
			// download: 25 MB
			const dBytes=25_000_000;const t1=performance.now();
			const dr=await fetch(CF_DOWN+dBytes,{cache:'no-store'});const db=await dr.arrayBuffer();
			const down=this.mbps(db.byteLength,performance.now()-t1).toFixed(1);set('st-down',down);
			// upload: 10 MB
			const uBytes=10_000_000;const blob=new Uint8Array(uBytes);const t2=performance.now();
			await fetch(CF_UP,{method:'POST',body:blob,cache:'no-store'});
			const up=this.mbps(uBytes,performance.now()-t2).toFixed(1);set('st-up',up);
			let history=[];try{history=JSON.parse(localStorage.getItem(HIST)||'[]');}catch{}
			history.unshift({t:Date.now(),ping,down,up});history=history.slice(0,10);
			localStorage.setItem(HIST,JSON.stringify(history));
			this.core.showToast('Speed test complete','success');this.render();
		}catch(e){this.core.showToast('Speed test failed: '+e.message,'error');}
		finally{this.busy=false;}
	}
	async runLan(host,btn,out){
		if(!host){this.core.showToast('Enter an iperf3 server IP','error');return;}
		btn.disabled=true;out.textContent='Running iperf3 (10 s)…';
		try{
			const r=await this.exec('/usr/bin/iperf3',['-c',host,'-J','-t','10']);
			let j={};try{j=JSON.parse(r.stdout||'{}');}catch{}
			if(j.error){out.textContent='iperf3 error: '+j.error;return;}
			const sent=j.end?.sum_sent?.bits_per_second||0;const recv=j.end?.sum_received?.bits_per_second||0;
			out.textContent=`Sender: ${(sent/1e6).toFixed(1)} Mbps\nReceiver: ${(recv/1e6).toFixed(1)} Mbps\nRetransmits: ${j.end?.sum_sent?.retransmits??'—'}`;
		}catch(e){out.textContent='iperf3 failed: '+e.message;}
		finally{btn.disabled=false;}
	}
}