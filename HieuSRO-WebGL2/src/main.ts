import "./style.css";
import { createPackReader, type RegionCatalog } from "./pack";
import { createWorld } from "./world";

const $=<T extends HTMLElement>(name:string)=>document.getElementById(name) as T;
const canvas=$<HTMLCanvasElement>("world"),authState=$("auth-state"),assetState=$("asset-state"),status=$("status");
const reader=createPackReader();
let world:ReturnType<typeof createWorld>|null=null;
let controller:AbortController|null=null;
let token:string|null=null;
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
type ServerRow={id?:string;name?:string;operating?:boolean;status?:string};
let regions=new Map<string,{area?:string;source?:string;bundlePublicPath:string}>();
async function request<T>(path:string,body?:object):Promise<T> {
  const response=await fetch(path,{
    method:body?"POST":"GET",credentials:"include",redirect:"error",cache:"no-store",
    headers:{"X-OpenSRO-Protocol":"6",...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json() as T;
  if(!response.ok)throw Error("API "+response.status+" — "+path);
  return data;
}
async function servers() {
  try{
    const list=await request<ServerRow[]>("/api/title/servers");
    const select=$<HTMLSelectElement>("server");select.replaceChildren();
    if(!Array.isArray(list))throw Error("Danh sách server không hợp lệ");
    for(const s of list){
      if(!s.id || !s.name)continue;
      const o=document.createElement("option");o.value=s.id;o.textContent=s.name;
      o.disabled=s.operating===false;select.appendChild(o);
    }
    if(!select.options.length)throw Error("GameWorld chưa sẵn sàng");
    text(authState,"Đã kết nối danh sách server HieuSRO. Dùng tài khoản TEST độc lập.");
  }catch(e){text(authState,"Máy chủ TEST chưa sẵn sàng: "+explain(e)+". Thử tải lại danh sách sau.");}
}
async function login(){
  const button=$<HTMLButtonElement>("login");button.disabled=true;
  try{
    const id=$<HTMLInputElement>("account").value.trim(),
      password=$<HTMLInputElement>("password").value,
      serverId=$<HTMLSelectElement>("server").value;
    if(!id || !password || !serverId)throw Error("Nhập ID, mật khẩu và chọn server");
    text(authState,"Đang xác thực với HieuSRO Agent thật…");
    const result=await request<{ok:boolean;code?:string;message?:string;sessionToken?:string;nextScene?:string}>(
      "/api/title/login",{id,password,serverId}
    );
    if(result.ok!==true || !result.sessionToken){
      throw Error(result.message||result.code||"Tài khoản không hợp lệ");
    }
    token=result.sessionToken; // in memory only; never log, persist or share
    text(authState,"Đăng nhập HieuSRO thành công. Kiểm tra danh sách nhân vật…");
    const response=await fetch("/api/character/list",{
      headers:{Authorization:"Bearer "+token,"X-OpenSRO-Protocol":"6"},
      credentials:"omit",cache:"no-store"
    });
    if(response.ok) {
      const roster=await response.json();
      const list=Array.isArray(roster)?roster:
        (roster && typeof roster==="object" ? (roster.characters??roster.items??[]) : []);
      const names=Array.isArray(list)?list.map((r:unknown)=>{
        const p=r as {name?:string};return String(p?.name??"Nhân vật");
      }).slice(0,8):[];
      text(authState,`Đăng nhập thành công · ${names.length} nhân vật: ${names.join(", ")||"chưa có nhân vật"}.`);
    } else {
      text(authState,`Đăng nhập thành công. Danh sách nhân vật HTTP ${response.status} — chưa kết nối gameplay.`);
    }
    text(status,"Đã xác thực với Game Server. Bản WebGL2 hiện mới có chế độ xem địa hình; chưa điều khiển nhân vật MMO.");
  } catch(e){text(authState,"Đăng nhập thất bại: "+explain(e));}
  finally{button.disabled=false;$<HTMLInputElement>("password").value="";}
}
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
 controller?.abort();document.removeEventListener("keydown",controls);
 world?.dispose();world=null;token=null;reader.reset();
};
window.addEventListener("pagehide",cleanup,{once:true});
window.addEventListener("beforeunload",cleanup,{once:true});
void servers();void catalog();
