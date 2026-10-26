import mqtt from './mqtt.esm.mjs';
const enc = new TextEncoder(), dec = new TextDecoder();
let clockCalibration,goodClock;
function usableClock(){
  if(!goodClock)return false;
  const elapsed=Date.now()-goodClock.localAt;
  return elapsed>=0&&elapsed<300000&&Math.abs(elapsed-(performance.now()-goodClock.monotonicAt))<5000;
}
async function networkClock(force=false){
  if(typeof window==='undefined')return {offset:0,synced:false};
  if(!force&&usableClock())return goodClock;
  if(!clockCalibration)clockCalibration=(async()=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000),started=Date.now();
    try{
      const url=new URL('./index.html',import.meta.url);url.searchParams.set('clock',crypto.randomUUID());
      const response=await fetch(url,{method:'HEAD',cache:'no-store',signal:controller.signal});
      const serverTime=Date.parse(response.headers.get('Date'));
      if(!response.ok||!Number.isFinite(serverTime))throw Error('Clock unavailable');
      goodClock={offset:serverTime-(started+Date.now())/2,synced:true,localAt:Date.now(),monotonicAt:performance.now()};
      return goodClock;
    }catch{return usableClock()?goodClock:{offset:0,synced:false};}
    finally{clearTimeout(timeout);}
  })();
  const current=clockCalibration;
  try{return await current;}finally{if(clockCalibration===current)clockCalibration=null;}
}
const hex = a => Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
const bytes = h => {
  if (typeof h !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(h)) throw Error('Invalid hex');
  return Uint8Array.from(h.match(/../g), x => parseInt(x,16));
};
const concat = (...arrays) => {const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length;}return out;};
export function decodePair(value) {
  if(typeof value!=='string'||value.length>400||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('专属链接无效，请重新扫描二维码。');
  const b=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const topic=dec.decode(b.slice(65));
  if(b[0]!==1||b.length<73||!/^[A-Za-z0-9_/-]{8,128}$/.test(topic))throw Error('专属链接无效，请重新扫描二维码。');
  return {enc:hex(b.slice(1,33)),mac:hex(b.slice(33,65)),topic};
}
export async function codec(config) {
  const aes=await crypto.subtle.importKey('raw',bytes(config.enc),'AES-CBC',false,['encrypt','decrypt']);
  const mac=await crypto.subtle.importKey('raw',bytes(config.mac),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  return {
    async seal(value,direction='server') {
      const iv=crypto.getRandomValues(new Uint8Array(16));
      const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},aes,enc.encode(JSON.stringify(value))));
      const signature=new Uint8Array(await crypto.subtle.sign('HMAC',mac,concat(enc.encode(direction),iv,ciphertext)));
      return enc.encode(JSON.stringify({v:1,iv:hex(iv),c:hex(ciphertext),m:hex(signature)}));
    },
    async open(raw,direction='device',now=Date.now()) {
      if(raw.length>600000)throw Error('Message too large');
      const v=JSON.parse(dec.decode(raw));
      if(v.v!==1)throw Error('Unknown message version');
      const iv=bytes(v.iv),ciphertext=bytes(v.c),signature=bytes(v.m);
      if(iv.length!==16||signature.length!==32||ciphertext.length%16)throw Error('Invalid envelope');
      if(!await crypto.subtle.verify('HMAC',mac,signature,concat(enc.encode(direction),iv,ciphertext)))throw Error('Invalid authentication');
      const plain=await crypto.subtle.decrypt({name:'AES-CBC',iv},aes,ciphertext);
      const value=JSON.parse(dec.decode(plain));
      if(!Number.isFinite(value.sent_at)||Math.abs(now-value.sent_at)>600000)throw Error('Expired message');
      return value;
    }
  };
}
export class DeviceChannel {
  constructor(config,{onPacket=()=>{},onState=()=>{},onClock=()=>{},inbound='device',outbound='server',requireStatus=true,mqttConnect=mqtt.connect,publishTimeoutMs=12000}={}) {
    this.config=config;this.onPacket=onPacket;this.onState=onState;this.onClock=onClock;
    this.inbound=inbound;this.outbound=outbound;this.requireStatus=requireStatus;this.mqttConnect=mqttConnect;
    this.publishTimeoutMs=publishTimeoutMs;this.chain=Promise.resolve();this.closed=false;this.connected=false;
    this.lastRxAt=0;this.epoch=0;this.pendingPublishes=new Set();
  }
  async start(){
    this.crypto=await codec(this.config);await this.syncClock();
    if(this.closed)return;
    this.connect();
    this.monitor=setInterval(()=>{
      if(!this.clockSynchronized||Date.now()-this.clockCheckedAt>=300000)void this.syncClock();
      if(this.connected&&Date.now()-this.lastRxAt>45000)this.reconnect();
    },15000);
  }
  async syncClock(force=false){
    if(this.clockRequest)return this.clockRequest;
    this.clockPending=true;
    this.clockRequest=(async()=>{
      try{const clock=await networkClock(force);this.clockOffset=clock.offset;this.clockSynchronized=clock.synced;this.clockCheckedAt=Date.now();}
      finally{this.clockPending=false;this.clockRequest=null;if(!this.closed)this.onClock();}
    })();
    return this.clockRequest;
  }
  invalidate(message='连接已中断，尚未确认服务器收到指令。'){
    this.connected=false;this.epoch++;clearTimeout(this.subscriptionTimer);
    for(const pending of [...this.pendingPublishes])pending.finish(Error(message),true);
  }
  connect(){
    if(this.closed||this.client)return;
    this.onState('connecting');
    const client=this.client=this.mqttConnect('wss://broker.emqx.io:8084/mqtt',{
      protocolVersion:4,clean:true,clientId:'xb-web-'+crypto.randomUUID().replace(/-/g,'').slice(0,16),
      keepalive:20,connectTimeout:12000,reconnectPeriod:2000,reconnectOnConnackError:true,forceNativeWebSocket:true,queueQoSZero:false,
      // Subscribe through MQTT.js after every CONNACK so readiness requires that
      // connection's successful SUBACK, rather than an old local subscription.
      resubscribe:false,
      createWebsocket:(url,protocols)=>new globalThis.WebSocket(url,protocols)
    });
    const current=()=>!this.closed&&client===this.client;
    client.on('packetreceive',()=>{if(current())this.lastRxAt=Date.now();});
    client.on('connect',()=>{
      if(!current())return;
      this.invalidate();this.lastRxAt=Date.now();const epoch=this.epoch;
      const topic=this.config.topic+'/'+this.inbound;
      this.subscriptionTimer=setTimeout(()=>{
        if(current()&&epoch===this.epoch&&!this.connected)this.retryConnection('服务器未确认消息订阅。');
      },12000);
      client.subscribe(topic,{qos:1},(error,granted)=>{
        if(!current()||epoch!==this.epoch)return;
        clearTimeout(this.subscriptionTimer);
        if(error||!Array.isArray(granted)||!granted.some(item=>item.topic===topic&&(item.qos===0||item.qos===1))){
          this.retryConnection('服务器拒绝消息订阅。');return;
        }
        this.connected=true;this.onState('connected');
      });
    });
    const disconnected=()=>{
      if(!current())return;this.invalidate();this.onState('reconnecting');
    };
    client.on('offline',disconnected);client.on('close',disconnected);
    client.on('reconnect',()=>{if(!current())return;disconnected();void this.syncClock();});
    client.on('error',error=>{if(current())this.lastError=String(error?.message||'连接失败').slice(0,160);});
    client.on('message',(topic,payload)=>{
      if(!current()||topic!==this.config.topic+'/'+this.inbound)return;
      this.lastRxAt=Date.now();const epoch=this.epoch;
      this.chain=this.chain.then(()=>this.receive(payload,client,epoch)).catch(()=>{});
    });
  }
  retryConnection(message){
    if(this.closed)return;
    this.lastError=message;this.invalidate(message);this.onState('reconnecting');
    const old=this.client;this.client=null;old?.end(true);
    clearTimeout(this.retry);this.retry=setTimeout(()=>this.connect(),2000);
  }
  reconnect(){
    if(this.closed||!this.crypto)return;
    clearTimeout(this.retry);this.invalidate();void this.syncClock(true);
    const old=this.client;this.client=null;old?.end(true);this.connect();
  }
  resume(){
    if(this.closed)return;
    if(!this.connected||Date.now()-this.lastRxAt>20000)this.reconnect();else void this.syncClock(true);
  }
  async receive(payload,client=this.client,epoch=this.epoch){
    if(this.closed||client!==this.client||epoch!==this.epoch)return;
    let value;
    try{value=await this.crypto.open(payload,this.inbound,Date.now()+(this.clockOffset||0));}catch{return;}
    if(this.closed||client!==this.client||epoch!==this.epoch)return;
    if(this.requireStatus&&(typeof value.boot_id!=='string'||!value.status||typeof value.status!=='object'))return;
    this.onPacket({...value,source_sent_at:value.sent_at,sent_at:value.sent_at-(this.clockOffset||0)});
  }
  async send(command=null,acknowledged=[]){return this.sendPacket({command,acknowledged});}
  async sendPacket(value){
    const started=performance.now();
    const ttl=value.command?value.command.expires_at-Date.now():Infinity;
    if(value.command&&(!Number.isFinite(ttl)||ttl<=0))throw Error('指令已经过期，请重新发送。');
    if(this.clockPending)await this.clockRequest;
    const client=this.client,epoch=this.epoch;
    if(this.closed||!this.connected||!client?.connected)throw Error('连接尚未就绪');
    const remaining=()=>ttl-(performance.now()-started);
    if(remaining()<=0)throw Error('指令已经过期，请重新发送。');
    const networkNow=Date.now()+(this.clockOffset||0);
    const command=value.command?{...value.command,expires_at:networkNow+remaining()}:value.command;
    const payload=await this.crypto.seal({...value,...(value.command?{command}:{}),sent_at:networkNow},this.outbound);
    if(this.closed||client!==this.client||epoch!==this.epoch||!this.connected||!client.connected)throw Error('连接已改变，正在重试');
    if(remaining()<=0)throw Error('指令已经过期，请重新发送。');
    if(payload.length>580000)throw Error('消息过大，请降低截图尺寸。');
    return new Promise((resolve,reject)=>{
      let settled=false;
      const pending={id:null,finish:(error,remove=false,ack=null)=>{
        if(settled)return;settled=true;clearTimeout(pending.timer);this.pendingPublishes.delete(pending);
        if(remove&&pending.id!==null)try{client.removeOutgoingMessage(pending.id);}catch{}
        if(error)reject(error);else resolve({messageId:pending.id,brokerAcceptedAt:Date.now(),ack});
      }};
      this.pendingPublishes.add(pending);
      pending.timer=setTimeout(()=>pending.finish(Error('服务器确认超时，尚不能确认指令送达。'),true),Math.max(1,Math.min(this.publishTimeoutMs,remaining())));
      try{
        // MQTT.js invokes the QoS 1 callback only after PUBACK. The app owns
        // retries by command id; cancelled publishes must not survive reconnect.
        client.publish(this.config.topic+'/'+this.outbound,payload,{qos:1,retain:false},(error,ack)=>{
          if(error){pending.finish(Error('服务器未确认收到指令：'+String(error.message||error).slice(0,100)),true);return;}
          if(this.closed||client!==this.client||epoch!==this.epoch){pending.finish(Error('连接已改变，无法确认送达。'),true);return;}
          pending.finish(null,false,ack);
        });
        pending.id=client.getLastMessageId();
        if(!Number.isInteger(pending.id)||pending.id<1)pending.finish(Error('无法跟踪服务器确认。'),true);
      }catch(error){pending.finish(error,true);}
    });
  }
  close(){
    if(this.closed)return;this.closed=true;clearTimeout(this.retry);clearInterval(this.monitor);
    this.invalidate('连接已关闭。');const old=this.client;this.client=null;old?.end(true);
  }
}
