'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {minute:'分钟',quarter:'15 分钟',hour:'小时',day:'天'};
const seconds = {minute:60,quarter:900,hour:3600,day:86400};
const zDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const zTime = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const iso = ms => zTime.format(new Date(ms)).replace(' ','T');
const fmtTime = sec => sec ? zTime.format(new Date(sec*1000)) : '—';
const dayStart = date => Date.parse(date + 'T00:00:00+08:00');
const setDateValue=(id,value)=>{$(id).value=value.replace('T',' ');};
const dateValue=id=>$(id).value.replace(' ','T');
const today = () => zDate.format(new Date());
function bytes(n, html=false){
  n = Math.max(0,Number(n)||0); const units=['B','KB','MB','GB','TB'];
  const i=Math.min(4,n?Math.floor(Math.log(n)/Math.log(1024)):0), value=n/(1024**i);
  const amount=value.toLocaleString('en-US',{maximumFractionDigits:i?2:0,minimumFractionDigits:i?2:0});
  return html?`${amount}<small>${units[i]}</small>`:`${amount} ${units[i]}`;
}
function period(value){
  let from=dayStart(today()), to=from+86400000;
  if(value==='7') from-=6*86400000;
  if(value==='month'){from=dayStart(today().slice(0,8)+'01');to=Date.UTC(Number(today().slice(0,4)),Number(today().slice(5,7)),1)-8*3600000;}
  if(value==='year'){const year=Number(today().slice(0,4));from=dayStart(`${year}-01-01`);to=dayStart(`${year+1}-01-01`);}
  return {from:iso(from),to:iso(to)};
}
let preferences={chart_type:'bar',app_mode:'combined',detail_mode:'summary'};
let state={...period('today'),...preferences,group:'app',granularity:'auto',subscription:'',app:'',node:'',offset:0};
let rangeOpen=false;
let latest=null, options={subscriptions:[],apps:[],nodes:[]}, csrf='', revision=0, loading=false, request=null, selectedTime=null, pendingAction=null;
function readURL(){
  const params=new URLSearchParams(location.search);state={...period('today'),...preferences,group:'app',granularity:'auto',subscription:'',app:'',node:'',offset:0};
  for(const key of ['from','to','group','granularity','subscription','app','node','chart_type','app_mode','detail_mode']) if(params.has(key)) state[key]=params.get(key);
  if(state.from.length===10) state.from+='T00:00';
  if(state.to.length===10) state.to=iso(dayStart(state.to)+86400000);
  for(const key of ['from','to']) setDateValue(key,state[key]);$('granularity').value=state.granularity;
  for(const key of ['chart_type','app_mode','detail_mode']){const allowed={chart_type:['bar','line'],app_mode:['combined','separate'],detail_mode:['summary','sources']}[key];if(!allowed.includes(state[key]))state[key]=preferences[key];$(key).value=state[key];}
}
function urlState(){const p=new URLSearchParams();for(const [k,v] of Object.entries(state)) if(v!==''&&k!=='offset')p.set(k,v);return p;}
function updateURL(){history.pushState(null,'','?'+urlState()+location.hash);}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>{$('toast').hidden=true;},3500);}
async function api(path, init={}){
  const response=await fetch(path,{...init,cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;
}
async function post(path,body){return api(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});}
function updatePreset(){
  let presetMatch=false;
  document.querySelectorAll('[data-period]').forEach(b=>{const p=period(b.dataset.period), selected=p.from===state.from&&p.to===state.to; presetMatch ||= selected; b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
  $('toggle-range').classList.toggle('selected',!presetMatch);
  $('toggle-range').textContent=presetMatch?'自定义':`${state.from.slice(5).replace('T',' ')} — ${state.to.slice(5).replace('T',' ')}`;
  $('toggle-range').title='自定义时间范围（北京时间）';
  document.querySelectorAll('[data-group]').forEach(b=>{b.classList.toggle('selected',b.dataset.group===state.group);b.setAttribute('aria-pressed',b.dataset.group===state.group);});
}
function fillOptions(){
  for(const [id,key,label] of [['subscription','subscriptions','全部订阅'],['app','apps','全部应用'],['node','nodes','全部节点']]){
    const entries=[...(id==='app'&&state.app_mode==='combined'?options.apps_combined||options.apps:options[key])];
    if(id==='subscription')entries.push({id:'unknown',name:'归属待确认'});
    if(state[id]&&!entries.some(x=>x.id===state[id]))entries.push({id:state[id],name:'历史筛选项'});
    $(id).innerHTML=`<option value="">${label}</option>`+entries.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}${entries.filter(y=>y.name===x.name).length>1?' · '+esc(x.id.slice(0,8)):''}</option>`).join('');
    $(id).value=state[id];
  }
}
function renderStatus(status){
  csrf=status.csrf;for(const key of ['chart_type','app_mode','detail_mode'])$(key).disabled=false;
  const live=status.connected&&status.collector_alive&&status.last_sample&&Date.now()/1000-status.last_sample<8;
  $('live').className='live '+(live?'online':'offline');
  $('live').innerHTML=`<i></i><span>${live?'记录中':'采集暂停'}</span>`;
  $('live').title=live?`全部代理当前速率：下载 ${bytes(status.download_speed)}/s，上传 ${bytes(status.upload_speed)}/s`:'正在重新连接，历史数据仍可查看';
  $('since').textContent='首次记录 '+fmtTime(status.created_at);
  const counts=status.totals||{};
  $('coverage').innerHTML=`<span class="status-ring"></span>当前 ${counts.proxy||0} 条代理连接 · 已排除 ${counts.excluded||0} 条直连 / 拦截`+(counts.unclassified?` · ${counts.unclassified} 条路由待识别`:'');
  $('coverage').title='这是活动连接数，不代表总连接数；未识别的路由不会被计入代理流量。';
}
function selectBar(point, summary){
  selectedTime=point.time;
  $('chart').querySelectorAll('.bar-col').forEach(b=>b.classList.toggle('picked',b.dataset.time===point.time));
  const start=Date.parse(point.time), end=Math.min(start+seconds[summary.granularity]*1000,Date.parse(summary.to));
  const effectiveStart=Math.max(start,Date.parse(summary.from));
  const elapsed=Math.max(0,(Math.min(Date.now(),end)-effectiveStart)/1000);
  const coverage=elapsed?Math.min(100,point.coverage/elapsed*100):0;
  const coverageLabel=effectiveStart>Date.now()?'未到达':coverage<98?'部分记录':'';
  $('chart-detail').innerHTML=`<strong>${esc(iso(effectiveStart).replace('T',' '))}</strong><span>↓ ${bytes(point.download)}</span><span>↑ ${bytes(point.upload)}</span><span class="partial-label" title="采集覆盖 ${coverage.toFixed(0)}%，不是流量完整率">${coverageLabel}</span><button class="chart-drill">查看该时段 ↗</button>`;
  $('chart-detail').querySelector('button').onclick=()=>{
    state.from=iso(effectiveStart);state.to=iso(end);state.granularity=summary.granularity==='day'?'hour':summary.granularity==='hour'?'minute':summary.granularity;
    setDateValue('from',state.from);setDateValue('to',state.to);$('granularity').value=state.granularity;changed();
  };
}
function renderChart(summary){
  const data=summary.series,max=Math.max(1,...data.map(p=>p.upload+p.download));
  const unit=1024**Math.min(4,Math.max(0,Math.floor(Math.log(max)/Math.log(1024))));
  const raw=max/unit/4, magnitude=10**Math.floor(Math.log10(raw));
  const nice=[1,2,5,10].find(n=>n*magnitude>=raw)||10;
  const ceiling=nice*magnitude*4*unit;
  $('chart').setAttribute('aria-label',`各时段流量${state.chart_type==='line'?'折线图':'柱状图'}，按${names[summary.granularity]}统计，条纹表示记录不完整`);
  $('y-labels').innerHTML=[1,.75,.5,.25,0].map(f=>`<span>${max===1?(f===0?'0':'—'):bytes(ceiling*f).replace(/\.00(?= )/,'')}</span>`).join('');
  const multiDay=summary.from.slice(0,10)!==iso(Date.parse(summary.to)-60000).slice(0,10);
  const labelEvery=data.length<=8?1:Math.ceil(data.length/6);
  $('chart').style.minWidth=data.length>32?`${data.length*20}px`:'100%';
  $('chart').innerHTML=data.map((p,i)=>{
    const begin=Math.max(Date.parse(p.time),Date.parse(summary.from));
    const end=Math.min(Date.parse(p.time)+seconds[summary.granularity]*1000,Date.parse(summary.to));
    const expected=Math.max(0,(Math.min(Date.now(),end)-begin)/1000);
    const track=begin>Date.now()?'future':p.coverage<expected*.98?'partial':'';
    const sum=p.upload+p.download,height=sum/ceiling*100;
    const label=summary.granularity==='day'?p.time.slice(5,10).replace('-','/'):multiDay&&p.time.slice(11,16)==='00:00'?p.time.slice(5,10).replace('-','/'):p.time.slice(11,16);
    const title=`${p.time.slice(0,16).replace('T',' ')}，下载 ${bytes(p.download)}，上传 ${bytes(p.upload)}`;
    return `<button class="bar-col" data-time="${esc(p.time)}" title="${esc(title)}" aria-label="${esc(title)}"><span class="bar-track ${track}"><span class="bar-stack" style="height:${height}%;${sum?'min-height:2px':''}"><span class="bar-down" style="height:${sum?p.download/sum*100:0}%"></span><span class="bar-up" style="height:${sum?p.upload/sum*100:0}%"></span></span></span><span class="bar-label">${i%labelEvery===0?esc(label):''}</span></button>`;
  }).join('');
  renderLines(data,ceiling,summary);
  $('chart').querySelectorAll('button').forEach((button,i)=>{button.onclick=()=>selectBar(data[i],summary);});
  $('chart-empty').hidden=summary.total.upload+summary.total.download>0;
  const chosen=data.find(p=>p.time===selectedTime)||data.reduce((a,b)=>a.upload+a.download>b.upload+b.download?a:b,data[0]);
  if(chosen)selectBar(chosen,summary);
}
function avatar(name){return esc(name.replace(/[^\p{L}\p{N}]/gu,'').slice(0,2)||'↗');}
function renderRanking(summary){
  const data=summary.ranking,max=Math.max(1,...data.map(r=>r.upload+r.download));
  $('ranking').innerHTML=data.length?data.map((r,i)=>`<button class="rank-row" data-index="${i}" title="筛选：${esc(r.name)}"><span class="rank-avatar">${avatar(r.name)}</span><span class="rank-body"><span class="rank-line"><span class="rank-name">${esc(r.name)}${data.filter(x=>x.name===r.name).length>1?`<small class="identity">${esc(r.id.slice(0,8))}</small>`:''}</span><span class="rank-value">${bytes(r.upload+r.download)}</span></span><span class="rank-meter"><i style="width:${r.download/max*100}%"></i><i style="width:${r.upload/max*100}%"></i></span></span></button>`).join(''):'<div class="rank-empty">暂无排行</div>';
  $('ranking').querySelectorAll('button').forEach((b,i)=>{b.onclick=()=>{state[state.group]=data[i].id;fillOptions();changed();};});
}
function renderDetails(data){
  $('detail-count').textContent=data.count;
  $('detail-rows').innerHTML=data.rows.length?data.rows.map((r,i)=>`<tr><td><div class="cell-app"><span class="rank-avatar">${avatar(r.app)}</span><span>${esc(r.app)}<small class="identity">${esc(r.app_id==='family:openai'?'应用组合':r.app_id.slice(0,8))}</small></span></div></td><td>${esc(r.subscription)}</td><td><div class="node-name">${esc(r.node)}<small class="identity">${esc(r.node_key.slice(0,8))}</small>${state.detail_mode==='sources'?`<span class="source-chain">${esc(r.chain)}</span>`:''}</div></td><td class="numeric">${bytes(r.download)}</td><td class="numeric">${bytes(r.upload)}</td><td class="numeric row-total">${bytes(r.upload+r.download)}</td><td><button class="source-button" data-row="${i}">来源${r.source_count>1?' · '+r.source_count:''}</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-row">暂无符合条件的记录</td></tr>';
  $('detail-rows').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>openSources(data.rows[i]));
  $('page-label').textContent=data.count?`显示 ${data.offset+1}–${Math.min(data.offset+50,data.count)}，共 ${data.count} 条${state.detail_mode==='sources'?'来源':'汇总'}`:'暂无记录';
  $('prev').disabled=data.offset===0;$('next').disabled=data.offset+50>=data.count;
}
let sourceQuery=null, sourceRow=null;
async function openSources(row){
  sourceRow=row;sourceQuery=new URLSearchParams(urlState());sourceQuery.set('app',row.app_id);sourceQuery.set('node',row.node_key);sourceQuery.set('subscription',row.subscription_id);sourceQuery.set('detail_mode','sources');sourceQuery.set('offset',0);
  if(state.detail_mode==='sources')sourceQuery.set('app_mode','separate');
  $('sources-title').textContent=row.app+' · 来源';$('sources-body').textContent='正在读取…';$('sources-dialog').showModal();await loadSources();
}
async function loadSources(){
  try{
    const data=await api('/api/details?'+sourceQuery);
    $('sources-body').innerHTML=data.rows.map(r=>`<article class="source-card"><div class="source-top"><strong>${esc(r.app)}</strong><strong>${bytes(r.upload+r.download)}</strong></div><dl><dt>应用编号</dt><dd>${esc(r.app_id)}</dd><dt>实际节点</dt><dd>${esc(r.node)}<br><code>${esc(r.node_key)}</code></dd><dt>代理链</dt><dd>${esc(r.chain)}</dd><dt>订阅归属</dt><dd>${esc(r.subscription)} · ${esc(r.attribution)}</dd><dt>记录范围</dt><dd>${fmtTime(r.first_seen)} 至 ${fmtTime(r.last_seen)}</dd><dt>传输</dt><dd>↓ ${bytes(r.download)}　↑ ${bytes(r.upload)}</dd></dl></article>`).join('')||'暂无来源';
    $('sources-page').textContent=`${data.count?data.offset+1:0}–${Math.min(data.offset+50,data.count)} / ${data.count}`;$('sources-prev').disabled=!data.offset;$('sources-next').disabled=data.offset+50>=data.count;
  }catch(e){$('sources-body').textContent=e.message;}
}
$('sources-prev').onclick=()=>{sourceQuery.set('offset',Math.max(0,Number(sourceQuery.get('offset'))-50));loadSources();};
$('sources-next').onclick=()=>{sourceQuery.set('offset',Number(sourceQuery.get('offset'))+50);loadSources();};
$('source-mapping').onclick=()=>{$('sources-dialog').close();openMapping(sourceRow.node_key);};
$('aggregation-help').onclick=()=>$('rules-dialog').showModal();
function renderLines(data,ceiling,summary){
  const line=state.chart_type==='line';$('chart').classList.toggle('line-chart',line);if(!line)return;
  const known=p=>Date.parse(p.time)<Date.now()&&(p.coverage>0||p.upload+p.download>0);
  let svg='';
  for(const [field,color] of [['download','#17765f'],['upload','#9982c5']]){
    let active=false,path='';
    data.forEach((p,i)=>{if(!known(p)){active=false;return;}const button=$('chart').querySelectorAll('.bar-col')[i];const x=(button.offsetLeft+button.offsetWidth/2)/$('chart').clientWidth*1000,y=220-p[field]/ceiling*220;path+=`${active?'L':'M'}${x},${y} `;active=true;svg+=`<ellipse cx="${x}" cy="${y}" rx="${3000/Math.max(1,$('chart').clientWidth)}" ry="3" fill="${color}"/>`;});
    svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
  }
  $('chart').insertAdjacentHTML('beforeend',`<svg class="trend-lines" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>`);
}
function renderCalendar(summary){
  const days=summary.daily||[],visible=days.length>=28;$('traffic-calendar').hidden=!visible;if(!visible)return;
  const months=new Map();for(const p of days){const key=p.time.slice(0,7);if(!months.has(key))months.set(key,[]);months.get(key).push(p);}
  $('calendar-heading').textContent=months.size>1?`${state.from.slice(0,4)} · 每日流量`:`${state.from.slice(0,4)} 年 ${Number(state.from.slice(5,7))} 月`;
  $('heatmap').classList.toggle('year-grid',months.size>1);
  const now=Date.now();let html='';
  for(const [month,points] of months){
    const firstDay=new Date(points[0].time.slice(0,10)+'T12:00:00Z').getUTCDay();
    html+=`<section class="heat-month">${months.size>1?`<h3>${Number(month.slice(5))} 月</h3>`:''}<div class="heat-days">${['一','二','三','四','五','六','日'].map(d=>`<span class="weekday">${d}</span>`).join('')}${'<span></span>'.repeat((firstDay+6)%7)}`;
    for(const p of points){
      const sum=p.upload+p.download,start=Math.max(Date.parse(p.time),Date.parse(summary.from)),end=Math.min(Date.parse(p.time)+86400000,Date.parse(summary.to));
      const future=start>now,expected=Math.max(0,(Math.min(now,end)-start)/1000),missing=!p.coverage&&!sum,partial=!missing&&p.coverage<expected*.98;
      const level=sum===0?0:sum<10*1024**2?1:sum<100*1024**2?2:sum<1024**3?3:4;
      const label=`${p.time.slice(0,10)} · ${future?'未到达':missing?'无采集记录':bytes(sum)+(partial?' · 部分记录':'')}（下载 ${bytes(p.download)}，上传 ${bytes(p.upload)}）`;
      html+=`<button class="heat-day ${future?'future':missing?'unrecorded':'level-'+level}" data-day="${p.time.slice(0,10)}" title="${esc(label)}" aria-label="${esc(label)}" ${future?'disabled':''}><span>${Number(p.time.slice(8,10))}${partial?' ◦':''}</span>${months.size===1?`<strong>${future?'—':missing?'无记录':bytes(sum).replace('.00','')}</strong>`:''}</button>`;
    }html+='</div></section>';
  }$('heatmap').innerHTML=html;
  for(const b of $('heatmap').querySelectorAll('button')){b.onfocus=b.onmouseenter=()=>{$('calendar-selection').textContent=b.title;};b.onclick=()=>{state.from=b.dataset.day+'T00:00';state.to=iso(dayStart(b.dataset.day)+86400000);state.granularity='hour';setDateValue('from',state.from);setDateValue('to',state.to);$('granularity').value='hour';changed();};}
}
async function refresh(force=false){
  if(loading&&!force)return;
  if(force&&request)request.abort();
  request=new AbortController();const currentRequest=request, rev=++revision;loading=true;
  try{
    const p=urlState();p.set('offset',state.offset);
    const [summary,detail,status]=await Promise.all([api('/api/summary?'+p,{signal:currentRequest.signal}),api('/api/details?'+p,{signal:currentRequest.signal}),api('/api/status',{signal:currentRequest.signal})]);
    if(rev!==revision)return;
    latest=summary;renderStatus(status);$('error').hidden=true;
    $('total').innerHTML=bytes(summary.total.upload+summary.total.download,true);$('upload').innerHTML=bytes(summary.total.upload,true);$('download').innerHTML=bytes(summary.total.download,true);
    $('unknown').hidden=!summary.total.unknown;
    $('unknown').textContent=`${bytes(summary.total.unknown)} 流量的订阅归属待确认，可在归属管理中指定。`;
    renderCalendar(summary);renderChart(summary);renderRanking(summary);renderDetails(detail);updatePreset();
    $('export').href='/api/export.csv?'+p;
    $('events').innerHTML=summary.events.length?summary.events.map(e=>`<div class="event">${esc(fmtTime(e.start))} → ${esc(fmtTime(e.end))}<br>${esc(e.kind)}</div>`).join(''):'当前时间范围内暂无中断记录。';
  }catch(error){
    if(error.name==='AbortError')return;
    $('error').hidden=false;$('error').textContent=error.message+'。保留上一次成功读取的数据。';
    $('live').className='live offline';$('live').innerHTML='<i></i><span>视图未更新 · 请检查查询或服务</span>';
  }finally{if(rev===revision)loading=false;}
}
function changed(){state.offset=0;updatePreset();updateURL();refresh(true);}
async function refreshOptions(){try{options=await api('/api/options');fillOptions();}catch{/* keep last valid filters */}}
function openMapping(node){
  $('mapping-node').innerHTML=options.nodes.map(n=>`<option value="${esc(n.id)}">${esc(n.name)} · ${esc(n.id.slice(0,6))}</option>`).join('');
  $('mapping-sub').innerHTML='<option value="">自动识别（恢复原始归属）</option>'+options.subscriptions.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if(node)$('mapping-node').value=node;
  mappingChanged();$('mapping-dialog').showModal();
}
function mappingChanged(){
  const node=options.nodes.find(n=>n.id===$('mapping-node').value);
  $('mapping-sub').value=node?.override||'';
  $('save-mapping').disabled=!node;
  $('mapping-note').textContent=node?`节点编号 ${node.id.slice(0,8)}`:'暂无已记录节点，产生流量后可在此管理归属。';
}
async function storageView(fill=true){
  const data=await api('/api/storage');
  $('storage-size').textContent=bytes(data.bytes);$('storage-limit').textContent='上限 '+data.settings.max_mb+' MB';
  $('storage-meter').style.width=Math.min(100,data.bytes/(data.settings.max_mb*1024*1024)*100)+'%';
  $('storage-range').textContent=data.oldest?`${fmtTime(data.oldest)} 至 ${fmtTime(data.newest)}`:'还没有保存的用量记录';
  if(fill){$('retention-days').value=data.settings.retention_days;$('max-mb').value=data.settings.max_mb;}
  $('last-cleanup').textContent=data.last_cleanup?`上次清理 ${fmtTime(data.last_cleanup.at)} · ${data.last_cleanup.reason} · ${data.last_cleanup.rows} 条`:'尚无清理记录';
  return data;
}
function confirmAction(title,message,callback){
  $('confirm-title').textContent=title;$('confirm-text').textContent=message;pendingAction=callback;$('confirm-dialog').showModal();
}
$('confirm-action').onclick=async()=>{
  const button=$('confirm-action');button.disabled=true;
  try{await pendingAction();$('confirm-dialog').close();}catch(e){toast(e.message);}finally{button.disabled=false;}
};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
for(const button of document.querySelectorAll('[data-period]'))button.onclick=()=>{rangeOpen=false;$('custom-range').hidden=true;$('toggle-range').setAttribute('aria-expanded','false');Object.assign(state,period(button.dataset.period));setDateValue('from',state.from);setDateValue('to',state.to);state.granularity='auto';$('granularity').value='auto';changed();};
$('toggle-range').onclick=()=>{rangeOpen=!rangeOpen;$('custom-range').hidden=!rangeOpen;$('toggle-range').setAttribute('aria-expanded',rangeOpen);};
$('apply-range').onclick=()=>{if(!dateValue('from')||!dateValue('to')||dateValue('from')>=dateValue('to'))return toast('结束时间需晚于开始时间');state.from=dateValue('from');state.to=dateValue('to');rangeOpen=false;$('custom-range').hidden=true;$('toggle-range').setAttribute('aria-expanded','false');changed();};

for(const key of ['subscription','app','node','granularity'])$(key).onchange=()=>{state[key]=$(key).value;changed();};
for(const button of document.querySelectorAll('[data-group]'))button.onclick=()=>{state.group=button.dataset.group;changed();};
$('reset').onclick=()=>{rangeOpen=false;$('custom-range').hidden=true;$('toggle-range').setAttribute('aria-expanded','false');state={...period('today'),...preferences,group:'app',granularity:'auto',subscription:'',app:'',node:'',offset:0};setDateValue('from',state.from);setDateValue('to',state.to);$('granularity').value='auto';for(const key of ['chart_type','app_mode','detail_mode'])$(key).value=state[key];fillOptions();changed();};
$('prev').onclick=()=>{state.offset=Math.max(0,state.offset-50);refresh(true);};$('next').onclick=()=>{state.offset+=50;refresh(true);};
$('manage').onclick=()=>openMapping();$('mapping-node').onchange=mappingChanged;
$('save-mapping').onclick=async()=>{
  $('save-mapping').disabled=true;
  try{await post('/api/override',{node_key:$('mapping-node').value,subscription_id:$('mapping-sub').value||null});await refreshOptions();$('mapping-dialog').close();toast('归属已更新，历史与后续统计同步生效');refresh(true);}catch(e){toast(e.message);}finally{$('save-mapping').disabled=false;}
};
$('about').onclick=()=>$('about-dialog').showModal();
$('settings').onclick=async()=>{
  selectStorageTab('auto');$('settings-dialog').showModal();setDateValue('clean-from',state.from);setDateValue('clean-to',state.to);
  try{await storageView();}catch(e){toast(e.message);}
};
$('save-settings').onclick=()=>{
  const data={retention_days:Number($('retention-days').value),max_mb:Number($('max-mb').value)};
  if(!Number.isInteger(data.retention_days)||data.retention_days<0||data.retention_days>3650||!Number.isInteger(data.max_mb)||data.max_mb<8||data.max_mb>8192)return toast('保留天数为 0–3650，空间上限为 8–8192 MB，请输入整数。');
  confirmAction('保存清理策略',`保留${data.retention_days?`最近 ${data.retention_days} 天`:'全部日期'}，空间上限 ${data.max_mb} MB。保存后立即检查，超出期限或空间的最早记录将被永久清理。`,async()=>{await post('/api/settings',data);await storageView(false);await refreshOptions();refresh(true);toast('存储设置已保存');});
};
function cleanup(scope){
  const data={scope,confirm:true,from:dateValue('clean-from'),to:dateValue('clean-to')};
  const message=scope==='all'?'即将永久删除全部统计历史，设置和订阅映射保留，后台继续记录。':`即将永久删除 ${data.from.replace('T',' ')} 至 ${data.to.replace('T',' ')}（结束时间不含）的全部应用与节点记录，不受主页面筛选影响。`;
  if(scope==='range'&&(!data.from||!data.to||data.from>=data.to))return toast('请选择有效的开始和结束时间。');
  confirmAction(scope==='all'?'清理全部历史？':'清理指定时段？',message,async()=>{const result=await post('/api/cleanup',data);await storageView(false);await refreshOptions();refresh(true);toast(`已清理 ${result.deleted_rows} 条分钟汇总`);});
}
$('clean-range').onclick=()=>cleanup('range');$('clean-all').onclick=()=>cleanup('all');
window.addEventListener('popstate',()=>{readURL();fillOptions();refresh(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();refreshOptions();}});

function selectStorageTab(tab){
  document.querySelectorAll('[data-storage-tab]').forEach(button=>{const selected=button.dataset.storageTab===tab;button.setAttribute('aria-selected',selected);button.tabIndex=selected?0:-1;});
  $('storage-auto').hidden=tab!=='auto';$('storage-manual').hidden=tab!=='manual';
  $('save-settings').hidden=tab!=='auto';$('clean-range').hidden=tab!=='manual';
  document.querySelector('.settings-content').scrollTop=0;
}
for(const button of document.querySelectorAll('[data-storage-tab]')){
  button.onclick=()=>selectStorageTab(button.dataset.storageTab);
  button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tab=e.key==='Home'?'auto':e.key==='End'?'manual':button.dataset.storageTab==='auto'?'manual':'auto';selectStorageTab(tab);$('tab-'+tab).focus();}};
}
let dateTarget=null;
const datePicker=flatpickr($('calendar-value'),{
  inline:true,appendTo:$('calendar-host'),locale:'zh',enableTime:true,time_24hr:true,
  minuteIncrement:1,dateFormat:'Y-m-d H:i',ariaDateFormat:'Y年m月d日',
  disableMobile:true,animate:false,monthSelectorType:'dropdown',
  onChange:()=>updateDateSelection(),onValueUpdate:()=>updateDateSelection()
});
datePicker.hourElement.setAttribute('aria-label','小时');
datePicker.minuteElement.setAttribute('aria-label','分钟');
datePicker.currentYearElement.setAttribute('aria-label','年份');
datePicker.monthsDropdownContainer.setAttribute('aria-label','月份');
for(const [arrow,label] of [[datePicker.prevMonthNav,'上个月'],[datePicker.nextMonthNav,'下个月']]){
  arrow.setAttribute('role','button');arrow.setAttribute('aria-label',label);arrow.tabIndex=0;
  arrow.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();arrow.click();}};
}
function updateDateSelection(){
  $('date-selection').textContent=$('calendar-value').value||'请选择日期';
}
function openDatePicker(input){
  dateTarget=input;datePicker.setDate(input.value||iso(Date.now()).replace('T',' '),false);
  $('date-title').textContent=input.dataset.dateTitle;updateDateSelection();$('date-dialog').showModal();
}
for(const input of document.querySelectorAll('.date-trigger')){
  input.onclick=()=>openDatePicker(input);
  input.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDatePicker(input);}};
}
$('confirm-date').onclick=()=>{
  if(!datePicker.selectedDates.length)return;
  // Read after the time field loses focus so the picker commits typed minutes.
  dateTarget.value=datePicker.formatDate(datePicker.selectedDates[0],'Y-m-d H:i');
  $('date-dialog').close();dateTarget.focus();
};
function updateNavigation(){
  const dialog=document.querySelector('dialog[open]:not(#date-dialog):not(#confirm-dialog)');
  const current=dialog?({'settings-dialog':'settings','mapping-dialog':'manage','about-dialog':'about','sources-dialog':'details','rules-dialog':'details'}[dialog.id]):location.hash==='#details'?'details':'overview';
  document.querySelectorAll('.nav-item').forEach(item=>{const active=(item.id||item.hash.slice(1))===current;item.classList.toggle('active',active);if(active)item.setAttribute('aria-current','location');else item.removeAttribute('aria-current');});
}
window.addEventListener('hashchange',updateNavigation);
new MutationObserver(updateNavigation).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
updateNavigation();

api('/api/preferences').then(p=>{preferences=p;}).catch(()=>{}).finally(()=>{readURL();updatePreset();refreshOptions().then(()=>refresh(true));});
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refresh();},5000);
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refreshOptions();},30000);

for(const key of ['chart_type','app_mode','detail_mode'])$(key).onchange=async()=>{
  state[key]=$(key).value;if(key==='app_mode'){state.app='';fillOptions();}preferences[key]=state[key];changed();
  try{await post('/api/preferences',{[key]:state[key]});}catch(e){toast('偏好未保存：'+e.message);}
};
