import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {createNativeAssetHttpHandler} from "../server/native-asset-handler.mjs";
import {MissingOriginalAsset} from "../server/native-pack-reader.mjs";
const sample=new TextEncoder().encode('{"source":"verified-pack-member"}');
const reader={
 has:async path=>path==="/assets/title/constantinople/manifest.json" || path==="/assets/title/retail name.json",
 read:async path=>{if(path!=="/assets/title/constantinople/manifest.json" && path!=="/assets/title/retail name.json")
   throw new MissingOriginalAsset(path);
   return sample;}
};
async function runServer(t){
 const handle=createNativeAssetHttpHandler(reader);
 const server=http.createServer(async(req,res)=>{
   if(!await handle(req,res)){res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return "http://127.0.0.1:"+server.address().port;
}
test("original OpenSRO asset route serves integrity-checked member, not synthetic retail controls",async t=>{
 const base=await runServer(t);
 const r=await fetch(base+"/assets/title/constantinople/manifest.json");
 assert.equal(r.status,200);
 assert.equal(r.headers.get("content-type"),"application/json; charset=utf-8");
 assert.equal(r.headers.get("x-content-type-options"),"nosniff");
 assert.equal(await r.text(),new TextDecoder().decode(sample));
 const token=r.headers.get("etag");
 const cache=await fetch(base+"/assets/title/constantinople/manifest.json",
    {headers:{"If-None-Match":token}});
 assert.equal(cache.status,304);
});
test("original game assets preserve range, head, no fallback /api or fake character data",async t=>{
 const base=await runServer(t);
 const path="/assets/title/constantinople/manifest.json";
 const h=await fetch(base+path,{method:"HEAD"});
 assert.equal(h.status,200);
 assert.equal(Number(h.headers.get("content-length")),sample.length);
 const ranged=await fetch(base+path,{headers:{Range:"bytes=0-9"}});
 assert.equal(ranged.status,206);
 assert.equal(ranged.headers.get("content-range"),"bytes 0-9/"+sample.length);
 assert.equal(await ranged.text(),new TextDecoder().decode(sample.subarray(0,10)));
 assert.equal((await fetch(base+path,{headers:{Range:"bytes=99999-"}})).status,416);
 assert.equal((await fetch(base+"/assets/unknown-genuine-resource.bin")).status,404);
 const encoded=await fetch(base+"/assets/title/retail%20name.json");
 assert.equal(encoded.status,200,"Original CIF filenames containing spaces must survive exact one-time URI decode");
 assert.equal(await encoded.text(),new TextDecoder().decode(sample));

 assert.equal((await fetch(base+"/api/title/login")).status,404);
 assert.equal((await fetch(base+"/shards/global-official/transport/ws")).status,404);
});
