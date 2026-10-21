/*
 * HieuSRO original GPU -> WebGL2 asset bridge.
 * Serve the ORIGINAL OpenSRO /assets/* URLs from the already verified,
 * immutable, genuine v1.150 SROPACK2 TEST CDN. No generated placeholders.
 * Never route to LIVE/opensro.online or modify existing GPU services.
 */
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";

const MAX_MANIFEST=28*1024*1024;
const MAX_ASSET=36*1024*1024;
const MAX_HEADER=12*1024*1024;
const defaultCacheBytes=96*1024*1024;
const safePath=(path)=>typeof path==="string"&&
 /^\/assets\/[A-Za-z0-9_.+()/-]+$/.test(path)&&
 !path.includes("..")&&!path.includes("//")&&!path.includes("\\");
export class MissingOriginalAsset extends Error{
 constructor(path){super("Original v1.150 asset missing: "+path);this.name="MissingOriginalAsset";}
}
export function createOriginalPackReader({cdnBase,cacheBudgetBytes=defaultCacheBytes}={}){
 if(typeof cdnBase!=="string"||
   !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(cdnBase))
   throw Error("Only a separately configured HTTPS TEST Render asset CDN is permitted");
 if(!Number.isSafeInteger(cacheBudgetBytes)||cacheBudgetBytes<0||cacheBudgetBytes>512*1024*1024)
   throw Error("Invalid original asset cache budget");
 let catalogTask=null;
 const members=new Map(),packStarts=new Map(),cache=new Map();
 let cacheBytes=0,reads=0,cacheHits=0,networkBytes=0;
 async function get(url,{start,length,signal}={}){
   const headers={"Accept-Encoding":"identity"};
   if(start!==undefined){
     if(!Number.isSafeInteger(start)||start<0||
       !Number.isSafeInteger(length)||length<1||length>MAX_ASSET)
       throw Error("Invalid bounded SROPACK2 byte range");
     headers.Range=`bytes=${start}-${start+length-1}`;
   }
   const r=await fetch(cdnBase+url,{headers,signal:signal??AbortSignal.timeout(30000)});
   if(start===undefined?!r.ok:r.status!==206)
     throw Error("Native TEST pack CDN HTTP "+r.status+" "+url);
   if(start!==undefined){
     const expected=`bytes ${start}-${start+length-1}/`;
     if(!r.headers.get("content-range")?.startsWith(expected))
       throw Error("Original asset CDN did not honor precise byte range");
   }
   const buffer=new Uint8Array(await r.arrayBuffer());
   if(start!==undefined&&buffer.length!==length)
     throw Error("Original SROPACK2 transfer truncated");
   networkBytes+=buffer.byteLength;
   return buffer;
 }
 async function catalog(){
   if(!catalogTask){
     catalogTask=(async()=>{
       const value=await get("/assets/packs/manifest.json");
       if(value.length>MAX_MANIFEST)throw Error("SROPACK2 index exceeds manifest budget");
       const parsed=JSON.parse(new TextDecoder().decode(value));
       if(parsed.version!==2||!Array.isArray(parsed.assets)||!Array.isArray(parsed.groups)||
          parsed.groups.length!==17)
         throw Error("Invalid real HieuSRO SROPACK2 v1.150 index");
       members.clear();
       for(const row of parsed.assets){
         if(!safePath(row.path)||!safePath(row.packPath)||
            !row.packPath.startsWith("/assets/packs/")||
            !Number.isSafeInteger(row.offset)||row.offset<0||
            !Number.isSafeInteger(row.length)||row.length<0||
            !/^[a-f0-9]{64}$/i.test(row.sha256)||members.has(row.path.toLowerCase()))
            throw Error("Corrupt native pack catalog entry");
         members.set(row.path.toLowerCase(),row);
       }
       return {assets:members.size,packs:parsed.groups.reduce((n,g)=>n+(g.packs?.length??0),0)};
     })().catch(error=>{catalogTask=null;members.clear();throw error});
   }
   return catalogTask;
 }
 async function packStart(path,signal){
   let task=packStarts.get(path);
   if(!task){
     task=(async()=>{
       const top=await get(path,{start:0,length:12,signal});
       if(new TextDecoder().decode(top.subarray(0,8))!=="SROPACK2")
         throw Error("Invalid original game asset pack signature");
       const size=new DataView(top.buffer,top.byteOffset+8,4).getUint32(0,true);
       if(size<1||size>MAX_HEADER)throw Error("Native pack index exceeds header budget");
       const header=JSON.parse(new TextDecoder().decode(
         await get(path,{start:12,length:size,signal})));
       if(header.version!==2||header.format!=="sro-asset-pack"||!Array.isArray(header.files))
         throw Error("Invalid SROPACK2 header schema");
       return 12+size;
     })().catch(error=>{packStarts.delete(path);throw error});
     packStarts.set(path,task);
   }
   return task;
 }
 function retain(key,value){
   if(value.length>cacheBudgetBytes)return;
   const old=cache.get(key);if(old){cacheBytes-=old.length;cache.delete(key);}
   while(cacheBytes+value.length>cacheBudgetBytes&&cache.size){
     const [first,bytes]=cache.entries().next().value;
     cache.delete(first);cacheBytes-=bytes.length;
   }
   cache.set(key,value);cacheBytes+=value.length;
 }
 async function read(path,{signal}={}){
   if(!safePath(path))throw Error("Rejected unsafe native resource path");
   await catalog();
   const key=path.toLowerCase();
   const cached=cache.get(key);
   if(cached){cacheHits++;cache.delete(key);cache.set(key,cached);return cached;}
   const row=members.get(key)??(key.endsWith(".json")?members.get(key+".gz"):undefined);
   if(!row)throw new MissingOriginalAsset(path);
   if(row.length>MAX_ASSET)throw Error("Native resource exceeds bounded memory budget");
   const stored=row.stored?.length??row.length;
   if(!Number.isSafeInteger(stored)||stored<1||stored>MAX_ASSET)
     throw Error("Native compressed resource length invalid");
   const base=await packStart(row.packPath,signal);
   const blob=await get(row.packPath,{start:base+row.offset,length:stored,signal});
   let native=row.stored?gunzipSync(blob,{maxOutputLength:MAX_ASSET}):blob;
   if(native.byteLength!==row.length)throw Error("Original asset decompressed size mismatch");
   const digest=createHash("sha256").update(native).digest("hex");
   if(digest!==row.sha256.toLowerCase())throw Error("Original SROPACK2 member SHA256 mismatch");
   if(row.path.toLowerCase().endsWith(".gz"))
     native=gunzipSync(native,{maxOutputLength:MAX_ASSET});
   reads++;
   retain(key,native);
   return native;
 }
 const json=async(path,options)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await read(path,options)));
 return {catalog,read,json,has:async(path)=>{await catalog();const p=path.toLowerCase();
   return members.has(p)||members.has(p+".gz");},
   stats:()=>({assets:members.size,reads,cacheHits,networkMB:networkBytes/1048576,
     cacheMB:cacheBytes/1048576,packHeaders:packStarts.size}),
   clear(){cache.clear();cacheBytes=0;packStarts.clear();catalogTask=null;members.clear();}
 };
}
