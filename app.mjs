import {DeviceChannel,decodePair} from './transport.mjs?v=20261026.8';
import {attachComputer} from './computer-ui.mjs?v=20261026.8';
const $=id=>document.getElementById(id), PAIR='xiaoban.remote.pair.v1', HISTORY='xiaoban.remote.history.v1';
const BUILD=document.documentElement.dataset.build;
const labels={pc_wake:'发送电脑唤醒包',pc_list:'读取电脑列表',pc_save:'保存电脑配置',chat:'对话',remember:'保存记忆',forget:'删除记忆',memories:'读取记忆',status:'刷新状态',restart:'重启板子',clear:'开始新对话'};
const boardWaiters=new Map();
const states={queued:'等待板子连接',running:'等待板子回复',done:'板子已完成',error:'执行失败',expired:'已超时'};
let computerUI;let channel,device=null,channelState='connecting',sending=false,lastSent=0,gateTimer,commands=[];
try{const saved=JSON.parse(localStorage.getItem(HISTORY)||'[]');if(Array.isArray(saved))commands=saved.filter(c=>c&&typeof c.id==='string'&&labels[c.kind]&&Number.isFinite(c.createdAt)&&c.createdAt>Date.now()-7*86400000).slice(-100);}catch{}
function save(){try{localStorage.setItem(HISTORY,JSON.stringify(commands.slice(-100)));}catch{}}
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;}
function button(text,handler,cls='quiet'){const b=element('button',text,cls);b.onclick=handler;return b;}
function time(value){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
function online(){return !!device&&Date.now()-device.sent_at<30000;}
function pending(){return commands.find(c=>['queued','running'].includes(c.status)&&c.expiresAt>Date.now());}
function enqueue(kind,payload={}){
  if(pending()){error('小伴正在处理上一条指令，请稍等它回复。');return false;}
  error();
  const now=Date.now(),id=crypto.randomUUID();commands.push({id,kind,payload,status:'queued',createdAt:now,expiresAt:now+(kind.startsWith('pc_')?90000:600000),result:null});
  commands=commands.filter(c=>c.createdAt>now-7*86400000).slice(-100);lastSent=0;save();renderCommands();void pump();return id;
}
function requestBoard(kind,payload){
  void sendDiagnostic('request_'+kind);
  const id=enqueue(kind,payload);
  if(!id)return Promise.reject(Error('板子正在处理上一条指令，请等待完成后重试。'));
  return new Promise((resolve,reject)=>boardWaiters.set(id,{resolve,reject}));
}
async function sendDiagnostic(event){
  if(!channel?.connected)return;
  try{await channel.sendPacket({client_diagnostic:{event,page_build:BUILD,board_heartbeat_at:device?.sent_at??null,
    pending_kind:pending()?.kind??null,browser_online:navigator.onLine}});}catch{}
}
async function pump(){
  const command=pending();
  if(!command||sending||!channel?.connected||!online()||!device.ready||Date.now()-lastSent<5000)return;
  sending=true;
  try{
    await channel.send({id:command.id,kind:command.kind,payload:command.payload,expires_at:command.expiresAt,source_build:BUILD});
    lastSent=Date.now();command.firstSentAt??=lastSent;command.lastSentAt=lastSent;command.attempts=(command.attempts||0)+1;command.status='running';save();renderCommands();
  }catch{error('连接暂时中断，恢复后会自动重试同一条指令。');}
  finally{sending=false;}
}
function renderStatus(){
  const active=online()&&!!channel?.connected,age=device?Math.max(0,Math.floor((Date.now()-device.sent_at)/1000)):null;
  $('connection').textContent=active?'板子在线':channelState==='connected'?'等待板子':'连接中';
  $('connection').className='pill'+(active?' online':'');
  $('connection-note').hidden=active;
  $('connection-note').textContent=channelState==='connected'?'还未收到板子的在线心跳。请确认板子已供电并联网；开机指令会等待板子连接后发送。':'正在连接板子。电脑控制入口已经可以打开，实际执行需要板子或电脑助手在线。';
  for(const id of ['desktop-device','mobile-device']){
    const box=$(id);box.replaceChildren();
    box.append(element('p',active?(pending()||device.status.busy?'正在处理你的指令…':'我在办公室，随时等你。'):'正在等待板子，请确认它保持供电和联网。','device-note'));
    const stats=element('dl',undefined,'stats'),status=device?.status||{};
    const values=[['最近连接',age===null?'尚未连接':age<60?age+' 秒前':Math.floor(age/60)+' 分钟前'],['已连续运行',status.uptime_seconds===undefined?'—':Math.floor(status.uptime_seconds/60)+' 分钟'],['长期记忆',(status.memory_count??'—')+' 条'],['固件版本',status.agent_version||'—']];
    for(const [name,value] of values){const row=element('div');row.append(element('dt',name),element('dd',value));stats.append(row);}
    const actions=element('div',undefined,'device-actions');
    actions.append(button('刷新状态',()=>enqueue('status')),button('重启板子',()=>{if(confirm('重启小伴？它会自动重新上线，长期记忆会保留。'))enqueue('restart');}));
    box.append(stats,actions);
  }
  $('send').disabled=!!pending();$('save-memory').disabled=!!pending();
  computerUI?.refresh();
  renderDelivery();
}
function diagnosticCommand(c){
  if(!c)return null;
  return {id:c.id,kind:c.kind,computer_id:c.payload?.computer_id,status:c.status,created_at:c.createdAt,
    first_sent_at:c.firstSentAt??null,last_sent_at:c.lastSentAt??null,attempts:c.attempts||0,
    receipt_received_at:c.receiptAt??null,board_completed_at:c.completedAt??null,packets_sent:c.result?.packets_sent??null};
}
function deliveryReport(){
  const wake=device?.status?.last_wake;
  return {page_build:BUILD,checked_at:Date.now(),browser_online:navigator.onLine,channel_state:channelState,
    board_heartbeat_at:device?.sent_at??null,board_online:online()&&!!channel?.connected,
    board_diagnostics_version:device?.status?.delivery_diagnostics_version??0,
    board_last_wake:wake?{id:wake.id,computer_id:wake.computer_id,state:wake.state,completed_at:wake.completed_at??null,source_build:wake.source_build??null,packets_sent:wake.packets_sent??null}:null,
    commands:commands.filter(c=>c.kind==='pc_wake').slice(-8).map(diagnosticCommand)};
}
function renderDelivery(){
  const box=$('delivery-status');if(!box)return;
  const report=deliveryReport(),last=report.commands.at(-1),wake=report.board_last_wake;
  const stamp=t=>t?new Date(t).toLocaleString('zh-CN',{hour12:false}):'尚无记录';
  const rows=[['网页版本',BUILD],['手机／网页连接',channelState==='connected'?'已连接':navigator.onLine?'正在重连':'当前设备没有网络'],
    ['板子心跳',stamp(report.board_heartbeat_at)],['本页最近点击',last?stamp(last.created_at)+' · '+last.computer_id:'尚无开机操作'],
    ['本页发出指令',last?.first_sent_at?stamp(last.first_sent_at)+' · '+last.attempts+' 次尝试':last?'尚未发出，请等板子连接':'尚无记录'],
    ['收到执行回执',stamp(last?.receipt_received_at)],
    ['板子最近执行',wake?(wake.completed_at?stamp(wake.completed_at):'旧记录，未记录执行时间')+' · '+(wake.computer_id||'未记录目标')+' · '+(wake.packets_sent??0)+' 个唤醒包':'尚无记录']];
  box.replaceChildren();for(const [label,value] of rows){const row=element('div');row.append(element('dt',label),element('dd',value));box.append(row);}
  $('delivery-build').textContent='网页 '+BUILD;
  const pendingWake=commands.find(c=>c.kind==='pc_wake'&&['queued','running'].includes(c.status)&&c.expiresAt>Date.now());
  $('delivery-progress').hidden=!pendingWake;
  if(pendingWake)$('delivery-progress').textContent=pendingWake.firstSentAt?'网页已发出指令，正在等板子执行回执 · '+Math.floor((Date.now()-pendingWake.createdAt)/1000)+' 秒。':'指令尚未发出：'+(!channel?.connected?'网页连接未就绪':!online()?'还没收到板子在线心跳':'板子正在处理其他指令')+'。';
}
function speak(text){
  if(!window.speechSynthesis){error('当前浏览器不支持朗读，请使用系统浏览器。');return;}
  speechSynthesis.cancel();const message=new SpeechSynthesisUtterance(text);message.lang='zh-CN';speechSynthesis.speak(message);
}
function renderCommands(){
  const conversation=$('conversation'),wasNearBottom=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<100;
  conversation.replaceChildren();
  const chats=commands.filter(c=>c.kind==='chat');
  if(!chats.length){const welcome=element('div',undefined,'welcome');welcome.append(element('h2','今天，想聊点什么？'),element('p','工作上的难题，突然冒出的好奇心，\n都可以先讲给小伴听。'));conversation.append(welcome);}
  for(const c of chats){
    const reply=element('div',undefined,'assistant-message');reply.append(element('strong','小伴'));
    const text=c.status==='done'?(c.result?.text||'已完成。'):['error','expired'].includes(c.status)?(c.result?.error||'本次没有收到回复，请重试。'):states[c.status];
    reply.append(element('p',text,c.status==='done'?'':['error','expired'].includes(c.status)?'failed':'pending'));
    if(c.status==='done')reply.append(button('朗读',()=>speak(c.result?.text||''),'speak'));
    conversation.append(element('div',c.payload.text,'user-message'),reply);
  }
  if(wasNearBottom||chats.at(-1)?.status==='running')conversation.scrollTop=conversation.scrollHeight;
  const activity=$('activities');activity.replaceChildren();
  for(const c of [...commands].reverse()){const li=element('li');li.append(element('small',time(c.createdAt)),element('strong',labels[c.kind]+' · '+states[c.status]),element('p',c.payload.text||c.result?.text||c.result?.error||'发送到办公室的小伴'));activity.append(li);}
  if(!commands.length)activity.append(element('li','还没有远程操作。','muted'));
  const last=[...commands].reverse().find(c=>c.status==='done'&&Array.isArray(c.result?.items)),memories=$('memories');memories.replaceChildren();
  if(!last)memories.append(element('li','点击“刷新记忆”读取板上内容。','muted'));
  else if(!last.result.items.length)memories.append(element('li','还没有保存的记忆。','muted'));
  else for(const item of last.result.items){const li=element('li');li.append(element('p',item.text),button('删除',()=>{if(confirm('删除这条记忆？\n'+item.text))enqueue('forget',{memoryId:item.id});}));memories.append(li);}
  renderStatus();
}
async function received(packet,pair){
  device=packet;device.sent_at=Math.min(packet.sent_at,Date.now());clearTimeout(gateTimer);
  computerUI?.onBoard(packet);
  let remembered=false;try{localStorage.setItem(PAIR,pair);remembered=true;}catch{}
  if(remembered&&location.hash)history.replaceState(null,'',location.pathname+location.search);
  $('gate').hidden=true;$('control').hidden=false;
  const ack=[];let changed=false;
  for(const receipt of Array.isArray(packet.results)?packet.results:[]){
    const command=commands.find(c=>c.id===receipt.id);
    if(!command||!['done','error'].includes(receipt.state))continue;
    if(command.status!==receipt.state){command.status=receipt.state;command.result=receipt.result||{};command.receiptAt=Date.now();command.completedAt=receipt.completed_at??null;changed=true;
      if(command.kind==='clear'&&receipt.state==='done')commands=commands.filter(c=>c.kind!=='chat'||c.createdAt>=command.createdAt);
    }
    ack.push(receipt.id);
    const waiter=boardWaiters.get(receipt.id);
    if(waiter){boardWaiters.delete(receipt.id);if(receipt.state==='done')waiter.resolve(receipt.result||{});else waiter.reject(Error(receipt.result?.error||'板子执行失败。'));}
  }
  if(ack.length)try{await channel.send(null,ack);}catch{}
  if(changed){save();renderCommands();error();}else renderStatus();
  void pump();
}
async function start(){
  computerUI?.close();channel?.close();clearTimeout(gateTimer);$('retry').hidden=true;
  $('gate-title').textContent='正在连接你的小伴…';$('gate-text').textContent='无需登录任何账号。';
  let pair=new URLSearchParams(location.hash.slice(1)).get('pair');
  if(!pair)try{pair=localStorage.getItem(PAIR);}catch{}
  if(!pair){$('gate-title').textContent='扫码，直接连上小伴。';$('gate-text').textContent='请打开你的完整专属链接，或扫描新的直连二维码。这个浏览器会记住遥控钥匙。';return;}
  try{
    if(!crypto.subtle)throw Error('当前浏览器不支持安全连接，请用手机系统浏览器打开。');
    const config=decodePair(pair);
    $('gate').hidden=true;$('control').hidden=false;
    computerUI=await attachComputer(config,{requestBoard,selectTab:id=>document.querySelector('[data-tab="'+id+'"]').click(),boardState:()=>({online:online()&&!!channel?.connected,ready:!!device?.ready,pending:labels[pending()?.kind]}),previousSaves:commands.filter(c=>c.kind==='pc_save')});
    channel=new DeviceChannel(config,{onPacket:p=>{void received(p,pair).catch(()=>error('消息处理暂时失败，正在重新连接。'));},onState:s=>{channelState=s;renderStatus();if(s==='connected')void sendDiagnostic('connected');}});
    await channel.start();
    gateTimer=setTimeout(()=>{$('gate-title').textContent='正在等待小伴上线';$('gate-text').textContent='请确认板子保持供电和联网。页面会自动重连，专属钥匙仍然保留。';$('retry').hidden=false;},16000);
  }catch(e){$('gate-title').textContent='连接还差一步';$('gate-text').textContent=e.message||'暂时连接不上，请重试。';$('retry').hidden=false;}
}
for(const tab of document.querySelectorAll('[data-tab]'))tab.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));
  for(const id of ['chat','memory','activity','device','computer'])$(id).hidden=id!==tab.dataset.tab;
  if(tab.dataset.tab==='memory'&&!commands.some(c=>Array.isArray(c.result?.items))&&!pending())enqueue('memories');
};
$('pc-entry').onclick=()=>document.querySelector('[data-tab="computer"]').click();
if(new URLSearchParams(location.search).get('view')==='computer')$('pc-entry').click();
$('retry').onclick=()=>void start();
$('delivery-reconnect').onclick=()=>{channel?.reconnect();computerUI?.resume();renderStatus();};
$('delivery-download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(deliveryReport(),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='xiaoban-connection-check.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function submit(){const text=$('draft').value.trim();if(text&&computerUI?.handleText(text)){$('draft').value='';return;}if(text&&enqueue('chat',{text,search:$('search').checked}))$('draft').value='';}
$('send').onclick=submit;$('draft').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit();}};
$('clear').onclick=()=>{if(confirm('开始新对话？清空板子的对话上下文及本浏览器的已完成聊天记录，长期记忆保留。'))enqueue('clear');};
$('read-memory').onclick=()=>enqueue('memories');
$('save-memory').onclick=()=>{const text=$('memory-draft').value.trim();if(text&&enqueue('remember',{text}))$('memory-draft').value='';};
setInterval(()=>{
  let changed=false;for(const c of commands)if(['queued','running'].includes(c.status)&&c.expiresAt<Date.now()){
    c.status='expired';changed=true;
    const detail=c.firstSentAt?'指令已从网页发出，但未收到板子执行回执，不能确认已发送唤醒包。':'指令未从此网页发出，请在“连接与发送记录”中重新连接后重试。';
    c.result={error:'等待超时。'+detail};
    const waiter=boardWaiters.get(c.id);if(waiter){boardWaiters.delete(c.id);waiter.reject(Error(c.result.error));}
  }
  if(changed){save();renderCommands();}else renderStatus();void pump();
},1000);
function resume(){channel?.resume();computerUI?.resume();renderStatus();void pump();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
window.addEventListener('online',resume);window.addEventListener('pageshow',resume);
renderCommands();void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{});
