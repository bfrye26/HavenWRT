// LLDP — neighbor discovery table from the packaged luci.lldpd ubus plugin
// (lldpcli JSON). Shows directly-connected switches/devices per port.
export default class LldpModule{
	constructor(core){this.core=core;this.core.registerRoute('/lldp',()=>this.show());}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	async exec(command,params=[]){const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:15000});if(s!==0)throw new Error('Command denied ('+s+')');return r||{};}
	async show(){
		this.page=document.getElementById('lldp-page');this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#lldp-content');if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading LLDP neighbors…','page-loading'));
		try{
			const [s,r]=await this.core.ubusCall('luci.lldpd','getStatus',{}, {timeout:15000});
			this.status=(s===0&&r)?r:null;
			this.render();
		}catch(e){this.root.replaceChildren(this.el('p','Unable to read LLDP: '+e.message,'page-error'));}
	}
	render(){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		const bar=this.el('div',undefined,'page-toolbar');
		const refresh=this.el('button','REFRESH','action-btn');refresh.type='button';refresh.addEventListener('click',()=>this.show());bar.append(refresh);
		const enable=this.el('button','ENABLE LLDP','action-btn');enable.type='button';
		enable.addEventListener('click',async()=>{try{await this.exec('/etc/init.d/lldpd',['enable']);await this.exec('/etc/init.d/lldpd',['start']);this.core.showToast('LLDP enabled','success');await this.show();}catch(e){this.core.showToast('Failed: '+e.message,'error');}});
		bar.append(enable);root.append(bar);
		root.append(this.el('p','Devices discovered via LLDP on each port (switches, APs, servers). Enable LLDP to advertise this router and learn neighbors.','page-note'));
		const ifaces=this.status?.neighbors?.lldp?.interface||[];
		if(!ifaces.length){root.append(this.el('div','No LLDP neighbors learned yet. Enable LLDP and ensure connected devices also run LLDP.','addon-empty'));return;}
		const t=this.el('table',undefined,'data-table');
		const rows=[];
		for(const iface of ifaces){
			const port=iface.name||'?';
			const chassis=iface.chassis||{};
			const chName=chassis.name?.[0]?.value||chassis.id?.[0]?.value||'?';
			const chDesc=chassis.descr?.[0]?.value||'';
			const portId=iface.port?.id?.[0]?.value||iface.port?.descr?.[0]?.value||'';
			rows.push(`<tr><td class="dev-mono">${esc(port)}</td><td><strong>${esc(chName)}</strong>${chDesc?'<br><span class="dev-res-meta">'+esc(chDesc)+'</span>':''}</td><td class="dev-mono">${esc(portId)}</td></tr>`);
		}
		t.innerHTML='<thead><tr><th>Local port</th><th>Neighbor</th><th>Remote port</th></tr></thead><tbody>'+rows.join('')+'</tbody>';
		root.append(t);
	}
}