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
   const actualRosterPick=game.pickFrontendCharacter(.5,.5,[4]);
   const originalNineRayPick=game.pickRenderedEntity(.5,.5);
   const excludedNineRayPick=game.pickRenderedEntity(.5,.5,[4]);
   const excludedRosterPick=game.pickFrontendCharacter(.5,.5,[999]);
   const outsideRosterPick=game.pickFrontendCharacter(0,0,[4]);
   const characterPixel=new Uint8Array(4);
   stageGl.readPixels(32,32,1,1,stageGl.RGBA,stageGl.UNSIGNED_BYTE,characterPixel);
   const complete={...state,originalStage:stageStats,nativePixel:[...nativePixel],
     characterFrame,characterPixel:[...characterPixel],actualRosterPick,
     excludedRosterPick,outsideRosterPick,originalNineRayPick,excludedNineRayPick};
   game.dispose();

   // End-to-end native WorldScene.visibility -> pinned OpenSRO
   // residentSlots/ObjectFades -> WebGL2 instance VBO -> GPU pixel readback.
   const placementCanvas=document.createElement("canvas");
   placementCanvas.width=64;placementCanvas.height=64;document.body.appendChild(placementCanvas);
   const placementGame=createOriginalSilkroadWebgl2(placementCanvas);
   const p0=I.slice(),p1=I.slice();p0[12]=-.55;p1[12]=.55;
   const placementGroup={
     id:"original-native-outdoor-building",
     center:[0,0,.5],radius:2,instanceRadius:1,
     material:{color:[1,0,1,1],unlit:true,objectFade:true,
       doubleSided:true,alphaCutoff:0,blend:false},
     geometry:{positions:new Float32Array([-.22,-.35,.5,.22,-.35,.5,0,.35,.5]),
       indices:new Uint32Array([0,1,2]),instances:new Float32Array([...p0,...p1]),
       transform:I},
     visibility:[
       {id:"original-placement-a",radius:1,range:200,cells:[[0,0]],cellRadius:0},
       {id:"original-placement-b",radius:1,range:200,cells:[[1,0]],cellRadius:0}
     ]
   };
   placementGame.adoptWorld({
     sceneId:"authored-original-scenery-instances",
     takeWorld:()=>({scene:{id:"authored-original-scenery-instances",originRegion:0,
       warnings:[],groups:[placementGroup]},bytes:2048,starBytes:0})
   },"full");
   placementGame.setWorldCamera({eye:[0,0,0],target:[0,0,1],fov:Math.PI/2,
     near:.1,far:10});
   placementGame.setUi({revision:1,width:64,height:64,quads:[]});
   const placedFrame=placementGame.originalFrontendFrame(2,0);
   const placedGl=placementCanvas.getContext("webgl2");
   const nativePlacementPixel=(x,y)=>{const p=new Uint8Array(4);
     placedGl.readPixels(x,y,1,1,placedGl.RGBA,placedGl.UNSIGNED_BYTE,p);
     return [...p];};
   complete.placedFirst=nativePlacementPixel(1,32);
   complete.placedSecond=nativePlacementPixel(62,32);
   complete.placedRow=Array.from({length:64},(_,x)=>nativePlacementPixel(x,32)[0]>220?x:-1).filter(x=>x>=0);
   complete.placedStats=placedFrame;
   placementGame.setWorld(null);
   complete.clearedStage=placementGame.originalFrontendFrame(2,.016);
   complete.clearedPixel=nativePlacementPixel(1,32);
   placementGame.dispose();

   // Pixel-level proof that authentic WorldGroup IDs may be shared by
   // intro/dock and the old GPU framebuffer persists until atomic publish.
   // Shader contract fixture only: no Silkroad assets or UI are regenerated.
   const overlapCanvas=document.createElement("canvas");
   overlapCanvas.width=64;overlapCanvas.height=64;
   document.body.appendChild(overlapCanvas);
   const overlapGame=createOriginalSilkroadWebgl2(overlapCanvas);
   const groupAt=(id,color,offset=0)=>({
     id,center:[offset,0,1],radius:1,
     material:{color,unlit:true,doubleSided:true,alphaCutoff:0,blend:false},
     geometry:{positions:new Float32Array([
       offset-.7,-.7,1,offset+.7,-.7,1,offset,.7,1
     ]),indices:new Uint32Array([0,1,2]),transform:I}
   });
   const stageLease=(id,groups)=>({sceneId:id,takeWorld:()=>({
     scene:{id,originRegion:0,warnings:[],groups},
     bytes:2048,starBytes:0
   })});
   const oldGroup=groupAt("reused-native-geometry",[1,0,0,1]);
   const nextGroups=[
     groupAt("reused-native-geometry",[0,1,0,1]),
     groupAt("dock-outside-camera",[0,0,1,1],8)
   ];
   overlapGame.setWorldCamera({eye:[0,0,0],target:[0,0,1],
     fov:Math.PI/2,near:.1,far:10});
   overlapGame.setUi({revision:1,width:64,height:64,quads:[]});
   const overlapGl=overlapCanvas.getContext("webgl2");
   const overlapPixel=()=>{const p=new Uint8Array(4);
     overlapGl.readPixels(32,32,1,1,overlapGl.RGBA,overlapGl.UNSIGNED_BYTE,p);
     return [...p];};
   overlapGame.adoptWorld(stageLease("original-intro",[oldGroup]),"full");
   overlapGame.originalFrontendFrame(1,0);
   const oldPixel=overlapPixel();
   overlapGame.adoptWorld(stageLease("cancelled-dock",nextGroups),"full");
   overlapGame.originalFrontendFrame(1,.016);
   const interruptedPixel=overlapPixel();
   overlapGame.cancelWorldUpdate();
   overlapGame.originalFrontendFrame(1,.032);
   const cancelledPixel=overlapPixel();
   overlapGame.adoptWorld(stageLease("original-dock",nextGroups),"full");
   overlapGame.originalFrontendFrame(1,.048);
   const pendingPixel=overlapPixel();
   const switchedFrame=overlapGame.originalFrontendFrame(1,.064);
   const switchedPixel=overlapPixel();
   complete.overlap={oldPixel,interruptedPixel,cancelledPixel,
     pendingPixel,switchedPixel,sceneId:switchedFrame.stage.sceneId,
     triangles:switchedFrame.triangleCount};
   overlapGame.dispose();

   // Safari/WebKit may dispatch webglcontextlost during the transition from
   // character selection to the original GameWorld. A destroyed generation
   // may release GPU state but MUST NOT try to draw into its lost context.
   const lostCanvas=document.createElement("canvas");
   lostCanvas.width=64;lostCanvas.height=64;document.body.appendChild(lostCanvas);
   const lostGame=createOriginalSilkroadWebgl2(lostCanvas);
   const lostGl=lostCanvas.getContext("webgl2");
   const lostPath="/assets/sro/retail-scene-on-lost-context.dds";
   const lostGroup={
     id:"retail-titled-mesh-on-context-loss",center:[0,0,1],radius:1,
     material:{color:[1,1,1,1],unlit:true,texture:lostPath,
       doubleSided:true,alphaCutoff:0,blend:false},
     geometry:{positions:new Float32Array([-.7,-.7,1,.7,-.7,1,0,.7,1]),
       uvs:new Float32Array([0,0,1,0,0,1]),
       indices:new Uint32Array([0,1,2]),transform:I}
   };
   lostGame.adoptWorld(stageLease("real-titled-scene-to-dispose",[lostGroup]),"full");
   lostGame.setWorldCamera({eye:[0,0,0],target:[0,0,1],
     fov:Math.PI/2,near:.1,far:10});
   lostGame.setWorldTexture(lostPath,{kind:"native-texture",
     width:1,height:1,format:"bgra8unorm",
     levels:[new Uint8Array([0,0,255,255])]});
   lostGame.setUi({revision:1,width:64,height:64,quads:[]});
   lostGame.originalFrontendFrame(1,0);
   // Dispatch the exact cancelable browser event used by WebGL context loss
   // handlers: no fabricated successful "context restored" is claimed.
   const lostEvent=new Event("webglcontextlost",{cancelable:true});
   lostCanvas.dispatchEvent(lostEvent);
   let rejectedLostFrame=false;
   try{lostGame.originalFrontendFrame(1,.016);}
   catch(err){rejectedLostFrame=/no longer available|context lost|unavailable/.test(String(err));}
   lostGame.dispose();
   complete.contextLoss={lostEventPrevented:lostEvent.defaultPrevented,
     rejectedLostFrame,disposed:true,glStillPresent:!!lostGl};
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
 assert.equal(data.actualRosterPick,4,
   "Original frontend picking must identify the real CPU-skinned character GID drawn in the previous frame");
 assert.equal(data.originalNineRayPick,4,
   "Original World_PickEntityAtScreenPoint 3x3 ray fan must select the already-painted actor");
 assert.equal(data.excludedNineRayPick,null,
   "Excluded native actor GIDs are not eligible for world ray selection");
 assert.equal(data.excludedRosterPick,null,
   "Other account/roster model GIDs must not be selected");
 assert.equal(data.outsideRosterPick,null,
   "Touching outside the actual drawn character triangle cannot select it");
 console.log("NATIVE_SRO_RESIDENT_PLACEMENT_DIAGNOSTIC",JSON.stringify({row:data.placedRow,first:data.placedFirst,second:data.placedSecond,stats:data.placedStats}));
 assert.ok(data.placedFirst[0]>225&&data.placedFirst[2]>225,
   "Original SRO WorldScene placement in resident target cell must be visible");
 assert.ok(data.placedSecond[0]<10&&data.placedSecond[2]<10,
   "Nonresident original placement must NOT be painted as invented scenery");
 assert.equal(data.placedStats.triangleCount,1,
   "Original GPU residentSlots must select only one original building instance");
 assert.equal(data.clearedStage.triangleCount,0,
   "Authentic frontend setWorld(null) must stop all title/dock geometry draw calls");
 assert.equal(data.clearedStage.stage.sceneId,null,
   "World-entry stage must not expose the last title scene as a fake playable world");
 assert.equal(data.clearedPixel[0],0,
   "Original title GPU pixels must disappear when original frontend clears world");
 for(const key of ["oldPixel","interruptedPixel","cancelledPixel","pendingPixel"]){
   assert.ok(data.overlap[key][0]>220&&data.overlap[key][1]<40,
     "Old native red geometry must remain on GPU until atomic stage publication: "+key);
 }
 assert.ok(data.overlap.switchedPixel[1]>220&&data.overlap.switchedPixel[0]<40,
   "After complete native stage upload, the reused original group ID must draw new green geometry");
 assert.equal(data.overlap.sceneId,"original-dock");
 assert.equal(data.overlap.triangles,2);
 assert.equal(data.contextLoss.lostEventPrevented,true,
   "WebGL lost-context handler must request browser restore only via native event");
 assert.equal(data.contextLoss.rejectedLostFrame,true,
   "No drawing is permitted against stale WebGL2 textures after context loss");
 assert.equal(data.contextLoss.disposed,true,
   "Original native scene and asset owners must cleanly dispose after lost context");
 console.log("ORIGINAL_OPEN_SRO_WORLD_AND_UI_ONE_WEBGL2_PASS",JSON.stringify(data));
}finally{await browser.close();await new Promise(r=>httpServer.close(r));}
