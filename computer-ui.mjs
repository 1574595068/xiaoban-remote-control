import {ComputerClient,computerConfig,validComputerId} from './computer-channel.mjs?v=20261026.6';
const $=id=>document.getElementById(id);
export function classifyComputerRequest(text){
  text=text.trim();
  if(/不|别|禁止|如何|怎么|是否|能否|可以吗|[?？]$|吗[。！!]*$/.test(text))return null;
  if(!/^(?:小伴[，,\s]*)?(?:请|帮我|麻烦|给|把|将|打开|启动|唤醒|开启|截图|截屏|截个|截一张|刷新)/.test(text)&&!/^电脑[12一二]?(?:开机|唤醒)[。！!]*$/.test(text))return null;
  const wake=/(?:打开|启动|唤醒|开启).{0,15}电脑|电脑.{0,12}(?:开机|唤醒)|给电脑[12一二]?开机/.test(text);
  const app=/(?:打开|启动|开启).{0,12}连连控/.test(text),capture=/截图|截屏|截个图|截一张图/.test(text);
  if(wake)return app||capture?'full':'wake';
  if(app)return capture?'open_capture':'open_asklink';
  if(capture&&/连连控/.test(text))return 'capture_asklink';
  return null;
}
export async function attachComputer(base,{requestBoard,selectTab,boardState=()=>({online:true,ready:true}),previousSaves=[]}){
  let profiles=[],revision=-1,editorRevision=-1,editorBase=null,selected='',client=null,running=false,saving=false,closed=false,sequence=0,dirty=false,draft=null,conflict=false,saveState='',saveStarted=0;
  const DRAFTS='xiaoban.computer.edits.v1';let edits={};
  const validEdit=(id,e)=>validComputerId(id)&&e?.profile?.id===id&&typeof e.profile.name==='string'&&e.profile.name.length<=60&&typeof e.profile.mac==='string'&&e.profile.mac.length<=32&&['local','other','unconfirmed'].includes(e.profile.wake_scope);
  try{
    const saved=JSON.parse(localStorage.getItem(DRAFTS)||'null');
    if(saved?.board===base.topic&&saved.edits&&typeof saved.edits==='object')edits=Object.fromEntries(Object.entries(saved.edits).filter(([id,e])=>validEdit(id,e)).slice(0,8));
  }catch{}
  const seen=new Set();
  for(const command of [...previousSaves].reverse()){
    const p=command.payload?.profile;if(!p||seen.has(p.id))continue;seen.add(p.id);
    if(command.status!=='done'&&!edits[p.id]&&validEdit(p.id,{profile:p}))edits[p.id]={profile:p,revision:command.payload.revision};
  }
  const clients=new Set();
  function current(){return profiles.find(p=>p.id===selected);}
  function same(a,b){return !!a&&!!b&&['id','name','wake_scope'].every(k=>a[k]===b[k])&&String(a.mac).replace(/[-:\s]/g,'').toUpperCase()===String(b.mac).replace(/[-:\s]/g,'').toUpperCase();}
  function fields(){return {id:selected,name:$('pc-name').value.trim(),mac:$('pc-mac').value.trim().toUpperCase(),wake_scope:$('pc-network').value};}
  function persist(){try{localStorage.setItem(DRAFTS,JSON.stringify({board:base.topic,edits}));}catch{}}
  function rememberEdit(){if(!selected)return;edits[selected]={profile:fields(),base:editorBase,revision:editorRevision};persist();}
  function feedback(text,state=''){
    saveState=state;$('pc-settings-result').textContent=text;$('pc-settings-result').dataset.state=state;renderSave();
  }
  function renderSave(){
    const state=boardState(),button=$('pc-save');
    button.setAttribute('aria-busy',String(saving));
    if(saving){
      const elapsed=Math.floor((Date.now()-saveStarted)/1000);
      button.textContent=state.online?(state.ready?'正在保存…':'等待板子处理…'):'等待板子连接…';
      $('pc-settings-result').textContent=(state.online?(state.ready?'正在等板子确认保存':'板子正在处理其他指令，稍后自动保存'):'板子暂时没有连接，联网后自动保存')+' · 已等待 '+elapsed+' 秒。填写内容已保留。';
    }else button.textContent=running?'等待当前操作完成…':!current()?'等待板子读取配置…':conflict?'确认保存我的填写':saveState==='success'?'已保存到板子':saveState==='error'?'重试保存':'保存到板子';
    $('pc-save-hint').textContent=running&&!saving?'当前电脑操作尚未结束，结束后才能保存。':!current()?'连接板子后会显示已保存的电脑。':state.pending&&!saving?'板子正在处理「'+state.pending+'」。填写内容会保留，请等它完成后保存。':'';
  }
  function message(text){$('pc-result').textContent=text;}
  function busy(value){
    running=value;$('pc-target').disabled=value||!profiles.length;
    for(const b of document.querySelectorAll('[data-pc-action],#pc-save,#pc-add,#pc-import,#pc-name,#pc-mac,#pc-network,#pc-use-detected,#pc-export'))b.disabled=value||!current();
    $('pc-use-saved').disabled=value;$('pc-use-saved').hidden=!dirty;renderSave();
  }
  function renderStatus(){
    const p=current();if(!p)return;
    const fresh=!!client?.online(),s=client?.last?.status||{};
    const mismatch=fresh&&p.mac&&s.ethernet_mac&&p.mac!==s.ethernet_mac;
    $('pc-status').textContent=p.name+' · '+(mismatch?'助手网卡与所选电脑不一致，请核对配置':fresh?(s.desktop_unlocked?'桌面助手在线':'助手在线，Windows 尚未解锁'):'尚未收到桌面助手心跳，不能据此判断电脑是否关机');
    $('pc-status').className='pc-state'+(fresh&&!mismatch?' connected':'');
    $('pc-target-info').textContent=p.mac?(p.wake_scope==='local'?'有线网卡 '+p.mac+' · 与板子在同一路由器':p.wake_scope==='other'?'位于其他网络：这块板子不能唤醒它':'请确认这台电脑与板子的网络关系'):'尚未接入：请在这台电脑上运行接入包，再使用检测信息。';
    $('pc-use-detected').hidden=!(fresh&&s.ethernet_mac);
  }
  function fill(){
    const p=current();if(!p)return;
    const edit=edits[selected],alreadySaved=edit&&same(edit.profile,p);
    if(alreadySaved){delete edits[selected];persist();}
    const restored=edits[selected],value=restored?.profile||p;
    $('pc-name').value=value.name;$('pc-mac').value=value.mac;$('pc-network').value=value.wake_scope;
    editorBase=restored?restored.base:{...p};editorRevision=restored?restored.revision:revision;dirty=!!restored;
    conflict=dirty&&!same(editorBase,p)&&editorBase!==null;
    if(dirty&&!conflict)editorRevision=revision;
    feedback(conflict?'这台电脑的板上配置已改变。你的填写已保留，请核对后再保存。':dirty?'已恢复尚未保存的填写。核对后点击保存到板子。':alreadySaved?'已从板子读回并核对：你的填写已保存。':'',conflict?'error':alreadySaved?'success':'');
    $('pc-use-saved').hidden=!dirty;
  }
  async function switchTo(id){
    const p=profiles.find(p=>p.id===id);if(!p||running)return;
    selected=id;$('pc-target').value=id;
    try{localStorage.setItem('xiaoban.computer.selected.v2',id);}catch{}
    const turn=++sequence;if(client){client.close();clients.delete(client);}
    $('pc-picture').hidden=true;$('pc-image').removeAttribute('src');
    fill();message('接下来只操作「'+p.name+'」。');busy(false);
    const next=new ComputerClient(base,{id,onStatus:()=>{if(turn===sequence)renderStatus();}});
    client=next;clients.add(next);renderStatus();await next.start();
    if(closed||turn!==sequence){next.close();clients.delete(next);}
  }
  function applyProfiles(status){
    if(!Array.isArray(status?.computer_profiles)||!Number.isInteger(status.computer_revision)||status.computer_revision<revision)return;
    const incoming=status.computer_profiles.filter(p=>validComputerId(p.id)&&typeof p.name==='string'&&p.name.length<=30&&typeof p.mac==='string'&&['local','other','unconfirmed'].includes(p.wake_scope)).slice(0,8);
    for(const edit of Object.values(edits)){
      const p=edit?.profile;
      if(p&&validComputerId(p.id)&&typeof p.name==='string'&&p.name.length<=60&&!incoming.some(x=>x.id===p.id)&&incoming.length<8)incoming.push({...p});
    }
    if(draft&&!incoming.some(p=>p.id===draft.id)&&incoming.length<8)incoming.push(draft);
    if(!incoming.length)return;
    if(JSON.stringify(incoming)===JSON.stringify(profiles)&&revision===status.computer_revision)return;
    profiles=incoming;revision=status.computer_revision;
    const select=$('pc-target');select.replaceChildren();
    for(const p of profiles){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+(p.mac?'':'（待接入）');select.append(o);}
    if(!profiles.some(p=>p.id===selected)){
      let saved;try{saved=localStorage.getItem('xiaoban.computer.selected.v2');}catch{}
      void switchTo(profiles.some(p=>p.id===saved)?saved:profiles[0].id);
    }else{
      select.value=selected;
      if(dirty&&!saving){
        const p=current();
        if(same(fields(),p)){fill();}
        else {
          conflict=!same(editorBase,p)&&editorBase!==null;
          if(!conflict){editorRevision=revision;rememberEdit();}
          else feedback('这台电脑的板上配置已改变。你的填写已保留，请核对后点击“确认保存我的填写”。','error');
        }
      }else if(!dirty&&!running){
        const result=$('pc-settings-result').textContent,state=saveState;fill();
        if(result)feedback(result,state);
      }
    }
    busy(running);renderStatus();
  }
  async function waitOnline(target,deadline,after=0){
    while(Date.now()<deadline){
      if(closed)throw Error('页面已关闭，停止等待。');
      if(target.online()&&target.last.sent_at>=after)return;
      await new Promise(r=>setTimeout(r,500));
    }
    throw Error('板子已发送唤醒包，但 90 秒内未收到这台电脑的桌面助手回执。请检查主板网络唤醒设置；若已亮机但停在登录界面，请先通过连连控登录。');
  }
  async function run(action){
    selectTab('computer');if(running)return;
    const p=current();if(!p){message('正在读取板子保存的电脑列表，请稍等。');return;}
    const target={...p},receiver=client;
    const wake=action==='wake'||action==='full';
    if(wake&&(!p.mac||p.wake_scope!=='local')){
      $('pc-settings').open=true;message(p.name+'尚未完成开机配置。填写有线网卡地址，并确认与板子在同一路由器下。');return;
    }
    busy(true);$('pc-picture').hidden=true;$('pc-image').removeAttribute('src');
    try{
      if(receiver?.online()&&target.mac&&receiver.last.status.ethernet_mac!==target.mac)throw Error('助手报告的网卡与所选电脑不一致，请先核对配置。');
      if(wake){
        const wakeStarted=Date.now();
        message('「'+target.name+'」正在等待板子确认收到开机指令…');
        const result=await requestBoard('pc_wake',{computer_id:target.id,expected_mac:target.mac});
        if(result.computer_id!==target.id)throw Error('板子的回执不属于所选电脑，已停止后续操作。');
        message('「'+target.name+'」板子已发送 '+result.packets_sent+' 个唤醒包；正在等待这台电脑的桌面助手上线，尚未确认开机。');
        await waitOnline(receiver,Date.now()+90000,wakeStarted);
      }
      if(action==='wake'){message('「'+target.name+'」桌面助手已在线。');return;}
      message('「'+target.name+'」正在等待电脑执行'+(action==='open_asklink'?'打开连连控':'连连控截图')+'…');
      const result=await receiver.run(action==='full'?'open_capture':action,{timeout:45000,expectedMac:target.mac||null});
      message('「'+target.name+'」'+(result.text||'已完成。'));
      const shot=result.image;
      if(shot){
        if(shot.mime!=='image/jpeg'||typeof shot.base64!=='string'||shot.base64.length>200000||!/^[A-Za-z0-9+/=]+$/.test(shot.base64))throw Error('截图数据无效，请重新获取。');
        $('pc-image').src='data:image/jpeg;base64,'+shot.base64;
        $('pc-image').alt=target.name+'返回的连连控窗口截图';
        $('pc-caption').textContent=target.name+' · 连连控窗口 · '+new Date(shot.captured_at).toLocaleString('zh-CN');
        $('pc-picture').hidden=false;
      }
    }catch(e){message('「'+target.name+'」'+(e.message||'操作失败，请重试。'));}
    finally{busy(false);renderStatus();}
  }
  $('pc-target').onchange=()=>void switchTo($('pc-target').value);
  function changed(){
    dirty=true;for(const id of ['pc-name','pc-mac','pc-network'])$(id).removeAttribute('aria-invalid');
    rememberEdit();$('pc-use-saved').hidden=false;
    feedback(conflict?'板上配置已改变，你的填写已保留。核对后确认保存。':'有未保存的修改，点击下方按钮保存到板子。',conflict?'error':'');
  }
  for(const id of ['pc-name','pc-mac','pc-network'])$(id).oninput=changed;
  $('pc-add').onclick=()=>{
    if(running||profiles.length>=8)return;
    const id='pc-'+crypto.randomUUID().slice(0,12),name='电脑'+(profiles.length+1);
    draft={id,name,mac:'',wake_scope:'unconfirmed'};profiles.push(draft);
    const o=document.createElement('option');o.value=id;o.textContent=name+'（待保存）';$('pc-target').append(o);
    void switchTo(id);editorBase=null;dirty=true;rememberEdit();$('pc-use-saved').hidden=false;$('pc-settings').open=true;
  };
  $('pc-use-detected').onclick=()=>{
    const s=client?.last?.status;if(!client?.online()||!s?.ethernet_mac)return;
    $('pc-mac').value=s.ethernet_mac;changed();
    feedback('已填入当前电脑助手检测到的网卡。确认网络位置后，点击保存。');
  };
  $('pc-import').onchange=async()=>{
    const file=$('pc-import').files?.[0];if(!file)return;
    try{
      if(file.size>8192)throw Error('电脑信息文件过大。');
      const data=JSON.parse(await file.text());
      if(data.id!==selected||typeof data.mac!=='string'||!/^(?:[0-9A-F]{2}-){5}[0-9A-F]{2}$/i.test(data.mac))throw Error('文件不属于当前选择的电脑，请先选择正确的电脑。');
      $('pc-mac').value=data.mac.toUpperCase();changed();
      feedback('已读取网卡信息。确认网络位置后，点击保存。');
    }catch(e){feedback(e.message,'error');}
    finally{$('pc-import').value='';}
  };
  $('pc-use-saved').onclick=()=>{
    if(running)return;
    if(editorBase===null){feedback('这台电脑还没有保存在板子上，请先填写网卡地址并保存。');return;}
    delete edits[selected];persist();fill();busy(false);
  };
  function validated(){
    const profile=fields(),raw=profile.mac.replace(/[-:\s]/g,'');
    function invalid(id,text){$(id).setAttribute('aria-invalid','true');$(id).focus();throw Error(text);}
    if(!profile.name||Array.from(profile.name).length>30||/[\x00-\x1f]/.test(profile.name))invalid('pc-name','请填写 1 到 30 个字的电脑名称。');
    if(!raw)invalid('pc-mac','还没有填写有线网卡地址。请在这台电脑运行接入包，然后导入“电脑信息.json”或使用检测到的网卡。');
    if(!/^[0-9A-F]{12}$/.test(raw)||raw==='000000000000'||(parseInt(raw.slice(0,2),16)&1))invalid('pc-mac','网卡地址不正确，请填写有线网卡的 MAC 地址，例如 AA-BB-CC-DD-EE-10。');
    profile.mac=raw.match(/../g).join('-');
    if(profiles.some(p=>p.id!==selected&&p.mac===profile.mac))invalid('pc-mac','这个网卡已用于另一台电脑。请填写当前所选电脑的有线网卡地址。');
    if(profiles.some(p=>p.id!==selected&&p.name===profile.name))invalid('pc-name','这个名称已用于另一台电脑，请换一个名称。');
    return profile;
  }
  $('pc-save').onclick=async()=>{
    if(running){renderSave();return;}
    const p=current();if(!p){feedback('尚未读到板子的电脑列表，连接后再保存。','error');return;}
    let profile;
    try{profile=validated();}catch(e){dirty=true;rememberEdit();feedback(e.message,'error');return;}
    dirty=true;rememberEdit();saving=true;saveStarted=Date.now();busy(true);feedback('正在保存到板子…');
    try{
      let result;
      try{result=await requestBoard('pc_save',{profile,revision:conflict?revision:editorRevision});}
      catch(e){
        if(!/配置已在其他页面更新/.test(e.message))throw e;
        const latest=await requestBoard('pc_list',{});applyProfiles(latest);
        const actual=latest.computer_profiles?.find(x=>x.id===profile.id);
        if(same(actual,profile))result=latest;
        else if(same(actual,editorBase))result=await requestBoard('pc_save',{profile,revision:latest.computer_revision});
        else {conflict=true;throw Error('另一页面刚修改了这台电脑。你的填写已保留，核对后点击“确认保存我的填写”，或使用板子上的配置。');}
      }
      if(!Number.isInteger(result.computer_revision)||!same(result.computer_profiles?.find(x=>x.id===profile.id),profile))throw Error('板子返回的配置与填写不一致，尚未确认保存。内容已保留，请重试。');
      delete edits[selected];persist();dirty=false;conflict=false;draft=null;applyProfiles(result);editorRevision=revision;editorBase={...profile};
      $('pc-mac').value=profile.mac;saving=false;
      const text='「'+profile.name+'」已保存到板子，并已核对网卡地址 '+profile.mac+'。';
      feedback(text,'success');message(text);
    }catch(e){saving=false;rememberEdit();feedback(e.message||'保存失败，填写内容已保留，请重试。','error');}
    finally{saving=false;busy(false);renderStatus();}
  };
  $('pc-export').onclick=async()=>{
    if(running)return;
    const p=current();if(!p)return;
    const seed={version:2,id:p.id,name:p.name,channel:await computerConfig(base,p.id)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(seed,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='computer-pairing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('pc-settings-result').textContent='将配对文件放入这台电脑的接入包文件夹，再运行“安装此电脑”。该文件只控制当前所选电脑，请自行保管。';
  };
  for(const button of document.querySelectorAll('[data-pc-action]'))button.onclick=()=>void run(button.dataset.pcAction);
  busy(false);
  return {
    onBoard:packet=>applyProfiles(packet.status),
    refresh:renderSave,
    close:()=>{closed=true;sequence++;for(const c of clients)c.close();clients.clear();},
    handleText:text=>{
      const action=classifyComputerRequest(text);if(!action)return false;
      selectTab('computer');
      if(/两台|全部|所有|一起/.test(text)){message('请先选择一台电脑，再发送操作指令。');return true;}
      const named=profiles.filter(p=>text.includes(p.name));
      const number=text.match(/电脑\s*([12一二])/);
      let id=named.length===1?named[0].id:number?('pc-'+({'一':1,'二':2}[number[1]]||number[1])):selected;
      if(named.length>1||!profiles.some(p=>p.id===id)){message('没有找到唯一的目标电脑，请在上方选择。');return true;}
      if(running){message('正在执行上一条电脑指令，请等待结果。');return true;}
      void (async()=>{if(id!==selected)await switchTo(id);await run(action);})();
      return true;
    }
  };
}
