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
   // The previous original CIF/UI frame can leave a tiny scissor active.
   // The next WorldScene must clear the full target, never retain old sky.
   gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,2,2);
   renderer.render(identity,[]);
   const noSky=read(32,60);
   const ground={
     positions:new Float32Array([-.95,-.95,.6,.95,-.95,.6,0,.95,.6]),
     indices:new Uint32Array([0,1,2]),transform:identity,
     uvs:new Float32Array([0,0,1,0,.5,1])
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
   // Original lightmap pipeline uses ZERO / SRCCOLOR. Its blending factor
   // must be correct before enabling its separate texture/fog lightmap shader.
   renderer.set("original-red-base",{...ground,
     material:{color:[.8,.8,.8,1],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:false}});
   renderer.set("original-blue-additive",{...ground,
     material:{color:[.25,.5,1,1],unlit:true,doubleSided:true,
       alphaCutoff:0,blend:true,blendPair:{source:1,destination:3}}});
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const lightmapMultiply=read(32,32);
   // Real authored native WorldMaterial.lightmap must select the same blend
   // and a separate baked-light shader, not a synthetic BlendPair authored
   // by the test. It reads the original Environment shadow floor offset.
   const imagePath="/original/sro/terrain/lightmap-test.dds";
   renderer.setTexture(imagePath,{
     kind:"native-texture",width:1,height:1,format:"bgra8unorm",
     levels:[new Uint8Array([255,128,64,255])]
   });
   packed.set([.10,.10,.10],40);
   renderer.setOriginalLighting(packed,false,false);
   renderer.set("original-blue-additive",{...ground,
     material:{color:[1,1,1,1],texture:imagePath,unlit:true,
       lightmap:true,blend:false,doubleSided:true,alphaCutoff:0}});
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const realLightmap=read(32,32);
   // Source worldEnvironment: fogStart=env.fog.w (31),
   // fogEnd=env.settings.x (32), flag=settings.y (33) and
   // terrainFogColor=env.terrainFog.rgb (72..74). Identity matrix
   // gives native viewZ=1, halfway between 0 and 2.
   packed[31]=0;packed[32]=2;packed[33]=1;
   packed.set([.8,.2,.2],72);
   renderer.setOriginalLighting(packed,false,false);
   renderer.render(identity,["original-red-base","original-blue-additive"]);
   const linearFogLightmap=read(32,32);
   renderer.set("original-local-fog",{...ground,
     material:{color:[1,0,0,1],unlit:true,doubleSided:true,
       blend:false,alphaCutoff:0,
       fog:{color:0xff0000ff,nearPlane:0,farPlane:2,intensity:1}}});
   renderer.render(identity,["original-local-fog"]);
   const localFog=read(32,32);
   renderer.set("original-local-fog",{...ground,
     material:{color:[1,0,0,1],unlit:true,doubleSided:true,
       blend:false,alphaCutoff:0,fogDisabled:true,
       fog:{color:0xff0000ff,nearPlane:0,farPlane:2,intensity:1}}});
   renderer.render(identity,["original-local-fog"]);
   const fogDisabled=read(32,32);
   // Real original 8BA130 ground-decal bypasses depth test; ordinary decal
   // retains LEQUAL and therefore cannot draw through nearer geometry.
   const base={...ground,
     positions:new Float32Array([-.9,-.9,.2,.9,-.9,.2,0,.9,.2]),
     material:{color:[1,0,0,1],unlit:true,blend:false,
       doubleSided:true,alphaCutoff:0}};
   const far={...ground,
     positions:new Float32Array([-.9,-.9,.7,.9,-.9,.7,0,.9,.7]),
     material:{color:[0,1,0,.5],unlit:true,blend:false,
       doubleSided:true,alphaCutoff:0,groundDecal:true}};
   packed[33]=0;
   renderer.setOriginalLighting(packed,false,false);
   renderer.set("old-world-base",base);
   renderer.set("old-world-overlay",far);
   renderer.render(identity,["old-world-base","old-world-overlay"]);
   const groundDecal=read(32,32);
   renderer.set("old-world-overlay",{...far,
     material:{...far.material,groundDecal:false,decal:true}});
   renderer.render(identity,["old-world-base","old-world-overlay"]);
   const regularDecal=read(32,32);
   renderer.dispose();
   return {skyTop,skyBottom,noSky,additive,defaultAlpha,destAlpha,
     lightmapMultiply,realLightmap,linearFogLightmap,localFog,fogDisabled,
     groundDecal,regularDecal};
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
 assert.ok(result.lightmapMultiply[0]>40&&result.lightmapMultiply[0]<70&&
   result.lightmapMultiply[1]>90&&result.lightmapMultiply[1]<120&&
   result.lightmapMultiply[2]>180&&result.lightmapMultiply[2]<220,
   "OpenSRO lightmap ZERO/SRCCOLOR factor must multiply existing RGB");
 assert.ok(result.realLightmap[0]>55&&result.realLightmap[0]<90 &&
   result.realLightmap[1]>103&&result.realLightmap[1]<143 &&
   result.realLightmap[2]>180&&result.realLightmap[2]<222,
   "Actual WorldMaterial.lightmap texture must multiply terrain using source + packed shadow floor");
 // The newly ported original material fog also applies to the BASE
 // terrain before the lightmap-multiply pass: (.8 * .5) *
 // mix(bakedLight,terrainFog,.5). Retail GPU color is approximately
 // [59,41,61], not the former unfogged-base [115,81,122].
 assert.ok(result.linearFogLightmap[0]>54&&result.linearFogLightmap[0]<66 &&
   result.linearFogLightmap[1]>35&&result.linearFogLightmap[1]<49 &&
   result.linearFogLightmap[2]>54&&result.linearFogLightmap[2]<70,
   "Native terrain and lightmap fog must both compose before ZERO/SRCCOLOR multiply");
 assert.ok(result.localFog[0]>116&&result.localFog[0]<140&&
   result.localFog[2]>116&&result.localFog[2]<140,
   "Native material local fog must mix author RGB, near/far and original shader viewZ");
 assert.ok(result.fogDisabled[0]>240&&result.fogDisabled[2]<12,
   "D3DRS_FOGENABLE disabled material must retain author RGB without fog");
 assert.ok(result.groundDecal[0]>100&&result.groundDecal[0]<160&&
   result.groundDecal[1]>100&&result.groundDecal[1]<160,
   "Original ground decal must alpha-blend despite failing world depth comparison");
 assert.ok(result.regularDecal[0]>240&&result.regularDecal[1]<15,
   "Original regular decal must respect LEQUAL and never paint through closer geometry");
 console.log("ORIGINAL_OPEN_SRO_ATMOSPHERE_D3D_BLEND_PIXELS_PASS",JSON.stringify(result));
}finally{
 await browser.close();await new Promise(r=>server.close(r));
}
