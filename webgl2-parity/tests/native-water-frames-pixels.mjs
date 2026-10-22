import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";
const original=process.env.SRO_SOURCE_ROOT;
if(!original)throw Error("Exact original OpenSRO checkout required");
const dir=dirname(fileURLToPath(import.meta.url)),bundle=join(dir,"native-water-source-bundle.js");
await build({entryPoints:[join(dir,"native-water-source-bridge.ts")],
 bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:bundle,
 alias:{"@":original+"/apps/client-next/src"}});
const server=http.createServer((req,res)=>{
 if(req.url==="/water.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});
   res.end(readFileSync(bundle));
 }else{res.writeHead(200,{"Content-Type":"text/html"});
   res.end("<!doctype html><title>OpenSRO source water WebGL2 test</title>");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:192,height:128}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const data=await page.evaluate(async()=>{
   const {dungeonWaterGroup,viewProjection,worldEnvironment,OriginalWorldWebgl2}=
     await import("/water.js");
   const frames=Array.from({length:30},(_,i)=>"/original/dungeon/water-"+i+".dds");
   const dungeon=dungeonWaterGroup({
     blockIndex:0,
     vertices:[-1,0,-1,-1,0,1,1,0,1,1,0,-1],
     color:0x00ffffff,
     fog:{color:0,nearPlane:0,farPlane:10,intensity:0}
   },frames);
   const canvas=document.createElement("canvas");
   canvas.width=96;canvas.height=96;document.body.appendChild(canvas);
   const camera={eye:[0,2,0],target:[0,0,0],up:[0,0,-1],
     fov:Math.PI/2,near:.1,far:10};
   const matrix=viewProjection(camera,1);
   const gl=canvas.getContext("webgl2");
   const renderer=new OriginalWorldWebgl2(canvas,32);
   const pixel=()=>{const p=new Uint8Array(4);
     gl.readPixels(48,48,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
   const tex=(r,g,b)=>({kind:"native-texture",format:"bgra8unorm",
     width:1,height:1,levels:[new Uint8Array([b,g,r,255])]});
   for(let i=0;i<frames.length;i++)
     renderer.setTexture(frames[i],i===1?tex(0,255,0):tex(255,0,0));
   renderer.set(dungeon.id,{...dungeon.geometry,material:dungeon.material});
   const packed=worldEnvironment(undefined,camera,1,0);
   packed[33]=0;packed[34]=0;
   renderer.setOriginalLighting(packed,false,false);
   const first=renderer.render(matrix,[dungeon.id]),red=pixel();
   packed[34]=1;renderer.setOriginalLighting(packed,false,false);
   renderer.render(matrix,[dungeon.id]);const green=pixel();
   const water={...dungeon.material,water:true,color:[1,1,1,1],
     textureAlpha:false};
   renderer.set(dungeon.id,{...dungeon.geometry,material:water});
   packed.set([.2,.5,1],36);
   renderer.setOriginalLighting(packed,false,false);
   renderer.render(matrix,[dungeon.id]);const tinted=pixel();
   renderer.dispose();
   return {frames:dungeon.material.frames?.length,
     inputTriangles:dungeon.geometry.indices.length/3,drawTriangles:first.triangleCount,
     red,green,tinted};
 });
 assert.equal(data.frames,30,"Real dungeon native water owns 30 material frames");
 assert.equal(data.inputTriangles,2);
 assert.equal(data.drawTriangles,2);
 assert.ok(data.red[0]>80&&data.red[1]<12,
   "The original dungeon water must use its authored initial red source frame");
 assert.ok(data.green[1]>80&&data.green[0]<12,
   "Native settings.z 10Hz frame selector must choose authored second image");
 assert.ok(data.tinted[1]>35&&data.tinted[1]<100,
   "Native non-reflective world water must multiply source green by packed water tint");
 console.log("ORIGINAL_OPEN_SRO_DUNGEON_AND_WATER_FRAME_PIXELS_PASS",JSON.stringify(data));
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
