import type { PackReader } from "./pack";

/** Authored Silkroad v1.150 title controls from the exact native CIF layout.
 * Uses original PNGs carried by the HieuSRO SROPACK2 CDN; never substitutes
 * synthetic drawings and never fetches LIVE or third-party image hosts.
 */
export interface NativeNode { name:string; ddj?:{publicPath:string}; rect:{x:number;y:number;width:number;height:number} }
export interface NativeLayout { controlsByName:Record<string,NativeNode> }
export const TITLE_ART = {
  "GDR_STA_LOGO":"native-logo",
  "GDR_STA_LOGINWINDOW":"native-login-window",
  "GDR_STA_TITLE":"native-title-border",
  "GDR_BTN_OK":"login",
  "GDR_BTN_SERVER":"server-picker-art",
  "GDR_BTN_CANCEL":"reconnect",
  "GDR_BTN_START":"native-start-art"
} as const;
export function resolveTitleImage(layout:NativeLayout,name:string):string|null{
  const row=layout.controlsByName?.[name];
  const value=row?.ddj?.publicPath;
  if(typeof value!=="string"||!/^\/assets\/images\/[A-Za-z0-9/_().-]+\.png$/i.test(value)||
      value.includes("..")||value.includes("//")||value.includes("\\"))return null;
  return value;
}
export function createNativeTitle(reader:PackReader){
  const leases:string[]=[];let disposed=false;
  async function load(signal?:AbortSignal){
    const title=await reader.json<NativeLayout>("/assets/cif/layouts/pstitle.json",signal);
    if(!title.controlsByName||typeof title.controlsByName!=="object")throw Error("Sai layout đăng nhập Silkroad v1.150");
    const dock=await reader.json<NativeLayout>("/assets/cif/layouts/pscharacterselect_europe.json",signal)
      .catch(()=>({controlsByName:{}} as NativeLayout));
    let count=0;
    const requests=Object.entries(TITLE_ART).map(async ([name,id])=>{
      const doc=name==="GDR_BTN_START"?dock:title;
      const path=resolveTitleImage(doc,name);
      if(!path)return;
      const el=document.getElementById(id);
      if(!el)return;
      const bytes=await reader.read(path,signal);
      if(disposed||signal?.aborted)return;
      if(!bytes.length||bytes.length>4*1024*1024)throw Error("Kích thước native UI image không hợp lệ");
      const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:"image/png"}));
      if(disposed||signal?.aborted){URL.revokeObjectURL(url);return;}
      leases.push(url);
      if(el instanceof HTMLImageElement){el.src=url;el.hidden=false;}
      else el.style.backgroundImage="url("+JSON.stringify(url)+")";
      el.classList.add("native-art-ready");count++;
    });
    const results=await Promise.allSettled(requests);
    if(count===0){
      const error=results.find((r):r is PromiseRejectedResult=>r.status==="rejected");
      throw Error(error?.reason instanceof Error?error.reason.message:"Không tìm thấy hình CIF đăng nhập trong asset pack");
    }
    if(!disposed)document.documentElement.dataset.titleArt=count.toString();
    return count;
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const url of leases)URL.revokeObjectURL(url);
    leases.length=0;
  }
  return {load,dispose};
}
