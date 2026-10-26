import {ComputerClient,computerConfig,validComputerId} from './computer-channel.mjs?v=20261026.4';
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
export async function attachComputer(base,{requestBoard,selectTab}){
  let profiles=[],revision=-1,editorRevision=-1,selected='',client=null,running=false,closed=false,sequence=0,dirty=false,draft=null;
  const clients=new Set();
  function current(){return profiles.find(p=>p.id===selected);}
  function message(text){$('pc-result').textContent=text;}
  function busy(value){
    running=value;$('pc-target').disabled=value||!profiles.length;
    for(const b of document.querySelectorAll('[data-pc-action],#pc-save,#pc-add,#pc-import,#pc-name,#pc-mac,#pc-network,#pc-use-detected,#pc-export'))b.disabled=value||!current();
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
    $('pc-name').value=p.name;$('pc-mac').value=p.mac;$('pc-network').value=p.wake_scope;
    editorRevision=revision;dirty=false;$('pc-settings-result').textContent='';
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
    if(draft&&!incoming.some(p=>p.id===draft.id)&&incoming.length<8)incoming.push(draft);
    if(!incoming.length)return;
    if(JSON.stringify(incoming)===JSON.stringify(profiles)&&revision===status.computer_revision)return;
    profiles=incoming;revision=status.computer_revision;
    const select=$('pc-target');select.replaceChildren();
    for(const p of profiles){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+(p.mac?'':'（待接入）');select.append(o);}
    if(!profiles.some(p=>p.id===selected)){
      let saved;try{saved=localStorage.getItem('xiaoban.computer.selected.v2');}catch{}
      void switchTo(profiles.some(p=>p.id===saved)?saved:profiles[0].id);
    }else{select.value=selected;if(!dirty&&!running)fill();}
    busy(running);renderStatus();
  }
  async function waitOnline(target,deadline){
    while(Date.now()<deadline){
      if(closed)throw Error('页面已关闭，停止等待。');
      if(target.online())return;
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
      if(wake&&!receiver.online()){
        message('「'+target.name+'」正在等待板子确认收到开机指令…');
        const result=await requestBoard('pc_wake',{computer_id:target.id,expected_mac:target.mac});
        if(result.computer_id!==target.id)throw Error('板子的回执不属于所选电脑，已停止后续操作。');
        message('「'+target.name+'」板子已发送 '+result.packets_sent+' 个唤醒包；正在等待这台电脑的桌面助手上线，尚未确认开机。');
        await waitOnline(receiver,Date.now()+90000);
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
  for(const id of ['pc-name','pc-mac','pc-network'])$(id).oninput=()=>{dirty=true;};
  $('pc-add').onclick=()=>{
    if(running||profiles.length>=8)return;
    const id='pc-'+crypto.randomUUID().slice(0,12),name='电脑'+(profiles.length+1);
    draft={id,name,mac:'',wake_scope:'unconfirmed'};profiles.push(draft);
    const o=document.createElement('option');o.value=id;o.textContent=name+'（待保存）';$('pc-target').append(o);
    void switchTo(id);$('pc-settings').open=true;
  };
  $('pc-use-detected').onclick=()=>{
    const s=client?.last?.status;if(!client?.online()||!s?.ethernet_mac)return;
    $('pc-mac').value=s.ethernet_mac;dirty=true;
    $('pc-settings-result').textContent='已填入当前电脑助手检测到的网卡。确认网络位置后，点击保存。';
  };
  $('pc-import').onchange=async()=>{
    const file=$('pc-import').files?.[0];if(!file)return;
    try{
      if(file.size>8192)throw Error('电脑信息文件过大。');
      const data=JSON.parse(await file.text());
      if(data.id!==selected||typeof data.mac!=='string'||!/^(?:[0-9A-F]{2}-){5}[0-9A-F]{2}$/i.test(data.mac))throw Error('文件不属于当前选择的电脑，请先选择正确的电脑。');
      $('pc-mac').value=data.mac.toUpperCase();dirty=true;
      $('pc-settings-result').textContent='已读取网卡信息。确认网络位置后，点击保存。';
    }catch(e){$('pc-settings-result').textContent=e.message;}
    finally{$('pc-import').value='';}
  };
  $('pc-save').onclick=async()=>{
    if(running)return;
    const p=current();if(!p)return;
    const profile={id:p.id,name:$('pc-name').value.trim(),mac:$('pc-mac').value.trim().toUpperCase(),wake_scope:$('pc-network').value};
    busy(true);$('pc-settings-result').textContent='正在保存到板子…';
    try{
      const result=await requestBoard('pc_save',{profile,revision:editorRevision});
      dirty=false;draft=null;applyProfiles(result);editorRevision=revision;
      $('pc-settings-result').textContent=result.text;message(result.text);
    }catch(e){$('pc-settings-result').textContent=e.message;}
    finally{busy(false);renderStatus();}
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
