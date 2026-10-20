import "./style.css";
import { createPackReader, type RegionCatalog } from "./pack";
import { createWorld } from "./world";
import { requestBackend, BackendError } from "./backend";
import { fetchRoster, createNativeCharacter, type CreateOptions } from "./characters";
import { probeGameWorld } from "./gameworld";

const $=<T extends HTMLElement>(name:string)=>document.getElementById(name) as T;
const canvas=$<HTMLCanvasElement>("world"),authState=$("auth-state"),assetState=$("asset-state"),status=$("status");
const reader=createPackReader();
let world:ReturnType<typeof createWorld>|null=null;
let controller:AbortController|null=null;
let token:string|null=null;
let activeDivision:string|null=null;
let rosterBusy=false;
let activeTransport:string|null=null;
let probing=false;
let worldProbeController:AbortController|null=null;
function explain(error:unknown) {return error instanceof Error?error.message:String(error);}
function text(el:HTMLElement,message:string) {el.textContent=message;}
function abortScene(){controller?.abort();controller=new AbortController();}
try {
  world=createWorld(canvas);
  text($("gpu"),"Babylon.js · WebGL2 thật");
} catch(e) {
  text($("gpu"),"WebGL2 không khả dụng");
  text(assetState,"Không tạo được WebGL2: "+explain(e));
  $("load-region").setAttribute("disabled","true");
}
type ServerRow={id?:string;name?:string;operating?:boolean;status?:string;transportUrl?:string};
const serverRows=new Map<string,ServerRow>();
let regions=new Map<string,{area?:string;source?:string;bundlePublicPath:string}>();
async function request<T>(path:string,body?:object,signal?:AbortSignal):Promise<T> {
  return requestBackend<T>(path,body,signal);
}

let serverLoop:AbortController|null=null;
function delay(ms:number,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error("Đã hủy"));return;}
    const timer=setTimeout(()=>{signal.removeEventListener("abort",cancel);resolve();},ms);
    const cancel=()=>{clearTimeout(timer);signal.removeEventListener("abort",cancel);reject(Error("Đã hủy"));};
    signal.addEventListener("abort",cancel,{once:true});
  });
}
async function servers() {
  serverLoop?.abort(); serverLoop=new AbortController();
  const signal=serverLoop.signal;
  const select=$<HTMLSelectElement>("server");
  const button=$<HTMLButtonElement>("login");button.disabled=true;
  select.replaceChildren(new Option("Đang chờ GameWorld khởi động…",""));
  for(let n=0;n<48;n++){
    try{
      if(signal.aborted)return;
      const list=await request<ServerRow[]>("/api/title/servers",undefined,signal);
      if(!Array.isArray(list))throw Error("Danh sách server không hợp lệ");
      const ready=list.filter(s=>s.id&&s.name&&s.operating!==false);
      if(!ready.length)throw Error("GameWorld chưa sẵn sàng");
      select.replaceChildren();
      serverRows.clear();
      for(const s of ready){
        serverRows.set(s.id!,s);
        const o=document.createElement("option");o.value=s.id!;
        o.textContent=s.name!;select.appendChild(o);
      }
      text(authState,"Danh sách server đã sẵn sàng. Dùng tài khoản TEST độc lập.");
      button.disabled=false;return;
    }catch(e){
      if(signal.aborted)return;
      if(e instanceof BackendError && !e.retryable){
        text(authState,"Không lấy được server: "+e.message);
        return;
      }
      text(authState,`Máy chủ TEST đang khởi động (${n+1}/48). Tự kiểm tra mỗi 5 giây, không cần F5.`);
      if(n<47)try{await delay(5000,signal);}catch{return;}
    }
  }
  text(authState,"Máy chủ chưa sẵn sàng sau 4 phút. Bấm 'Kết nối lại' khi muốn thử tiếp.");
}
async function login(){
  worldProbeController?.abort();activeTransport=null;
  const button=$<HTMLButtonElement>("login");button.disabled=true;
  try{
    const id=$<HTMLInputElement>("account").value.trim(),
      password=$<HTMLInputElement>("password").value,
      serverId=$<HTMLSelectElement>("server").value;
    if(!id || !password || !serverId)throw Error("Nhập ID, mật khẩu và chọn server");
    text(authState,"Đang xác thực với HieuSRO Agent thật…");
    const result=await request<{ok:boolean;code?:string;message?:string;sessionToken?:string;nextScene?:string;divisionId?:string}>(
      "/api/title/login",{id,password,serverId}
    );
    if(result.ok!==true || !result.sessionToken){
      throw Error(result.message||result.code||"Tài khoản không hợp lệ");
    }
    token=result.sessionToken; // in memory only; never log, persist or share
    text(authState,"Đăng nhập HieuSRO thành công. Kiểm tra danh sách nhân vật…");
    activeDivision=result.divisionId || serverId;
    activeTransport=serverRows.get(serverId)?.transportUrl??null;
    $<HTMLDivElement>("character-panel").hidden=false;
    await refreshRoster();
    text(status,"Đã xác thực với Game Server. Bản WebGL2 hiện mới có chế độ xem địa hình; chưa điều khiển nhân vật MMO.");
  } catch(e){text(authState,"Đăng nhập thất bại: "+explain(e));}
  finally{button.disabled=false;$<HTMLInputElement>("password").value="";}
}
async function refreshRoster(){
  if(!token)return;
  const list=$<HTMLUListElement>("roster-list");
  const state=$("roster-state");
  text(state,"Đang lấy nhân vật từ GameWorld TEST…");
  try{
    const characters=await fetchRoster(token);
    list.replaceChildren();
    for(const c of characters){
      const li=document.createElement("li");
      li.textContent=`${c.name} · Lv.${typeof c.level==="number"?c.level:"?"} `;
      const button=document.createElement("button");
      button.type="button";button.className="world-probe-button";
      button.textContent="Kiểm tra GameWorld";
      button.disabled=!activeTransport;
      button.title=activeTransport?"Xác minh vào thế giới thật; chưa kích hoạt di chuyển/combat":
        "Backend chưa cung cấp transportUrl cho shard";
      button.addEventListener("click",()=>void testWorldAdmission(c.name));
      li.appendChild(button);
      list.appendChild(li);
    }
    text(state,characters.length
      ? `Đăng nhập thành công · ${characters.length} nhân vật thật trên server TEST.`
      : "Đăng nhập thành công · Chưa có nhân vật. Chọn 'Tạo nhân vật thật' bên dưới.");
    if(!characters.length)$<HTMLDetailsElement>("character-creator").open=true;
    text(authState,characters.length
      ? `Đăng nhập thành công · ${characters.length} nhân vật: ${characters.map(c=>c.name).join(", ")}`
      : "Đăng nhập thành công · 0 nhân vật: chưa có nhân vật.");
  }catch(error){text(state,"Không đọc được danh sách nhân vật: "+explain(error));}
}
async function testWorldAdmission(character:string){
  if(probing)return;
  if(!token||!activeDivision||!activeTransport){
    text($("world-admission-state"),"Chưa có GameWorld transport URL từ server TEST.");return;
  }
  worldProbeController?.abort();worldProbeController=new AbortController();
  const signal=worldProbeController.signal;
  probing=true;
  const buttons=document.querySelectorAll<HTMLButtonElement>(".world-probe-button");
  buttons.forEach(button=>button.disabled=true);
  try{
    const result=await probeGameWorld({
      sessionToken:token,divisionId:activeDivision,character,
      transportUrl:activeTransport,signal,
      onPhase:message=>{if(!signal.aborted)text($("world-admission-state"),message);}
    });
    if(!signal.aborted)text($("world-admission-state"),
      `GameWorld xác thực nhân vật ${character}: ENTER_WORLD thành công; bootstrap v${result.bootstrapVersion} thật`+
      (result.referencesAdvertised?" (có world references).":"." )+
      " Kết nối thử đã đóng an toàn; client chưa xử lý gameplay và chưa gửi WorldReady.");
  }catch(error){
    if(!signal.aborted)text($("world-admission-state"),"Không xác minh được GameWorld: "+explain(error));
  }finally{
    if(worldProbeController?.signal===signal)worldProbeController=null;
    probing=false;
    document.querySelectorAll<HTMLButtonElement>(".world-probe-button").forEach(button=>button.disabled=!activeTransport);
  }
}
let creating=false;
async function submitCharacter(){
  if(creating||!token||!activeDivision){text($("creation-state"),"Hãy đăng nhập TEST trước.");return;}
  const name=$<HTMLInputElement>("character-name").value.trim();
  const race=$<HTMLSelectElement>("character-race").value;
  const gender=$<HTMLSelectElement>("character-gender").value;
  if(!["CH","EU"].includes(race)||!["MAN","WOMAN"].includes(gender))return;
  if(!confirm(`Tạo nhân vật "${name}" trên GameWorld TEST thật? Dữ liệu TEST có thể mất khi Render Free khởi động lại.`))return;
  const options:CreateOptions={name,race:race as CreateOptions["race"],gender:gender as CreateOptions["gender"]};
  creating=true;$<HTMLButtonElement>("create-character").disabled=true;
  text($("creation-state"),"Đang kiểm tra tên và tạo nhân vật trên GameWorld…");
  try{
    const c=await createNativeCharacter(token,activeDivision,options);
    text($("creation-state"),`Đã tạo ${c.name} trên server TEST.`);
    $<HTMLInputElement>("character-name").value="";
    await refreshRoster();
    $<HTMLDetailsElement>("character-creator").open=false;
  }catch(error){text($("creation-state"),"Không tạo được nhân vật: "+explain(error));}
  finally{creating=false;$<HTMLButtonElement>("create-character").disabled=false;}
}
$("create-character").addEventListener("click",()=>void submitCharacter());
$("refresh-roster").addEventListener("click",()=>void refreshRoster());
async function catalog(){
  try{
    const value=await reader.json<RegionCatalog>("/assets/world/world-region-catalog.json");
    if(!value.regionsById || typeof value.regionsById!=="object")throw Error("Sai cấu trúc danh mục map");
    regions.clear();
    const select=$<HTMLSelectElement>("region");select.replaceChildren();
    const all=Object.entries(value.regionsById).flatMap(([hex,rows])=>{
      const entry=rows.find(x=>x.source==="mission-outdoor-global") ??
        rows.find(x=>x.area==="outdoor");
      return entry?[[hex,entry] as const]:[];
    });
    all.sort((a,b)=>a[0].localeCompare(b[0]));
    for(const [key,row] of all.slice(0,800)){
      regions.set(key,row);
      const o=document.createElement("option");o.value=key;
      o.textContent=`Silkroad region ${key}`;
      select.appendChild(o);
    }
    text(assetState,`Đã xác thực catalog: ${all.length} vùng ngoài trời. Hãy chọn và nạp vùng.`);
    if(all.length)await loadRegion();
  }catch(e){text(assetState,"Không tải được bản đồ HieuSRO: "+explain(e));}
}
async function loadRegion(){
  if(!world)return;
  abortScene();const signal=controller!.signal;
  const button=$<HTMLButtonElement>("load-region");button.disabled=true;
  const key=$<HTMLSelectElement>("region").value;
  const info=regions.get(key);
  try{
    if(!info)throw Error("Chưa chọn region hợp lệ");
    text(assetState,"Đang tải terrain thật "+key+" từ SROPACK2 bằng HTTP 206…");
    const result=await world.loadRegion(reader,key,info,signal);
    if(result){
      const st=reader.stats();
      text(assetState,`${key}: ${result.tiles}/${result.blocks} cell GPU; ${(st.bytes/1048576).toFixed(1)} MiB thành viên đã tải.`);
      text(status,"Bản đồ là địa hình Silkroad v1.150 thật. Texture debug tạm thời; mô hình/animation và gameplay đang được chuyển đổi.");
    }
  }catch(e){if(!signal.aborted)text(assetState,"Lỗi tải bản đồ: "+explain(e));}
  finally{button.disabled=false;}
}
$("login").addEventListener("click",()=>void login());
$("reconnect").addEventListener("click",()=>void servers());
$("load-region").addEventListener("click",()=>void loadRegion());
for(const name of ["left","right","forward","back"]as const){
  const el=$<HTMLButtonElement>(name);
  let timer:ReturnType<typeof setInterval>|null=null;
  const stop=()=>{if(timer!==null){clearInterval(timer);timer=null;}};
  el.addEventListener("pointerdown",e=>{
    e.preventDefault();el.setPointerCapture(e.pointerId);
    world?.move(name,name==="forward"||name==="back"?70:0);
    stop();timer=setInterval(()=>world?.move(name,name==="forward"||name==="back"?35:0),90);
  });
  for(const event of ["pointerup","pointercancel","lostpointercapture","pointerleave"])el.addEventListener(event,stop);
}
const controls=(e:KeyboardEvent)=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
  const map:Record<string,"forward"|"back"|"left"|"right">={
    ArrowUp:"forward",KeyW:"forward",ArrowDown:"back",KeyS:"back",
    ArrowLeft:"left",KeyA:"left",ArrowRight:"right",KeyD:"right"
  };
  const action=map[e.code];if(action){e.preventDefault();world?.move(action,60);}
};
document.addEventListener("keydown",controls);
let closed=false;
const cleanup=()=>{
 if(closed)return;closed=true;
 controller?.abort();serverLoop?.abort();worldProbeController?.abort();document.removeEventListener("keydown",controls);
 world?.dispose();world=null;token=null;activeDivision=null;reader.reset();
};
window.addEventListener("pagehide",cleanup,{once:true});
window.addEventListener("beforeunload",cleanup,{once:true});
// On-device diagnostics; does not expose credentials or sensitive API data.
const debug=new URLSearchParams(location.search).get("debug")==="1";
const debugTimer=debug?setInterval(()=>{
  if(closed)return;
  const g=world?.stats(),a=reader.stats();
  text(status,`Babylon WebGL2 | region ${g?.region||"chưa chọn"} | cell GPU ${g?.tiles||0}/${g?.totalBlocks||0} | texture Silkroad ${g?.nativeTextures||0} | asset ${(a.bytes/1048576).toFixed(1)} MiB / ${a.requests} Range`);
},1800):null;
window.addEventListener("pagehide",()=>{if(debugTimer!==null)clearInterval(debugTimer);},{once:true});
void servers();void catalog();
