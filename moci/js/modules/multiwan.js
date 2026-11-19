// Multi-WAN / Failover — mwan3 status plus full editing of tracked interfaces,
// policies (failover by metric, load-balance by weight) and steering rules.
// Writes mwan3 UCI directly and reloads the service; mwan3 is not a management
// interface, so changes commit + reload rather than using the connectivity probe.
export default class MultiwanModule{
	constructor(core){
		this.core=core;
		this.core.registerRoute('/multiwan',()=>this.show());
	}
	el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
	input(type,value,placeholder){const i=this.el('input');i.type=type;i.className='form-input';if(value!=null)i.value=value;if(placeholder)i.placeholder=placeholder;return i;}
	field(label,control){const l=this.el('label',undefined,'advanced-field');l.append(this.el('span',label),control);return l;}
	async exec(command,params=[]){
		const [s,r]=await this.core.ubusCall('file','exec',{command,params},{timeout:20000});
		if(s!==0)throw new Error('Command denied by router permissions ('+s+')');
		return r||{};
	}
	async show(){
		this.page=document.getElementById('multiwan-page');
		this.page?.classList.remove('hidden');
		this.root=this.page?.querySelector('#multiwan-content');
		if(!this.root)return;
		this.root.replaceChildren(this.el('p','Reading Multi-WAN status…','page-loading'));
		try{
			const [status,cfg]=await Promise.all([
				this.exec('/usr/sbin/mwan3',['status']).catch(()=>({code:1,stdout:''})),
				this.core.uciGet('mwan3').catch(()=>[1,{values:{}}])
			]);
			this.cfg=(cfg[0]===0&&cfg[1]?.values)?cfg[1].values:{};
			this.status=this.parseStatus(String(status.stdout||''));
			this.render(status.code===0);
		}catch(e){
			this.root.replaceChildren(this.el('p','Unable to read Multi-WAN status: '+e.message,'page-error'));
		}
	}
	parseStatus(text){
		const interfaces=[];const policies=[];
		let section='';let current=null;
		for(const line of text.split('\n')){
			const t=line.trim();
			if(/^Interface status:/i.test(t)){section='iface';continue;}
			if(/^Current ipv4 policies:/i.test(t)){section='pol';continue;}
			if(/^Current ipv6 policies:/i.test(t)){section='pol6';continue;}
			if(section==='iface'){
				const m=/^interface\s+(\S+)\s+is\s+(\w+)/i.exec(t);
				if(m)interfaces.push({name:m[1],state:m[2].toLowerCase()});
			}else if(section==='pol'||section==='pol6'){
				if(/:$/.test(t)&&!/\(/.test(t)){current={name:t.replace(/:$/,''),members:[],ipv6:section==='pol6'};policies.push(current);}
				else if(current&&t){current.members.push(t);}
			}
		}
		return {interfaces,policies};
	}
	sections(type){return Object.entries(this.cfg).filter(([,v])=>v?.['.type']===type);}
	render(hasStatus){
		const root=this.root;root.replaceChildren();
		const esc=t=>this.core.escapeHtml(t);
		const bar=this.el('div',undefined,'page-toolbar');
		const mk=(label,fn)=>{const b=this.el('button',label,'action-btn');b.type='button';b.addEventListener('click',fn);return b;};
		bar.append(mk('REFRESH',()=>this.show()),mk('ADD INTERFACE',()=>this.editInterface()),mk('ADD POLICY',()=>this.editPolicy()),mk('ADD RULE',()=>this.editRule()));
		root.append(bar);
		root.append(this.el('p','Load-balance and fail over across multiple WAN uplinks. Track each WAN interface, build a policy (lower metric = preferred for failover; equal metric with weights = load-balance), then steer traffic with rules. Requires at least two WAN interfaces.','page-intro'));
		if(!hasStatus){
			root.append(this.el('div','mwan3 is not running. Turn on Multi-WAN in Features, then add at least two WAN interfaces.','addon-empty'));
		}
		// Live status cards
		if(this.status.interfaces.length){
			const grid=this.el('div',undefined,'stat-grid');
			for(const i of this.status.interfaces){
				const online=i.state==='online';
				const card=this.el('div',undefined,'stat-card dev-stat');
				card.append(this.el('strong',i.name,'dev-stat-n'));
				const wrap=this.el('div');wrap.innerHTML=this.core.renderBadge(online?'success':(i.state==='offline'?'error':'info'),i.state.toUpperCase());card.append(wrap);
				grid.append(card);
			}
			root.append(grid);
		}
		// Interfaces
		root.append(this.el('h3','Tracked WAN interfaces'));
		const ifaces=this.sections('interface');
		root.append(this.table(['Interface','Track IP','Enabled','Live state',''],ifaces,([id,v])=>{
			const live=this.status.interfaces.find(i=>i.name===id);
			return `<td><strong>${esc(id)}</strong></td><td class="dev-mono">${esc(v.track_ip||'—')}</td>
				<td>${v.enabled==='0'?'No':'Yes'}</td><td>${live?esc(live.state):'—'}</td>`;
		},id=>this.editInterface(id),id=>this.deleteSection(id,'interface '+id)));
		// Policies
		root.append(this.el('h3','Policies'));
		const policies=this.sections('policy');
		root.append(this.table(['Policy','Members (metric / weight)',''],policies,([id,v])=>{
			const list=Array.isArray(v.use_member)?v.use_member:(v.use_member?[v.use_member]:[]);
			const desc=list.map(mn=>{const m=this.cfg[mn]||{};return `${esc(mn)} <span class="dev-res-meta">m${esc(m.metric||'1')}/w${esc(m.weight||'1')}</span>`;}).join('<br>')||'—';
			return `<td><strong>${esc(id)}</strong></td><td>${desc}</td>`;
		},id=>this.editPolicy(id),id=>this.deleteSection(id,'policy '+id)));
		// Rules
		root.append(this.el('h3','Steering rules'));
		const rules=this.sections('rule');
		root.append(this.table(['Rule','Match','Policy',''],rules,([id,v])=>
			`<td><strong>${esc(id)}</strong></td><td class="dev-mono">${esc(v.src_ip||'any')} → ${esc(v.dest_ip||'any')}</td><td>${esc(v.use_policy||'—')}</td>`,
			id=>this.editRule(id),id=>this.deleteSection(id,'rule '+id)));
	}
	table(headers,items,rowFn,onEdit,onDelete){
		const t=this.el('table',undefined,'data-table');
		const thead=this.el('thead');const hr=this.el('tr');
		for(const h of headers)hr.append(this.el('th',h));
		thead.append(hr);t.append(thead);
		const tb=this.el('tbody');
		if(!items.length){const tr=this.el('tr');const td=this.el('td','None configured.','page-note');td.colSpan=headers.length;tr.append(td);tb.append(tr);}
		for(const [id,v] of items){
			const tr=this.el('tr');tr.innerHTML=rowFn([id,v]);
			const act=this.el('td');const row=this.el('div',undefined,'action-row');
			const e=this.el('button','Edit','dev-action');e.type='button';e.addEventListener('click',()=>onEdit(id));
			const d=this.el('button','Delete','dev-action danger');d.type='button';d.addEventListener('click',()=>onDelete(id));
			row.append(e,d);act.append(row);tr.append(act);tb.append(tr);
		}
		t.append(tb);return t;
	}
	overlay(title){
		document.querySelector('.mwan-overlay')?.remove();
		const trigger=document.activeElement;
		const ov=this.el('div',undefined,'dev-modal-overlay mwan-overlay');
		const card=this.el('div',undefined,'dev-modal stat-card');
		card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
		const dismiss=()=>{ov.remove();trigger?.focus?.();};
		const head=this.el('div',undefined,'dev-modal-head');
		const close=this.el('button','Close','dev-action');close.type='button';close.addEventListener('click',dismiss);
		head.append(this.el('h3',title),close);
		const body=this.el('div',undefined,'dev-modal-body');
		const foot=this.el('div',undefined,'dev-modal-foot');
		card.append(head,body,foot);ov.append(card);document.body.append(ov);
		ov.addEventListener('click',e=>{if(e.target===ov)dismiss();});
		return {body,foot,dismiss};
	}
	async deleteSection(sec,label){
		if(!confirm('Delete '+label+'?'))return;
		try{
			await this.core.uciDelete('mwan3',sec);
			await this.core.uciCommit('mwan3');await this.core.serviceReload('mwan3');
			this.core.showToast('Deleted','success');await this.show();
		}catch(e){this.core.showToast('Delete failed: '+e.message,'error');}
	}
	editInterface(sec){
		const v=sec?this.cfg[sec]:null;
		const {body,foot,dismiss}=this.overlay(sec?'Edit WAN interface':'Add WAN interface');
		const name=this.input('text',sec||'','wan2');name.disabled=!!sec;
		const track=this.input('text',v?.track_ip||'1.1.1.1','1.1.1.1');
		const reliability=this.input('number',v?.reliability||'1','1');
		const count=this.input('number',v?.count||'1','1');
		const timeout=this.input('number',v?.timeout||'2','2');
		const up=this.input('number',v?.up||'3','3');
		const down=this.input('number',v?.down||'3','3');
		body.append(this.el('p','Track a WAN uplink by pinging a reliable host. mwan3 marks it online/offline and policies react.','page-note'),
			this.field('Interface (network name)',name),this.field('Track IP',track),this.field('Reliability',reliability),
			this.field('Count',count),this.field('Timeout (s)',timeout),this.field('Up retries',up),this.field('Down retries',down));
		const save=this.el('button','SAVE','action-btn');save.type='button';foot.append(save);
		save.addEventListener('click',async()=>{
			const nm=name.value.trim();if(!nm){this.core.showToast('Interface name required','error');return;}
			save.disabled=true;
			try{
				if(!sec)await this.core.uciAdd('mwan3','interface',nm);
				await this.core.uciSet('mwan3',nm,{track_ip:track.value.trim(),reliability:reliability.value,count:count.value,timeout:timeout.value,up:up.value,down:down.value,enabled:'1'});
				await this.core.uciCommit('mwan3');await this.core.serviceReload('mwan3');
				this.core.showToast('Interface saved','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Save failed: '+e.message,'error');save.disabled=false;}
		});
	}
	editPolicy(sec){
		const v=sec?this.cfg[sec]:null;
		const {body,foot,dismiss}=this.overlay(sec?'Edit policy':'Add policy');
		const name=this.input('text',sec||'','failover');name.disabled=!!sec;
		body.append(this.el('p','A policy orders WAN members. Lower metric = preferred (failover). Equal metric with weights = load-balance.','page-note'),this.field('Policy name',name));
		const membersWrap=this.el('div');const rows=[];
		const addRow=(iface='',metric='1',weight='1')=>{
			const row=this.el('div',undefined,'action-row');row.style.marginBottom='8px';
			const i=this.input('text',iface,'wan');i.style.flex='1';i.title='interface';
			const m=this.input('number',metric,'1');m.style.width='72px';m.title='metric';
			const w=this.input('number',weight,'1');w.style.width='72px';w.title='weight';
			const rm=this.el('button','✕','dev-action danger');rm.type='button';rm.title='Remove member';
			rm.addEventListener('click',()=>row.remove());
			row.append(i,m,w,rm);membersWrap.append(row);rows.push({i,m,w,row});
		};
		const memberList=Array.isArray(v?.use_member)?v.use_member:(v?.use_member?[v.use_member]:[]);
		if(memberList.length){for(const mn of memberList){const mv=this.cfg[mn]||{};addRow(mv.interface||'',mv.metric||'1',mv.weight||'1');}}
		else addRow('wan','1','1');
		const addMember=this.el('button','+ ADD MEMBER','dev-action');addMember.type='button';addMember.addEventListener('click',()=>addRow());
		body.append(this.el('span','Members (interface / metric / weight)','form-label'),membersWrap,addMember);
		const save=this.el('button','SAVE','action-btn');save.type='button';foot.append(save);
		save.addEventListener('click',async()=>{
			const nm=name.value.trim();if(!nm){this.core.showToast('Policy name required','error');return;}
			const active=rows.filter(r=>r.row.parentNode&&r.i.value.trim());
			if(!active.length){this.core.showToast('Add at least one member','error');return;}
			save.disabled=true;
			try{
				if(!sec)await this.core.uciAdd('mwan3','policy',nm);
				const memberNames=[];
				for(const r of active){
					const iface=r.i.value.trim();const metric=r.m.value||'1';const weight=r.w.value||'1';
					const mn=`${iface}_m${metric}_w${weight}`;
					if(!this.cfg[mn])await this.core.uciAdd('mwan3','member',mn);
					await this.core.uciSet('mwan3',mn,{interface:iface,metric,weight});
					memberNames.push(mn);
				}
				await this.core.uciSet('mwan3',nm,{use_member:memberNames});
				await this.core.uciCommit('mwan3');await this.core.serviceReload('mwan3');
				this.core.showToast('Policy saved','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Save failed: '+e.message,'error');save.disabled=false;}
		});
	}
	editRule(sec){
		const v=sec?this.cfg[sec]:null;
		const {body,foot,dismiss}=this.overlay(sec?'Edit rule':'Add rule');
		const name=this.input('text',sec||'','rule1');name.disabled=!!sec;
		const src=this.input('text',v?.src_ip||'','0.0.0.0/0');
		const dest=this.input('text',v?.dest_ip||'','0.0.0.0/0');
		const proto=this.input('text',v?.proto||'all','all');
		const pol=this.el('select');pol.className='form-input';
		for(const [p] of this.sections('policy')){const o=this.el('option',p);o.value=p;pol.append(o);}
		if(v?.use_policy)pol.value=v.use_policy;
		body.append(this.el('p','Match traffic and send it through a policy. Leave addresses as 0.0.0.0/0 to match all.','page-note'),
			this.field('Rule name',name),this.field('Source IP/CIDR',src),this.field('Destination IP/CIDR',dest),this.field('Protocol',proto),this.field('Use policy',pol));
		const save=this.el('button','SAVE','action-btn');save.type='button';foot.append(save);
		save.addEventListener('click',async()=>{
			const nm=name.value.trim();if(!nm){this.core.showToast('Rule name required','error');return;}
			if(!pol.value){this.core.showToast('Create a policy first','error');return;}
			save.disabled=true;
			try{
				if(!sec)await this.core.uciAdd('mwan3','rule',nm);
				await this.core.uciSet('mwan3',nm,{src_ip:src.value.trim()||'0.0.0.0/0',dest_ip:dest.value.trim()||'0.0.0.0/0',proto:proto.value.trim()||'all',use_policy:pol.value});
				await this.core.uciCommit('mwan3');await this.core.serviceReload('mwan3');
				this.core.showToast('Rule saved','success');dismiss();await this.show();
			}catch(e){this.core.showToast('Save failed: '+e.message,'error');save.disabled=false;}
		});
	}
}