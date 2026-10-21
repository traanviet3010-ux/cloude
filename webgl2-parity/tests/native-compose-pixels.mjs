import assert from "node:assert/strict";
import http from "node:http";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";

const cwd=dirname(fileURLToPath(import.meta.url));
const output=join(cwd,"compose-bundle.js");
await build({entryPoints:[join(cwd,"../src/original-webgl2-compositor.ts")],bundle:true,
  format:"esm",platform:"browser",target:"es2022",outfile:output,
  alias:{"@":process.env.SRO_SOURCE_ROOT+"/apps/client-next/src"}});
const httpServer=http.createServer((req,res)=>{
 if(req.url==="/compose-bundle.js"){res.writeHead(200,{"Content-Type":"text/javascript"});res.end(readFileSync(output));return;}
 res.writeHead(200,{"Content-Type":"text/html"});res.end("<!doctype html><title>Original OpenSRO 3D + UI on one WebGL2 context</title>");
});
await new Promise(r=>httpServer.listen(0,"127.0.0.1",r));
const port=httpServer.address().port;
const browser=await chromium.launch({headless:true,args:[
  "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
 await page.goto("http://127.0.0.1:"+port+"/");
 const data=await page.evaluate(async()=>{
   const {createOriginalSilkroadWebgl2}=await import("/compose-bundle.js");
   const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;
   document.body.appendChild(canvas);
   const own=createOriginalSilkroadWebgl2(canvas);
   const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   own.setOriginalGeometry("original-unlit-mesh",{
      positions:new Float32Array([-.9,-.9,.5,.9,-.9,.5,0,.9,.5]),
      indices:new Uint32Array([0,1,2]),
      transform:I,
      material:{color:[0,0,1,1],unlit:true,doubleSided:true,alphaCutoff:0,blend:false}
   });
   own.setOriginalUiTexture("original-CIF-tex",new ImageData(new Uint8ClampedArray([255,0,0,255]),1,1));
   const stats=own.frame(I,["original-unlit-mesh"],{revision:1,width:64,height:64,quads:[{
     rect:[0,0,32,32],clip:[0,0,32,64],uv:[0,0,1,1],
     color:[1,1,1,1],texture:"original-CIF-tex"
   }]});
   const gl=canvas.getContext("webgl2");
   const pixels=(x,y)=>{const p=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
   const state={ui:pixels(8,50),mesh:pixels(32,16),stats};
   own.dispose();
   return state;
 });
 assert.ok(data.ui[0]>220&&data.ui[2]<40,"Authored UiScene must overlay the world on same WebGL2 context");
 assert.ok(data.mesh[2]>220&&data.mesh[0]<40,"Original geometry must remain visible after drawing native UI");
 assert.equal(data.stats.ui.drawCalls,1);
 assert.equal(data.stats.triangleCount,1);
 console.log("ORIGINAL_OPEN_SRO_WORLD_AND_UI_ONE_WEBGL2_PASS",JSON.stringify(data));
}finally{await browser.close();await new Promise(r=>httpServer.close(r));}
