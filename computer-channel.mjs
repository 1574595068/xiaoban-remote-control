import {DeviceChannel} from './transport.mjs';
export async function computerConfig(base){
  async function derive(secret,label){
    const bytes=Uint8Array.from(secret.match(/../g),h=>parseInt(h,16));
    const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const value=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('xiaoban-computer-v1:'+label)));
    return Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
  }
  return {enc:await derive(base.enc,'encryption'),mac:await derive(base.mac,'authentication'),topic:base.topic+'/computer-v1'};
}
export class ComputerClient {
  constructor(base,{onStatus=()=>{}}={}){this.base=base;this.onStatus=onStatus;this.pending=new Map();this.last=null;}
  async start(){
    this.channel=new DeviceChannel(await computerConfig(this.base),{onPacket:p=>{void this.receive(p);},onState:()=>this.onStatus(this.last)});
    await this.channel.start();
    this.timer=setInterval(()=>{this.onStatus(this.last);void this.pump();},2000);
  }
  online(){return this.channel?.connected&&this.last&&Date.now()-this.last.sent_at<30000;}
  async receive(packet){
    if(Date.now()-packet.sent_at>30000)return;
    this.last=packet;this.onStatus(packet);
    for(const receipt of packet.results||[]){
      const job=this.pending.get(receipt.id);
      if(!job||!['done','error'].includes(receipt.state))continue;
      this.pending.delete(receipt.id);
      if(receipt.state==='done')job.resolve(receipt.result);else job.reject(Error(receipt.result?.error||'电脑执行失败。'));
      try{await this.channel.send(null,[receipt.id]);}catch{}
    }
    void this.pump();
  }
  run(kind,{timeout=180000}={}){
    if(!['status','open_asklink','capture_asklink','open_capture'].includes(kind))return Promise.reject(Error('不支持的电脑操作'));
    if(this.pending.size)return Promise.reject(Error('正在处理上一条电脑指令，请稍等。'));
    return new Promise((resolve,reject)=>{const id=crypto.randomUUID();this.pending.set(id,{command:{id,kind,expires_at:Date.now()+timeout},lastSent:0,resolve,reject});void this.pump();});
  }
  async pump(){
    for(const [id,job] of this.pending){
      if(Date.now()>job.command.expires_at){this.pending.delete(id);job.reject(Error('未等到电脑桌面助手上线。请确认电脑已开机，并通过连连控登录或解锁 Windows。'));continue;}
      if(!this.online()||Date.now()-job.lastSent<8000)continue;
      job.lastSent=Date.now();try{await this.channel.send(job.command);}catch{}
    }
  }
  close(){clearInterval(this.timer);this.channel?.close();for(const job of this.pending.values())job.reject(Error('连接已关闭。'));this.pending.clear();}
}
