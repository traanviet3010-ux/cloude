import assert from "node:assert/strict";
import http from "node:http";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";

if(!process.env.SRO_SOURCE_ROOT)
  throw Error("Native OpenSRO blend-state source required");
const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"native-atmosphere-blend-bundle.js");
const bridge=join(dir,"../src/native-world-webgl2.ts");
await build({entryPoints:[bridge],bundle:true,platform:"browser",
 format:"esm",target:"es2022",outfile:output,
 alias:{"@":process.env.SRO_SOURCE_ROOT+"/apps/client-next/src"}});
// Test the shader and material GL state with the unchanged actual WebGL2
// world renderer, not a replacement UI or a fake asset loader.
const server=http.createServer((req,res)=>{
 if(req.url==="/bundle.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});
   res.end(readFileSync(output));return;
 }
 res.writeHead(200,{"Content-Type":"text/html"});
 res.end("<!doctype html><title>Original SRO atmosphere and D3D9 blend pixel tests</title>");
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl",
 "--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:320,height:180}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
   const {OriginalWorldWebgl2}=await import("/bundle.js");
   const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const canvas=document.createElement("canvas");
   canvas.width=64;canvas.height=64;document.body.appendChild(canvas);
   const gl=canvas.getContext("webgl2");
   const renderer=new OriginalWorldWebgl2(canvas,24);
   // Packed offsets from genuine worldEnvironment() contract, testing
   // exactly the environment shader branch (not hand-authored sky art).
   const packed=new Float32Array(88);
   packed.set([0,1,0,1],0); // original zenith
   packed.set([1,0,0,0],4); // original horizon
   packed.set([0,0,1,0],16); // original camera forward
   packed.set([1,0,0,0],20); // original scaled camera right
   packed.set([0,1,0,0],24); // original scaled camera up
   packed.set([1,1,1,1],8);packed.set([.2,.2,.2,1],12);
   packed.set([1,0,0],84); // original packed sun direction
   const read=(x,y)=>{const p=new Uint8Array(4);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];
   };
   renderer.setOriginalLighting(packed,false,true);
   renderer.render(identity,[]);
   const skyTop=read(32,60),skyBottom=read(32,4);
   renderer.setOriginalLighting(packed,false,false);
   renderer.render(identity,[]);
   const noSky=read(32,60);
   const ground={
     positions:new Float32Array([-.95,-.95,.6,.95,-.95,.6,0,.95,.6]),
     indices:new Uint32Array([0,1,2]),transform:identity
   };
   renderer.set("original-red-base",{...ground,
     material:{color:[1,0,0,1],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:false}});
   renderer.set("original-blue-additive",{...ground,
     material:{color:[0,0,1,.5],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:true,blendPair:{source:2,destination:2}}});
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const additive=read(32,32);
   renderer.set("original-blue-additive",{...ground,
     material:{color:[0,0,1,.5],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:true}});
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const defaultAlpha=read(32,32);
   renderer.set("original-blue-additive",{...ground,
     material:{color:[0,0,1,.5],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:true,blendPair:{source:7,destination:1}}});
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const destAlpha=read(32,32);
   renderer.dispose();
   return {skyTop,skyBottom,noSky,additive,defaultAlpha,destAlpha};
 });
 console.log("ORIGINAL_SKY_BLEND_PIXELS_DIAGNOSTIC",JSON.stringify(result));
 assert.ok(result.skyTop[1]>135&&result.skyTop[0]<125,
   "Original zenith must render in upper half using packed camera basis");
 assert.ok(result.skyBottom[0]>170&&result.skyBottom[1]<100,
   "Original horizon must render below using native WGSL mix rule");
 assert.deepEqual(result.noSky.slice(0,3),[0,0,0],
   "No original atmosphere means no substitute sky may be created");
 assert.ok(result.additive[0]>220&&result.additive[2]>105,
   "D3DBLEND_ONE/ONE must add the real material RGB into framebuffer");
 assert.ok(result.defaultAlpha[0]>95&&result.defaultAlpha[0]<165 &&
   result.defaultAlpha[2]>100 && result.defaultAlpha[2]<155,
   "Retail default SRCALPHA/INVSRCALPHA should differ from additive");
 assert.ok(result.destAlpha[2]>230&&result.destAlpha[0]<30,
   "D3D9 X8R8G8B8 DESTALPHA reads ONE, regardless of WebGL alpha plane");
 console.log("ORIGINAL_OPEN_SRO_ATMOSPHERE_D3D_BLEND_PIXELS_PASS",JSON.stringify(result));
}finally{
 await browser.close();await new Promise(r=>server.close(r));
}
