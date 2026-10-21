import assert from "node:assert/strict";
import http from "node:http";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";
const dir=dirname(fileURLToPath(import.meta.url)),out=join(dir,"lighting-bundle.js");
await build({entryPoints:[join(dir,"../src/native-world-webgl2.ts")],
  bundle:true,format:"esm",platform:"browser",target:"es2022",outfile:out});
const server=http.createServer((req,res)=>{
 if(req.url==="/lighting-bundle.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});
   res.end(readFileSync(out));return;
 }
 res.writeHead(200,{"Content-Type":"text/html"});
 res.end("<!doctype html><title>Native Silkroad object lighting WebGL2 readback</title>");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const results=await page.evaluate(async()=>{
   const {OriginalWorldWebgl2}=await import("/lighting-bundle.js");
   const canvas=document.createElement("canvas");
   canvas.width=64;canvas.height=64;document.body.appendChild(canvas);
   const owner=new OriginalWorldWebgl2(canvas,16);
   const gl=canvas.getContext("webgl2");
   const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const geometry=(normal,material)=>({
     positions:new Float32Array([-.9,-.9,.5,.9,-.9,.5,0,.9,.5]),
     normals:new Float32Array([...normal,...normal,...normal]),
     indices:new Uint32Array([0,1,2]),transform:identity,material
   });
   const lit={color:[1,1,1,1],ambient:[1,1,1],
     objectLight:1,unlit:false,doubleSided:true,alphaCutoff:0,blend:false};
   owner.set("lit",geometry([0,1,0],lit));
   let refused=false;
   try{owner.render(identity,["lit"]);}catch(e){refused=String(e).includes("packed environment");}
   const environment=new Float32Array(128);
   environment.set([.8,.8,.8],8);
   environment.set([.1,.1,.1],12);
   environment.set([0,1,0],84);
   owner.setOriginalLighting(environment);
   const sample=()=>{const rgba=new Uint8Array(4);
     gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
     return [...rgba];};
   owner.render(identity,["lit"]);
   const front=sample();
   owner.set("lit",geometry([0,-1,0],lit));
   owner.render(identity,["lit"]);
   const back=sample();
   owner.set("lit",geometry([0,1,0],{color:[0,0,1,1],
     unlit:true,doubleSided:true,alphaCutoff:0,blend:false}));
   owner.render(identity,["lit"]);
   const unlit=sample();
   owner.dispose();
   return {refused,front,back,unlit};
 });
 assert.ok(results.refused,"Uninitialized native environment must fail, not pretend world ready");
 assert.ok(results.front[0]>150&&results.front[0]<195,
   "Retail original 45-degree light + ambient should yield authored diffuse brightness");
 assert.ok(results.back[0]>=19&&results.back[0]<=35,
   "Away-facing normal should retain only original ambient, not fake flat shading");
 assert.ok(results.front[0]>results.back[0]+100,
   "Original object-light normal direction must change pixel luminance");
 assert.ok(results.unlit[2]>230&&results.unlit[0]<10&&results.unlit[1]<10,
   "Retail native NOLIGHT must remain color-faithful independently of lighting");
 console.log("ORIGINAL_SRO_OBJECT_LIGHTING_GL_PIXEL_PASS",JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
