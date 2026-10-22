import assert from "node:assert/strict";
import http from "node:http";
import {build} from "esbuild";
import {chromium} from "playwright";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"original-gl-owners-bundle.js");
await build({entryPoints:[join(dir,"../src/original-gl-owners.ts")],
 bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:output});
const server=http.createServer((req,res)=>{
 if(req.url==="/owner.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});res.end(readFileSync(output));
 }else{
   res.writeHead(200,{"Content-Type":"text/html"});
   res.end("<!doctype html><title>Original HieuSRO WebGL2 native GPU owner test</title>");
 }
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl",
 "--enable-unsafe-swiftshader"]});
try{
 const page=await browser.newPage({viewport:{width:192,height:128}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
   const {createOriginalGlOwners}=await import("/owner.js");
   const canvas=document.createElement("canvas");
   canvas.width=64;canvas.height=64;document.body.appendChild(canvas);
   const owners=createOriginalGlOwners(canvas,{mobile:false,maxResidentMB:32});
   const gl=owners.device.gl;
   const read=(x,y)=>{const pixel=new Uint8Array(4);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     return [...pixel];};
   const before=owners.stats();
   let during=null;
   const frame=owners.frame.render({
     width:64,height:64,
     world:()=>{
       // Pixel fixture solely tests original graphics pass ownership.
       gl.clearColor(1,0,0,1);
       gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
       const source=owners.device.allocateBuffer(
         new Float32Array([0,0,0,1,1,0]),gl.ARRAY_BUFFER);
       during=owners.device.stats();
       owners.device.release(source);
       return {scene:"retained-original-world"};
     },
     hud:()=>{
       // Native UI is drawn AFTER the world resolve; its blue fragment wins.
       gl.enable(gl.SCISSOR_TEST);
       gl.scissor(0,0,16,16);
       gl.clearColor(0,0,1,1);
       gl.clear(gl.COLOR_BUFFER_BIT);
       gl.disable(gl.SCISSOR_TEST);
       return {ui:"retained-original-hud"};
     }
   });
   const pixels={world:read(32,32),hud:read(8,8)};
   const after=owners.stats();
   let nested=false,invalidSize=false,budget=false;
   try{owners.device.beginFrame();owners.device.beginFrame();}
   catch(error){nested=/nested frame/.test(String(error));}
   finally{owners.device.endFrame();}
   try{owners.surface.resize(0,64);}
   catch(error){invalidSize=/dimensions/.test(String(error));}
   try{owners.device.allocateTexture2D(4096,4096);}
   catch(error){budget=/budget|dimensions/.test(String(error));}
   owners.dispose();
   const cleaned=owners.stats();

   // The mobile implementation reuses the browser backbuffer and does not
   // allocate a second full-screen color+depth framebuffer.
   const mobileCanvas=document.createElement("canvas");
   mobileCanvas.width=64;mobileCanvas.height=64;
   document.body.appendChild(mobileCanvas);
   const mobile=createOriginalGlOwners(mobileCanvas,{
     mobile:true,maxResidentMB:32
   });
   const gm=mobile.device.gl;
   const mobileFrame=mobile.frame.render({
     width:64,height:64,
     world:()=>{
       gm.clearColor(1,0,0,1);gm.clear(gm.COLOR_BUFFER_BIT|gm.DEPTH_BUFFER_BIT);
       return "native-original-world";
     },
     hud:()=>{
       gm.enable(gm.SCISSOR_TEST);gm.scissor(0,0,16,16);
       gm.clearColor(0,0,1,1);gm.clear(gm.COLOR_BUFFER_BIT);
       gm.disable(gm.SCISSOR_TEST);return "native-original-hud";
     }
   });
   const mPixels=(x,y)=>{const pix=new Uint8Array(4);
     gm.readPixels(x,y,1,1,gm.RGBA,gm.UNSIGNED_BYTE,pix);return [...pix];
   };
   const mobilePixels={world:mPixels(32,32),hud:mPixels(8,8)};
   const mobileStats=mobile.stats();
   mobile.dispose();
   const mobileAfter=mobile.stats();
   return {frame,pixels,before,during,after,cleaned,nested,invalidSize,budget,
     mobileFrame,mobilePixels,mobileStats,mobileAfter};
 });
 assert.deepEqual(result.frame,{
   scene:{scene:"retained-original-world"},
   hud:{ui:"retained-original-hud"}
 });
 assert.ok(result.pixels.world[0]>240&&result.pixels.world[2]<15,
   "Original world draw must survive FBO resolve");
 assert.ok(result.pixels.hud[2]>240&&result.pixels.hud[0]<15,
   "Original HUD must render after original world");
 assert.equal(result.before.device.open,false);
 assert.ok(result.during.bytes>result.after.device.bytes,
   "Released GPU buffer must be retired after the frame");
 assert.equal(result.after.device.open,false);
 assert.equal(result.after.device.resources,3,
   "Only the scene color/depth/FBO remain resident after GPU release");
 assert.equal(result.cleaned.device.bytes,0);
 assert.equal(result.cleaned.device.resources,0);
 assert.equal(result.cleaned.disposed,true);
 assert.equal(result.mobileStats.surface.directToCanvas,true);
 assert.equal(result.mobileStats.surface.allocated,false);
 assert.equal(result.mobileStats.device.resources,0,
   "Mobile native frame must avoid duplicate full-resolution FBO resources");
 assert.ok(result.mobilePixels.world[0]>240&&result.mobilePixels.hud[2]>240,
   "Mobile browser canvas must preserve genuine world/HUD drawing order");
 assert.equal(result.mobileAfter.device.bytes,0);
 assert.ok(result.nested&&result.invalidSize&&result.budget,
   "Native GL ownership must reject unsafe frame nesting and allocations");
 console.log("HIEUSRO_ORIGINAL_GL_DEVICE_SURFACE_FRAME_PASS",JSON.stringify(result));
}finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
