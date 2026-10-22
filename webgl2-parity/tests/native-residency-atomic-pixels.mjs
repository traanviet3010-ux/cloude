import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const source=process.env.SRO_SOURCE_ROOT;
if(!source)throw Error("Pinned original OpenSRO source required");
const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"native-residency-atomic-bundle.js");
await build({entryPoints:[join(dir,"../src/native-world-webgl2.ts")],
  bundle:true,platform:"browser",format:"esm",target:"es2022",
  outfile:output,alias:{"@":source+"/apps/client-next/src"}});
const server=http.createServer((request,response)=>{
 if(request.url==="/renderer.js"){
   response.writeHead(200,{"Content-Type":"text/javascript"});
   response.end(readFileSync(output));return;
 }
 response.writeHead(200,{"Content-Type":"text/html"});
 response.end("<!doctype html><title>Original SRO GL atomic residency readback</title>");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:96,height:96}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
   const {OriginalWorldWebgl2}=await import("/renderer.js");
   const canvas=document.createElement("canvas");
   canvas.width=96;canvas.height=96;document.body.appendChild(canvas);
   const gl=canvas.getContext("webgl2");
   const gpu=new OriginalWorldWebgl2(canvas,1); // 1 MiB mesh-residency cap
   const I=new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
   const geometry=color=>({
     positions:new Float32Array([-.7,-.7,0,.7,-.7,0,0,.7,0]),
     indices:new Uint32Array([0,1,2]),
     transform:I,
     material:{unlit:true,color}
   });
   const pixel=()=>{gpu.render(I,["original-world"]);
     const p=new Uint8Array(4);
     gl.readPixels(48,48,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
   gpu.set("original-world",geometry([1,0,0,1]));
   const before=pixel();
   let invalidRejected=false,tooLargeRejected=false;
   try{
     gpu.set("original-world",{
       ...geometry([0,1,0,1]),indices:new Uint32Array([0,1,99])
     });
   }catch(e){invalidRejected=/index outside/.test(String(e));}
   const afterInvalid=pixel();
   try{
     gpu.set("original-world",{
       ...geometry([0,1,0,1]),
       positions:new Float32Array(24000*3),
       indices:new Uint32Array([0,1,2])
     });
   }catch(e){tooLargeRejected=/residency limit/.test(String(e));}
   const afterBudget=pixel();
   gpu.set("original-world",geometry([0,1,0,1]));
   const replacement=pixel();
   gpu.dispose();
   return {before,afterInvalid,afterBudget,replacement,
     invalidRejected,tooLargeRejected};
 });
 assert.ok(result.before[0]>180&&result.before[1]<40,
   "Original native GL red geometry should be visible");
 assert.ok(result.invalidRejected&&result.tooLargeRejected,
   "Malformed or oversize real mesh uploads must fail closed");
 assert.deepEqual(result.afterInvalid,result.before,
   "Failed native geometry validation may not evict the old GameWorld draw");
 assert.deepEqual(result.afterBudget,result.before,
   "Failed GL geometry budget preflight may not erase the previous stage");
 assert.ok(result.replacement[1]>180&&result.replacement[0]<40,
   "Successful native geometry upload must atomically replace old GPU draw");
 console.log("ORIGINAL_SRO_WEBGL2_ATOMIC_WORLD_RESIDENCY_PIXELS_PASS",JSON.stringify(result));
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
