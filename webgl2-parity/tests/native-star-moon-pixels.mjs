import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Pinned original OpenSRO checkout required");
const dir=dirname(fileURLToPath(import.meta.url));
const bundle=join(dir,"native-star-moon-bundle.js");
await build({entryPoints:[join(dir,"native-sky-source-bridge.ts")],
  bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:bundle,
  alias:{"@":root+"/apps/client-next/src"}});
const server=http.createServer((req,res)=>{
 if(req.url==="/sky.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});
   res.end(readFileSync(bundle));return;
 }
 res.writeHead(200,{"Content-Type":"text/html"});
 res.end("<!doctype html><title>Original Silkroad stars and lunar phase pixel test</title>");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:160,height:160}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const data=await page.evaluate(async()=>{
   const {skyGroups,worldEnvironment,OriginalWorldWebgl2}=await import("/sky.js");
   const frames=["/native/moon/phase-0.dds","/native/moon/phase-1.dds"];
   const stars=Array.from({length:3000},(_,i)=>({
     x:i===0?20000:-20000,y:0,z:0,colorArgb:0xffff0000
   }));
   const original=skyGroups({
     moonTexturePublicPaths:frames,
     starPrimitive:{vertices:stars}
   });
   const star=original.find(g=>g.material.sky===2);
   const moon=original.find(g=>g.material.sky===4);
   if(!star||!moon||!star.geometry.maskUVs)throw Error("Pinned original sky group shape changed");
   const canvas=document.createElement("canvas");
   canvas.width=96;canvas.height=96;document.body.appendChild(canvas);
   const gl=canvas.getContext("webgl2");
   const gpu=new OriginalWorldWebgl2(canvas,64);
   const camera={eye:[0,0,0],target:[1,0,0],fov:Math.PI/2,near:.1,far:100000};
   const pack=worldEnvironment(undefined,camera,1,0);
   pack[48]=.8; // night, moon near +X
   pack[51]=1;pack[56]=1; // author Moon frame 1
   pack[57]=1/96;pack[58]=1/96; // source original viewport pixel scale
   pack.fill(0,60,72);
   pack[60]=255; // first native sky star flicker batch
   gpu.set(star.id,{...star.geometry,material:star.material});
   gpu.set(moon.id,{...moon.geometry,material:moon.material});
   const native=(r,g,b)=>({kind:"native-texture",format:"bgra8unorm",
     width:1,height:1,levels:[new Uint8Array([b,g,r,255])]});
   gpu.setTexture(frames[0],native(255,0,0));
   gpu.setTexture(frames[1],native(0,255,0));
   const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const read=(x=48,y=48)=>{const p=new Uint8Array(4);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];
   };
   gpu.setOriginalLighting(pack,false,false);
   const starFrame=gpu.render(I,[star.id]);
   const visibleStar=read();
   pack[60]=0;gpu.setOriginalLighting(pack,false,false);
   gpu.render(I,[star.id]);
   const invisibleStar=read();
   // The authentic moon moves on a separate 1.2x lunar arc: center it with
   // the original cameraBasis() rather than assuming it sits at the sun's
   // center. This retains the original vertex sky projection unchanged.
   const lunarArc=(.25+(fract(.8+.25)-.25)*1.2)*Math.PI*2;
   function fract(v){return v-Math.floor(v);}
   const lunarCamera={...camera,
     target:[Math.cos(lunarArc),Math.sin(lunarArc),0]};
   const lunarPacked=worldEnvironment(undefined,lunarCamera,1,0);
   pack.set(lunarPacked.subarray(16,28),16);
   gpu.setOriginalLighting(pack,false,false);
   gpu.render(I,[moon.id]);const moonFrame1=read();
   pack[56]=0;gpu.setOriginalLighting(pack,false,false);
   gpu.render(I,[moon.id]);const moonFrame0=read();
   pack[48]=.6;gpu.setOriginalLighting(pack,false,false);
   gpu.render(I,[moon.id]);const daytimeMoon=read();
   gpu.dispose();
   return {
     sourceStarVertices:star.geometry.positions.length/3,
     sourceStarIndices:star.geometry.indices.length,
     sourceStarMask:star.geometry.maskUVs.length,
     sourceMoonTextureFrames:moon.material.frames,
     starTriangles:starFrame.triangleCount,
     visibleStar,invisibleStar,moonFrame1,moonFrame0,daytimeMoon
   };
 });
 assert.equal(data.sourceStarVertices,12000,
   "Use exact 3000 original four-vertex star billboards");
 assert.equal(data.sourceStarIndices,18000);
 assert.equal(data.sourceStarMask,24000);
 assert.deepEqual(data.sourceMoonTextureFrames,[
   "/native/moon/phase-0.dds","/native/moon/phase-1.dds"
 ]);
 console.log("ORIGINAL_STAR_MOON_DIAGNOSTIC",JSON.stringify(data));
 assert.equal(data.starTriangles,6000);
 assert.ok(data.visibleStar[0]>180&&data.visibleStar[1]<40,
   "OpenSRO star mask UV + batch flicker must render true source-color GPU pixels");
 assert.ok(data.invisibleStar[0]<20,"Source batch flicker zero must hide real star");
 assert.ok(data.moonFrame1[1]>200&&data.moonFrame1[0]<40,
   "Original lunar frame 1 must use its distinct authored texture");
 assert.ok(data.moonFrame0[0]>200&&data.moonFrame0[1]<40,
   "Original lunar frame 0 must replace frame 1 on lunar day update");
 assert.ok(data.daytimeMoon[0]<20&&data.daytimeMoon[1]<20,
   "Original moon daytime gate must hide authored moon");
 console.log("ORIGINAL_SILKROAD_NATIVE_STAR_MOON_GPU_PIXELS_PASS",JSON.stringify(data));
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
