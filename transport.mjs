const enc = new TextEncoder(), dec = new TextDecoder();
const hex = a => Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
const bytes = h => {
  if (typeof h !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(h)) throw Error('Invalid hex');
  return Uint8Array.from(h.match(/../g), x => parseInt(x,16));
};
const concat = (...arrays) => {const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length;}return out;};
const u16 = n => new Uint8Array([n>>8,n&255]);
const str = text => {const b=enc.encode(text);return concat(u16(b.length),b);};
const frame = (kind, body) => {
  let n=body.length; const header=[kind];
  do {let b=n%128;n=Math.floor(n/128);header.push(b|(n?128:0));} while(n);
  return concat(new Uint8Array(header),body);
};
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
  constructor(config,{onPacket=()=>{},onState=()=>{},inbound='device',outbound='server',requireStatus=true}={}) {
    this.config=config;this.onPacket=onPacket;this.onState=onState;this.inbound=inbound;this.outbound=outbound;this.requireStatus=requireStatus;this.buffer=new Uint8Array();
    this.chain=Promise.resolve();this.sequence=10;this.failures=0;this.closed=false;this.connected=false;this.lastRxAt=0;
  }
  async start(){this.crypto=await codec(this.config);this.connect();}
  connect(){
    if(this.closed)return;
    this.connected=false;this.onState('connecting');this.buffer=new Uint8Array();this.lastRxAt=Date.now();
    const ws=this.ws=new WebSocket('wss://broker.emqx.io:8084/mqtt','mqtt');
    ws.binaryType='arraybuffer';
    this.deadline=setTimeout(()=>{if(ws===this.ws&&!this.connected)ws.close();},12000);
    ws.onopen=()=>ws.send(frame(0x10,concat(new Uint8Array([0,4,77,81,84,84,4,2,0,30]),str('xb-web-'+crypto.randomUUID().replace(/-/g,'').slice(0,16)))));
    ws.onmessage=e=>{
      if(ws!==this.ws)return;this.lastRxAt=Date.now();
      this.chain=this.chain.then(()=>this.receive(new Uint8Array(e.data),ws)).catch(()=>{if(ws===this.ws)ws.close();});
    };
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{
      if(ws!==this.ws)return;
      clearTimeout(this.deadline);clearInterval(this.ping);this.connected=false;
      if(this.closed)return;
      this.onState('reconnecting');
      this.retry=setTimeout(()=>this.connect(),Math.min(30000,1000*2**Math.min(this.failures++,5)));
    };
    this.ping=setInterval(()=>{
      if(ws!==this.ws)return;
      if(Date.now()-this.lastRxAt>45000){this.reconnect();return;}
      if(ws.readyState===WebSocket.OPEN)ws.send(new Uint8Array([0xc0,0]));
    },15000);
  }
  reconnect(){
    if(this.closed||!this.crypto)return;
    clearTimeout(this.retry);clearTimeout(this.deadline);clearInterval(this.ping);
    const old=this.ws;this.ws=null;this.connected=false;old?.close();this.connect();
  }
  resume(){if(!this.closed&&(!this.connected||Date.now()-this.lastRxAt>20000))this.reconnect();}
  async receive(part,ws=this.ws){
    if(ws!==this.ws)return;
    this.buffer=concat(this.buffer,part);
    if(this.buffer.length>600000)throw Error('Oversized MQTT frame');
    while(this.buffer.length>=2){
      const b=this.buffer;let n=0,mul=1,at=1;
      while(true){if(at>=b.length)return;const x=b[at++];n+=(x&127)*mul;mul*=128;if(at>5||n>590000)throw Error('Bad MQTT frame');if(!(x&128))break;}
      if(b.length<at+n)return;
      const kind=b[0],body=b.slice(at,at+n);this.buffer=b.slice(at+n);
      if(kind>>4===2){
        if(body.length!==2||body[1]!==0)throw Error('Broker rejected connection');
        this.ws.send(frame(0x82,concat(u16(1),str(this.config.topic+'/'+this.inbound),new Uint8Array([1]))));
      }else if(kind>>4===9){
        if(body[2]===128)throw Error('Broker rejected subscription');
        this.connected=true;this.failures=0;this.onState('connected');
      }else if(kind>>4===3){
        const len=body[0]*256+body[1],topic=dec.decode(body.slice(2,2+len));let offset=2+len;
        if(kind&6){this.ws.send(frame(0x40,body.slice(offset,offset+2)));offset+=2;}
        if(topic!==this.config.topic+'/'+this.inbound)continue;
        let value;
        try{value=await this.crypto.open(body.slice(offset),this.inbound);}catch{continue;}
        if(ws!==this.ws)return;
        if(this.requireStatus&&(typeof value.boot_id!=='string'||!value.status||typeof value.status!=='object'))continue;
        this.onPacket(value);
      }
    }
  }
  async send(command=null,acknowledged=[]){return this.sendPacket({command,acknowledged});}
  async sendPacket(value){
    if(!this.connected||this.ws?.readyState!==WebSocket.OPEN)throw Error('连接尚未就绪');
    const ws=this.ws;
    const payload=await this.crypto.seal({...value,sent_at:Date.now()},this.outbound);
    if(ws!==this.ws||!this.connected||ws.readyState!==WebSocket.OPEN)throw Error('连接已改变，正在重试');
    if(payload.length>580000)throw Error('消息过大，请降低截图尺寸。');
    this.sequence=this.sequence%65535+1;
    this.ws.send(frame(0x32,concat(str(this.config.topic+'/'+this.outbound),u16(this.sequence),payload)));
  }
  close(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.deadline);clearInterval(this.ping);this.connected=false;this.ws?.close();}
}
