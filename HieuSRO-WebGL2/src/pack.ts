import { gunzipSync } from "fflate";

/** The same immutable OpenSRO v1.150 pack schema served by HieuSRO's CDN. */
export type Member = {
  path: string; packPath: string; offset: number; length: number;
  sha256: string; stored?: { encoding: "gzip"; length: number };
};
export type Group = { name: string; packs: { path: string; bytes: number; assetCount: number; sha256: string }[] };
type Manifest = { version: number; groups: Group[]; assets: Member[] };
export type RegionCatalog = {
  regionsById: Record<string, { area?: string; source?: string; bundlePublicPath: string }[]>;
};
const maxJSON = 28 * 1024 * 1024, maxHeader = 12 * 1024 * 1024;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,"0")).join("");

async function ensureHash(bytes: Uint8Array, expected: string, name: string) {
  const data = Uint8Array.from(bytes);
  const sum = hex(await crypto.subtle.digest("SHA-256", data.buffer));
  if (sum !== expected.toLowerCase()) throw new Error("Sai SHA-256 asset: " + name);
}
function sane(path: string) {
  if (!path.startsWith("/assets/") || path.includes("..") || path.includes("%") || path.includes("?") || path.includes("\\")) {
    throw new Error("Đường dẫn asset không hợp lệ");
  }
  return path.toLowerCase();
}
async function range(path: string, start: number, length: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 1 || length > maxJSON) {
    throw new Error("Giới hạn request asset không hợp lệ");
  }
  const response = await fetch(path, {
    headers: {Range: `bytes=${start}-${start+length-1}`, "Accept-Encoding":"identity"},
    signal,cache:"force-cache"
  });
  if (response.status !== 206 ||
      response.headers.get("Content-Range") !== `bytes ${start}-${start+length-1}/${(response.headers.get("Content-Range") || "").split("/")[1]}`) {
    throw new Error(`CDN phải hỗ trợ HTTP 206: ${path} (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== length) throw new Error("Sai số byte Range: "+path);
  return bytes;
}
export function createPackReader() {
  let manifestPromise: Promise<Manifest> | null = null;
  const byPath = new Map<string,Member>(), headerStarts = new Map<string,Promise<number>>();
  let bytesRead=0, reads=0;
  async function catalog():Promise<Manifest> {
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const response=await fetch("/assets/packs/manifest.json",{cache:"no-cache"});
        if(!response.ok)throw new Error("Không tải được kho asset (manifest)");
        const body=await response.arrayBuffer();
        if(body.byteLength>maxJSON)throw new Error("Manifest quá lớn");
        const value=JSON.parse(new TextDecoder().decode(body)) as Manifest;
        if(value.version!==2 || !Array.isArray(value.groups)||!Array.isArray(value.assets)||value.groups.length!==17) {
          throw new Error("Sai phiên bản kho asset HieuSRO");
        }
        for(const row of value.assets) {
          const key=sane(row.path);
          if(byPath.has(key)||!Number.isSafeInteger(row.offset)||!Number.isSafeInteger(row.length)||
             row.offset<0||row.length<0||!/^([a-f0-9]{64})$/i.test(row.sha256)) {
            throw new Error("Manifest chứa asset không hợp lệ");
          }
          byPath.set(key,row);
        }
        return value;
      })().catch(e=>{manifestPromise=null;byPath.clear();throw e});
    }
    return manifestPromise;
  }
  async function packHeaderStart(path:string,signal?:AbortSignal) {
    let load=headerStarts.get(path);
    if(!load) {
      load=(async()=>{
        const head=await range(path,0,12,signal);
        if(new TextDecoder().decode(head.slice(0,8))!=="SROPACK2")throw new Error("Sai chữ ký SROPACK2");
        const length=new DataView(head.buffer).getUint32(8,true);
        if(!length||length>maxHeader)throw new Error("Header pack quá lớn");
        const raw=await range(path,12,length,signal);
        const h=JSON.parse(new TextDecoder().decode(raw)) as {format:string;version:number;files:unknown[]};
        if(h.format!=="sro-asset-pack"||h.version!==2 || !Array.isArray(h.files))throw new Error("Header pack không hợp lệ");
        return 12+length;
      })().catch(e=>{headerStarts.delete(path);throw e});
      headerStarts.set(path,load);
    }
    return load;
  }
  async function read(path:string,signal?:AbortSignal):Promise<Uint8Array> {
    await catalog();
    const key=sane(path);
    const member=byPath.get(key)??(key.endsWith(".json")?byPath.get(key+".gz"):undefined);
    if(!member)throw new Error("Không có asset trong kho: "+key);
    if(member.length>maxJSON)throw new Error("Asset quá lớn cho client nhẹ: "+key);
    const pack=member.packPath;const span=member.stored?.length??member.length;
    const start=await packHeaderStart(pack,signal);
    const packed=await range(pack,start+member.offset,span,signal);
    bytesRead+=packed.length;reads++;
    let value=member.stored ? gunzipSync(packed):packed;
    if(value.length!==member.length)throw new Error("Sai dung lượng asset: "+key);
    await ensureHash(value,member.sha256,key);
    if(member.path.toLowerCase().endsWith(".gz")) value=gunzipSync(value);
    return value;
  }
  return {
    catalog,
    read,
    async json<T>(path:string,signal?:AbortSignal):Promise<T>{
      const bytes=await read(path,signal);
      return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as T;
    },
    stats:()=>({requests:reads,bytes:bytesRead,packHeaders:headerStarts.size,members:byPath.size}),
    reset(){headerStarts.clear();manifestPromise=null;byPath.clear();}
  };
}
export type PackReader=ReturnType<typeof createPackReader>;
