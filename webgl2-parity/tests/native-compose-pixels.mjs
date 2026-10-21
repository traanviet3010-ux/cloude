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
   // Separate ownership pass: original (not synthetic HTML) WorldSceneLease
   // with a BGRA texture in native Silkroad renderer input contract.
   const nativeCanvas=document.createElement("canvas");
   nativeCanvas.width=64;nativeCanvas.height=64;document.body.appendChild(nativeCanvas);
   const game=createOriginalSilkroadWebgl2(nativeCanvas);
   const texturePath="/assets/title/constantinople/native-stone.dds";
   const realGroup={
      id:"native-constantinople-triangle",
      center:[0,0,1],radius:1,
      material:{color:[1,1,1,1],texture:texturePath,unlit:false,
        doubleSided:true,alphaCutoff:0,blend:false},
      geometry:{
         positions:new Float32Array([-.7,-.7,1,.7,-.7,1,0,.7,1]),
         normals:new Float32Array([0,1,0,0,1,0,0,1,0]),
         uvs:new Float32Array([0,0,1,0,.5,1]),
         indices:new Uint32Array([0,1,2]),
         transform:I
      }
   };
   const lease={sceneId:"constantinople-genuine-contract",takeWorld:()=>({
      scene:{id:"constantinople-genuine-contract",originRegion:0,warnings:[],groups:[realGroup]},
      bytes:4096,starBytes:0})};
   game.adoptWorld(lease,"full");
   game.setWorldCamera({eye:[0,0,0],target:[0,0,1],fov:Math.PI/2,
     near:.1,far:10});
   game.setWorldTexture(texturePath,{kind:"native-texture",width:1,height:1,
     format:"bgra8unorm",levels:[new Uint8Array([0,0,255,255])]});
   game.setUi({revision:1,width:64,height:64,quads:[]});
   const stageStats=game.originalFrontendFrame(2);
   const stageGl=nativeCanvas.getContext("webgl2");
   const nativePixel=new Uint8Array(4);
   stageGl.readPixels(32,32,1,1,stageGl.RGBA,stageGl.UNSIGNED_BYTE,nativePixel);
   // Original CharacterModel/CharacterActor + native BAN-channel schema:
   // shader-contract fixture only, NOT a downloaded retail character model.
   const skeletalPrimitive={
     name:"pinned-character-contract",node:0,joints:[0],inverseBind:I,image:0,
     geometry:{
       positions:new Float32Array([-.7,-.7,.5,.7,-.7,.5,0,.7,.5]),
       normals:new Float32Array([0,1,0,0,1,0,0,1,0]),
       uvs:new Float32Array([0,0,1,0,0,1]),
       indices:new Uint32Array([0,1,2]),
       joints:new Uint32Array(12),
       weights:new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),
       transform:I,
       material:{unlit:false,doubleSided:true,color:[1,1,1,1]}
     }
   };
   game.setCharacterModel("native-avatar-contract",{
     nodes:[{name:"Bip01",parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],
     primitives:[skeletalPrimitive],
     images:[{width:1,height:1}],
     clips:[{name:"native-idle",duration:1,channels:[{
       node:0,path:"translation",interpolation:"LINEAR",
       times:new Float32Array([0,1]),values:new Float32Array([0,0,0,0,0,0])
     }]}]
   },[{kind:"native-texture",width:1,height:1,format:"bgra8unorm",
       levels:[new Uint8Array([0,255,0,255])]}]);
   game.setCharacterActors([{
     gid:4,model:"native-avatar-contract",
     pose:{regionId:0,x:0,y:0,z:0,yaw:0},
     clip:"native-idle",time:0,loop:true,scale:1
   }]);
   const characterFrame=game.originalFrontendFrame(2);
   const characterPixel=new Uint8Array(4);
   stageGl.readPixels(32,32,1,1,stageGl.RGBA,stageGl.UNSIGNED_BYTE,characterPixel);
   const complete={...state,originalStage:stageStats,nativePixel:[...nativePixel],
     characterFrame,characterPixel:[...characterPixel]};
   game.dispose();
   return complete;
 });
 assert.ok(data.ui[0]>220&&data.ui[2]<40,"Authored UiScene must overlay the world on same WebGL2 context");
 assert.ok(data.mesh[2]>220&&data.mesh[0]<40,"Original geometry must remain visible after drawing native UI");
 assert.equal(data.stats.ui.drawCalls,1);
 assert.equal(data.stats.triangleCount,1);
 assert.ok(data.nativePixel[0]>230 && data.nativePixel[1]<25 && data.nativePixel[2]<25,
   "Original WorldTexture BGRA upload must texture genuine OpenSRO Geometry through native camera");
 assert.equal(data.originalStage.stage.sceneId,"constantinople-genuine-contract");
 assert.equal(data.originalStage.stage.pendingTextures,0);
 assert.ok(data.characterPixel[1]>220 && data.characterPixel[0]<40 && data.characterPixel[2]<40,
   "Native character CPU skinned mesh must render on top of original scene in one GL context");
 assert.equal(data.characterFrame.characters.actors,1);
 assert.equal(data.characterFrame.triangleCount,2);
 console.log("ORIGINAL_OPEN_SRO_WORLD_AND_UI_ONE_WEBGL2_PASS",JSON.stringify(data));
}finally{await browser.close();await new Promise(r=>httpServer.close(r));}
