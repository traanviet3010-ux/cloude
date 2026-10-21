import assert from "node:assert/strict";
import http from "node:http";
import {createOriginalPackReader} from "../server/native-pack-reader.mjs";
import {createNativeAssetHttpHandler} from "../server/native-asset-handler.mjs";

/**
 * Actual genuine title/character scene HTTP gateway test, not a synthetic UI
 * or a playable game. Uses ONLY the previously verified isolated TEST CDN.
 */
const reader=createOriginalPackReader({
 cdnBase:process.env.HIEUSRO_TEST_PACK_CDN,
 cacheBudgetBytes:64*1024*1024
});
const handle=createNativeAssetHttpHandler(reader);
const server=http.createServer(async(req,res)=>{
  if(!await handle(req,res)){res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
try{
 for(const path of [
   "/assets/title/constantinople/manifest.json",
   "/assets/character-select/world-manifest.json",
   "/assets/character-select/create-world-europe-manifest.json",
   "/assets/character-select/create-world-china-manifest.json"
 ]){
   const response=await fetch(base+path,{signal:AbortSignal.timeout(30000)});
   assert.equal(response.status,200,"Real v1.150 scene must not return 404: "+path);
   assert.match(response.headers.get("content-type")??"",/application\/json/);
   const scene=await response.json();
   assert.ok(Array.isArray(scene.camera)&&scene.camera.length>0);
   assert.ok(await reader.has(scene.regionBundlePublicPath),
     "Real scene's world bundle must exist in same verified CDN index");
   console.log("GENUINE_SILKROAD_ASSET_HTTP_OK",JSON.stringify({
     path,cameraKeyframes:scene.camera.length,bundle:scene.regionBundlePublicPath}));
 }
 const range=await fetch(base+"/assets/title/constantinople/manifest.json",
   {headers:{"Range":"bytes=0-99"}});
 assert.equal(range.status,206);
 assert.equal((await range.arrayBuffer()).byteLength,100);
 const cacheToken=range.headers.get("etag");
 const notModified=await fetch(base+"/assets/title/constantinople/manifest.json",
   {headers:{"If-None-Match":cacheToken}});
 assert.equal(notModified.status,304);
 assert.equal((await fetch(base+"/assets/this-file-must-not-exist.json")).status,404);
 assert.equal((await fetch(base+"/api/title/servers")).status,404,
   "Pack bridge must never intercept authoritative HieuSRO GameWorld API");
 console.log("GENUINE_V150_ORIGINAL_ASSET_URLS_RESTORED_FOR_TEST=1",
   JSON.stringify(reader.stats()));
}finally{await new Promise(resolve=>server.close(resolve));}
