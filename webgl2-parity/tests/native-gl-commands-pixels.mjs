import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";
const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"native-gpu-command-owner-browser.js");
const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Exact OpenSRO checkout must exist for native GL owner contract");
await build({entryPoints:[join(dir,"../src/original-gl-frame.ts")],
 bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:output,
 alias:{"@":root+"/apps/client-next/src"}});
const surfaceSource=join(dir,"../src/original-gl-surface.ts");
const deviceSource=join(dir,"../src/original-gl-device.ts");
const bridge=join(dir,"native-gl-commands-browser-bridge.ts");
await build({entryPoints:[bridge],bundle:true,platform:"browser",format:"esm",
 target:"es2022",outfile:output,alias:{"@":root+"/apps/client-next/src"}});
const server=http.createServer((req,res)=>{
 if(req.url==="/commands.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});
   res.end(readFileSync(output));
 }else{res.writeHead(200,{"Content-Type":"text/html"});
   res.end("<!doctype html><title>Original SRO GPU command WebGL2 owner</title>");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:320,height:240}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const r=await page.evaluate(async()=>{
   const {createOriginalGlDevice,createOriginalGlSurface,createOriginalGlFrame}=
     await import("/commands.js");
   const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;
   document.body.appendChild(canvas);
   const device=createOriginalGlDevice(canvas,{maxResidentMB:32,mobile:true});
   const surface=createOriginalGlSurface(device,{directToCanvas:true});
   const frame=createOriginalGlFrame(device,surface);
   const gl=device.gl;
   const compile=(kind,source)=>{
     const shader=gl.createShader(kind);gl.shaderSource(shader,source);
     gl.compileShader(shader);
     if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))
       throw Error(gl.getShaderInfoLog(shader));
     return device.own("shader",shader);
   };
   const v=compile(gl.VERTEX_SHADER,`#version 300 es
layout(location=0) in vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0,1);}`);
   const f=compile(gl.FRAGMENT_SHADER,`#version 300 es
precision mediump float;
out vec4 outColor;
void main(){outColor=vec4(1,0,0,1);}`);
   const program=device.own("program",gl.createProgram());
   gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS))
     throw Error(gl.getProgramInfoLog(program));
   device.release(v);device.release(f);
   const vertex=device.allocateBuffer(new Float32Array([
     -.8,-.8,.8,-.8,0,.8
   ]),gl.ARRAY_BUFFER);
   const vao=device.own("vertexArray",gl.createVertexArray());
   gl.bindVertexArray(vao);
   gl.bindBuffer(gl.ARRAY_BUFFER,vertex);
   gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
   gl.enableVertexAttribArray(0);
   const indices=device.allocateBuffer(new Uint32Array([0,1,2]),gl.ELEMENT_ARRAY_BUFFER);
   gl.bindVertexArray(null);
   const px=(x,y)=>{const p=new Uint8Array(4);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
   let attemptedNested=false,computeBlocked=false,twiceBlocked=false,
     bundleClosed=false,invalidBlendBlocked=false;
   const bundleEncoder=frame.commands.createRenderBundleEncoder();
   const mutableDraw={program,vertexArray:vao,count:3,instances:1,
     cull:false,depthTest:true,depthWrite:true};
   bundleEncoder.drawIndexed(mutableDraw);
   const originalBundle=bundleEncoder.finish();
   // The bundle snapshots the original draw before the source owner reuses
   // its scratch descriptor for the next frame.
   mutableDraw.count=0;
   try{bundleEncoder.finish();}catch{bundleClosed=true;}
   const run=frame.render({
     width:64,height:64,
     world:()=>{
       const encoder=frame.commands.encoder();
       const clearColor=[0,0,0,1];
       const pass=encoder.beginRenderPass({width:64,height:64,
         colorLoad:"clear",clearColor,depthLoad:"clear",clearDepth:1});
       clearColor[1]=1; // changing the caller scratch array cannot change GPU commands
       try{encoder.beginRenderPass({width:64,height:64});}
       catch{attemptedNested=true;}
       pass.scissor([16,16,32,32]);
       try{pass.drawIndexed({program,vertexArray:vao,count:3,instances:1,
         blend:{source:-999,destination:gl.ONE}});}
       catch{invalidBlendBlocked=true;}
       pass.executeBundles([originalBundle]);
       pass.end();
       const recorded=encoder.finish();
       const submitted=recorded.submit();
       try{recorded.submit();}catch{twiceBlocked=true;}
       return submitted;
     },
     hud:()=>null
   });
   const inside=px(32,32),outside=px(10,10);
   const after=frame.render({
     width:64,height:64,
     world:()=>{
       const command=frame.commands.encoder();
       try{command.beginComputePass();}catch{computeBlocked=true;}
       const pass=command.beginRenderPass({width:64,height:64,
         colorLoad:"clear",clearColor:[0,0,1,1]});
       pass.end();return command.finish().submit();
     },hud:()=>null
   });
   const cleared=px(32,32);
   const before=device.stats(),commandStats=frame.commands.stats();
   let retiredBlocked=false;
   const command=frame.commands.encoder();
   const pass=command.beginRenderPass({width:64,height:64,
     colorLoad:"clear",clearColor:[0,1,0,1]});
   pass.drawIndexed({program,vertexArray:vao,count:3,instances:1});
   pass.end();const stale=command.finish();
   device.release(vao);
   try{stale.submit();}catch{retiredBlocked=true;}
   const afterStale=px(32,32);
   frame.dispose();surface.dispose();device.dispose();
   return {inside,outside,cleared,afterStale,
     nestedBlocked:attemptedNested,computeBlocked,twiceBlocked,bundleClosed,
     invalidBlendBlocked,
     retiredBlocked,run:run.scene,after:after.scene,
     before,commandStats,disposed:device.stats()};
 });
 assert.ok(r.inside[0]>235&&r.inside[2]<15,
   "Real original GL command encoder must draw red GPU indexed triangle");
 assert.deepEqual(r.outside.slice(0,3),[0,0,0],
   "Scissor must constrain authored geometry to the render-pass rectangle");
 assert.deepEqual(r.cleared.slice(0,3),[0,0,255],
   "Subsequent pass clear must discard prior draw and UI scissor state");
 assert.deepEqual(r.afterStale.slice(0,3),[0,0,255],
   "Retired draw validation must fail before clearing/mutating framebuffer");
 assert.equal(r.run.drawCalls,1);
 assert.equal(r.after.drawCalls,0);
 assert.ok(r.bundleClosed&&r.invalidBlendBlocked,
   "Immutable render bundle and invalid GL blend state must fail closed");
 assert.ok(r.nestedBlocked&&r.computeBlocked&&r.twiceBlocked&&r.retiredBlocked,
   "Unsupported compute, nested render passes, duplicate submits and stale VAOs must fail closed");
 assert.equal(r.commandStats.submissions,2);
 assert.equal(r.commandStats.drawCalls,1);
 assert.equal(r.disposed.resources,0);
 console.log("ORIGINAL_GL_GPU_COMMAND_DEVICE_SURFACE_FRAME_PIXELS_PASS",JSON.stringify(r));
}finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
