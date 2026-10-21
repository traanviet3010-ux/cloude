/*
 * Read-only audit of the ORIGINAL Silkroad title/character-select manifests.
 * This is diagnostics, NOT a game deployment or a fixture generator.
 * Do not report a real scene as supported without parsing its native bundle.
 * Never read or write accounts, characters, GameWorld, LIVE or backend state.
 */
import {writeFileSync} from "node:fs";
const base=process.env.HIEUSRO_TEST_ASSET_ORIGIN;
if(!base||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(base))
  throw Error("Supply explicit isolated HTTPS Render TEST origin");
const paths=[
 "/assets/title/constantinople/manifest.json",
 "/assets/character-select/world-manifest.json",
 "/assets/character-select/create-world-europe-manifest.json",
 "/assets/character-select/create-world-china-manifest.json",
];
async function get(path){
 let lastError="";
 for(let i=0;i<3;i++){
   try{
     const response=await fetch(base+path,{
       signal:AbortSignal.timeout(24000),
       headers:{"Accept":"application/json","Cache-Control":"no-cache"}
     });
     if(!response.ok)throw Error("HTTP "+response.status);
     const size=Number(response.headers.get("content-length")??0);
     if(size>4*1024*1024)throw Error("Native manifest exceeds bounded audit limit");
     const text=await response.text();
     if(text.length>4*1024*1024)throw Error("Native manifest oversized");
     const obj=JSON.parse(text);
     if(!obj||typeof obj!=="object"||!Array.isArray(obj.camera)||
       typeof obj.regionBundlePublicPath!=="string")
       throw Error("Response not a native frontend StageManifest");
     if(!obj.regionBundlePublicPath.startsWith("/assets/")||
        obj.regionBundlePublicPath.includes(".."))
       throw Error("Native manifest contains unsafe region bundle path");
     return {status:"verified-manifest-only",scene:path,bytes:text.length,
       nativeBundle:obj.regionBundlePublicPath,
       cameraKeyframes:obj.camera.length,
       hasCreateCamera:Array.isArray(obj.createCamera),
       properties:Object.keys(obj).sort()};
   }catch(e){lastError=String(e);
     if(i<2)await new Promise(r=>setTimeout(r,3000*(i+1)));
   }
 }
 return {status:"unavailable",scene:path,error:lastError};
}
const results=[];
for(const path of paths){
 const row=await get(path);results.push(row);
 console.log("ORIGINAL_TEST_STAGE_MANIFEST",JSON.stringify(row));
}
const summary={
 baseline:"HieuSRO original OpenSRO pinned 4f6919d6900d169b89e75647e56c99ca8ebd5cfb",
 testedOrigin:base,
 important:"Native manifest GET only; native world binary, real asset/mesh/material support, login, gameplay and iPhone playability were NOT tested.",
 results
};
writeFileSync("native-stage-manifest-audit.json",JSON.stringify(summary,null,2)+"\n");
if(results.some(x=>x.status==="unavailable")){
 console.error("ORIGINAL_REAL_STAGE_MANIFEST_AUDIT_INCOMPLETE: do not assume assets exist");
 process.exitCode=1;
}
