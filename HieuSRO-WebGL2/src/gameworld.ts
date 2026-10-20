/**
 * HieuSRO Babylon WebGL2: genuine, read-only GameWorld admission check.
 * Pinned protocol authority: opensro-dev/opensro@4f6919d / transport codec.
 * This verifies a server-issued EnterWorld bootstrap; it never simulates
 * movement, grants world-ready, sends combat commands, or stores auth tickets.
 */
export type WorldProbeResult = { bootstrapVersion:1|2; referencesAdvertised:boolean };
export type WireFrame = { opcode:number; payload:Uint8Array };
const encoder = new TextEncoder();
const MAX_IN = 16 << 20;
const MAX_OUT = 64 << 10;
const ADMISSION_DEADLINE_MS = 20000;

export function encodeFrame(opcode:number,payload:Uint8Array):Uint8Array {
  if(!Number.isInteger(opcode)||opcode<0||opcode>65535||payload.length+2>MAX_OUT)
    throw Error("Lệnh giao thức không hợp lệ");
  const bytes=new Uint8Array(payload.length+2);
  new DataView(bytes.buffer).setUint16(0,opcode,true);
  bytes.set(payload,2);
  return bytes;
}
export function decodeFrame(bytes:Uint8Array):WireFrame {
  if(bytes.byteLength<2||bytes.byteLength>MAX_IN)throw Error("Kích thước gói GameWorld không hợp lệ");
  return {opcode:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(0,true),
    payload:bytes.subarray(2)};
}
export function encodeHello(ticket:string):Uint8Array {
  const part=encoder.encode(ticket);
  if(!part.length||part.length>512)throw Error("Transport ticket không hợp lệ");
  const body=new Uint8Array(part.length+4);
  body[0]=2;body[1]=0; // version 2, no resume session
  new DataView(body.buffer).setUint16(2,part.length,true);
  body.set(part,4);
  return encodeFrame(1,body);
}
export function verifyWelcome(p:Uint8Array):void {
  if(p.length!==27||p[0]!==2||p[1]!>1||p[10]!==16)
    throw Error("GameWorld WELCOME không đúng protocol v2");
}
export function encodeEnterWorld(division:string,character:string,ticket:string):Uint8Array {
  const parts=[encoder.encode(division),encoder.encode(character),encoder.encode(ticket)];
  if(!division||!character||!ticket||parts.some(p=>p.length>65535)||parts[2]!.length>512)
    throw Error("Thông tin EnterWorld không hợp lệ");
  const body=new Uint8Array(parts.reduce((n,p)=>n+p.length+2,0));
  const view=new DataView(body.buffer);
  let offset=0;
  for(const part of parts){
    view.setUint16(offset,part.length,true);
    body.set(part,offset+2);
    offset+=part.length+2;
  }
  return encodeFrame(6,body);
}
export function parseEnterWorld(p:Uint8Array):WorldProbeResult {
  if(p.length<9)throw Error("EnterWorld bị cắt");
  const view=new DataView(p.buffer,p.byteOffset,p.byteLength);
  const length=view.getUint32(5,true);
  if(p[0]!==1)throw Error("GameWorld từ chối EnterWorld (mã "+view.getUint32(1,true)+")");
  if(p.length!==9+length||!length)throw Error("EnterWorld bootstrap sai độ dài");
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(p.subarray(9))) as {
    v?:number; bootstrap?:unknown; references?:unknown;
  };
  if((value.v!==1&&value.v!==2)||!value.bootstrap||
     typeof value.bootstrap!=="object"||Array.isArray(value.bootstrap))
    throw Error("EnterWorld bootstrap không đúng schema");
  if(value.v===2&&(!value.references||typeof value.references!=="object"))
    throw Error("GameWorld thiếu identity của world references");
  return {bootstrapVersion:value.v, referencesAdvertised:value.v===2};
}
/** Always tunnel via this TEST origin, never connect a bearer ticket to an arbitrary host. */
export function worldSocketUrl(transportUrl:string,origin:string):string {
  const src=new URL(transportUrl,origin);
  const path=src.pathname.replace(/\/$/,"");
  if(!/^\/shards\/[a-zA-Z0-9_-]+$/.test(path)||src.username||src.password||src.search||src.hash)
    throw Error("Đường dẫn shard TEST không hợp lệ");
  const out=new URL(path+"/transport/ws",origin);
  if(out.protocol!=="https:"&&out.protocol!=="http:")throw Error("Origin không an toàn");
  out.protocol=out.protocol==="https:"?"wss:":"ws:";
  return out.toString();
}
async function mint(
  type:"transport"|"enterworld",token:string,division:string,character:string,signal:AbortSignal
):Promise<string> {
  const body=type==="transport"?{}:{divisionId:division,characterName:character};
  const response=await fetch("/api/auth/"+type+"-token",{
    method:"POST",credentials:type==="enterworld"?"include":"omit",
    redirect:"error",cache:"no-store",signal,
    headers:{Authorization:"Bearer "+token,"X-OpenSRO-Protocol":"6",
      Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  if(!response.ok)throw Error("GameWorld không cấp "+type+" ticket (HTTP "+response.status+")");
  if(!(response.headers.get("content-type")??"").includes("json"))
    throw Error("Admission API không trả JSON");
  const result=await response.json() as {ok?:boolean;token?:string};
  if(result.ok!==true||typeof result.token!=="string"||!result.token||
     encoder.encode(result.token).length>512)
    throw Error("Admission ticket không hợp lệ");
  return result.token;
}
export async function probeGameWorld(args:{
  sessionToken:string; divisionId:string; character:string; transportUrl:string;
  signal:AbortSignal; onPhase:(message:string)=>void; origin?:string;
}):Promise<WorldProbeResult> {
  const {sessionToken,divisionId,character,transportUrl,signal,onPhase}=args;
  if(!sessionToken||!divisionId||!character||character.length>64)
    throw Error("Hãy chọn nhân vật đã đăng nhập TEST");
  const wsUrl=worldSocketUrl(transportUrl,args.origin??location.origin);
  if(signal.aborted)throw Error("Đã hủy kiểm tra GameWorld");
  const transportTicket=await mint("transport",sessionToken,divisionId,character,signal);
  if(signal.aborted)throw Error("Đã hủy kiểm tra GameWorld");
  onPhase("Đã nhận transport ticket từ backend TEST, đang mở WebSocket…");
  return await new Promise<WorldProbeResult>((resolve,reject)=>{
    const socket=new WebSocket(wsUrl);
    socket.binaryType="arraybuffer";
    let phase:"hello"|"enter-token"|"world"="hello",settled=false;
    const timeout=setTimeout(()=>finish(Error("Quá thời gian xác thực GameWorld TEST")),ADMISSION_DEADLINE_MS);
    const cancelled=()=>finish(Error("Đã hủy kiểm tra GameWorld"));
    signal.addEventListener("abort",cancelled,{once:true});
    function finish(result:Error|WorldProbeResult){
      if(settled)return;
      settled=true;clearTimeout(timeout);signal.removeEventListener("abort",cancelled);
      socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;
      if(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING)socket.close();
      if(result instanceof Error)reject(result);else resolve(result);
    }
    socket.onopen=()=>{
      try{socket.send(encodeHello(transportTicket));onPhase("Đã gửi HELLO của protocol v2…");}
      catch(error){finish(error instanceof Error?error:Error(String(error)));}
    };
    socket.onmessage=(event:MessageEvent)=>{
      if(!(event.data instanceof ArrayBuffer)){finish(Error("GameWorld không gửi frame nhị phân"));return;}
      try{
        const frame=decodeFrame(new Uint8Array(event.data));
        if(frame.opcode===5){
          finish(Error("GameWorld kết thúc kết nối (mã "+(frame.payload[0]??"?")+")"));return;
        }
        if(frame.opcode===3){
          if(frame.payload.length>64)throw Error("GameWorld PING quá lớn");
          socket.send(encodeFrame(4,frame.payload));return;
        }
        if(phase==="hello"){
          if(frame.opcode!==2)throw Error("Chưa nhận WELCOME từ GameWorld");
          verifyWelcome(frame.payload);
          phase="enter-token";
          onPhase("WELCOME hợp lệ. Đang lấy EnterWorld ticket cho "+character+"…");
          void mint("enterworld",sessionToken,divisionId,character,signal).then(ticket=>{
            if(settled)return;
            socket.send(encodeEnterWorld(divisionId,character,ticket));
            phase="world";
            onPhase("Đã gửi ENTER_WORLD cho nhân vật TEST, chờ bootstrap thật…");
          }).catch(error=>finish(error instanceof Error?error:Error(String(error))));
          return;
        }
        if(phase==="world"&&frame.opcode===7){finish(parseEnterWorld(frame.payload));return;}
        // No gameplay frames are accepted by this limited probe. Never send
        // WorldReady (0x3012) before authoritative state and renderer exist.
        if(frame.opcode!==4)throw Error("GameWorld gửi opcode ngoài giai đoạn admission: "+frame.opcode);
      }catch(error){finish(error instanceof Error?error:Error(String(error)));}
    };
    socket.onerror=()=>finish(Error("Không mở được GameWorld WebSocket TEST"));
    socket.onclose=()=>finish(Error("GameWorld WebSocket đóng trước khi trả bootstrap"));
  });
}
