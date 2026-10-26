import {ComputerClient} from './computer-channel.mjs?v=20261026.3';
const $=id=>document.getElementById(id);
export function classifyComputerRequest(text){
  text=text.trim();
  if(/不|别|禁止|如何|怎么|是否|能否|可以吗|[?？]$|吗[。！!]*$/.test(text))return null;
  if(!/^(?:小伴[，,\s]*)?(?:请|帮我|麻烦|给|把|将|打开|启动|唤醒|开启|截图|截屏|截个|截一张|刷新)/.test(text)&&!/^电脑(?:开机|唤醒)[。！!]*$/.test(text))return null;
  const wake=/(?:打开|启动|唤醒|开启)(?:我的|这台)?电脑|电脑.{0,12}(?:开机|唤醒)|给电脑开机/.test(text);
  const app=/(?:打开|启动|开启).{0,12}连连控/.test(text);
  const capture=/截图|截屏|截个图|截一张图/.test(text);
  if(wake)return app||capture?'full':'wake';
  if(app)return capture?'open_capture':'open_asklink';
  if(capture&&/连连控/.test(text))return 'capture_asklink';
  return null;
}
export async function attachComputer(base,{enqueueWake,selectTab}){
  let running=false;
  const client=new ComputerClient(base,{onStatus:packet=>{
    const online=client.online();
    $('pc-status').textContent=online?(packet.status.desktop_unlocked?'电脑桌面在线':'电脑已上线，等待解锁'):'等待电脑桌面助手上线';
    $('pc-status').className=online?'pc-state connected':'pc-state';
  }});
  async function run(action){
    selectTab('computer');
    if(running)return;
    if(action==='wake'||action==='full'){
      if(!enqueueWake()){$('pc-result').textContent='请等上一条板子指令处理完成后，再发送开机指令。';return;}
      $('pc-result').textContent='开机指令已排队，等待板子回执。电脑开机后，若停在 Windows 登录界面，请先通过连连控登录。';
      if(action==='wake')return;
    }
    running=true;
    for(const button of document.querySelectorAll('[data-pc-action]'))button.disabled=true;
    $('pc-picture').hidden=true;$('pc-image').removeAttribute('src');
    $('pc-result').textContent=action==='full'?'等待电脑上线并进入桌面，随后打开连连控并截图…':'正在等待电脑执行指令…';
    try{
      const result=await client.run(action==='full'?'open_capture':action);
      $('pc-result').textContent=result.text||'电脑已完成。';
      const shot=result.image;
      if(shot){
        if(shot.mime!=='image/jpeg'||typeof shot.base64!=='string'||shot.base64.length>200000||!/^[A-Za-z0-9+/=]+$/.test(shot.base64))throw Error('截图数据无效，请重新获取。');
        $('pc-image').src='data:image/jpeg;base64,'+shot.base64;
        $('pc-caption').textContent='连连控窗口 · '+new Date(shot.captured_at).toLocaleString('zh-CN')+' · 仅在本页临时显示';
        $('pc-picture').hidden=false;
      }
    }catch(e){$('pc-result').textContent=e.message||'电脑执行失败，请重试。';}
    finally{running=false;for(const button of document.querySelectorAll('[data-pc-action]'))button.disabled=false;}
  }
  for(const button of document.querySelectorAll('[data-pc-action]'))button.onclick=()=>void run(button.dataset.pcAction);
  await client.start();
  return {close:()=>client.close(),handleText:text=>{const action=classifyComputerRequest(text);if(!action)return false;void run(action);return true;}};
}
