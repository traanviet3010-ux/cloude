/**
 * REAL v1.150 scene decode integration — not a playable scene or synthetic
 * mesh. Clone exact pinned OpenSRO and call its actual createWorldDecoder().
 *
 * CDN source is the user-owned, separately deployed immutable TEST SROPACK2.
 * Never downloads PK2 archives, changes server data, or touches LIVE/Icons.
 */
import {build} from "esbuild";
import {createOriginalPackReader} from "../server/native-pack-reader.mjs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir} from "node:fs/promises";
const root=process.env.SRO_SOURCE_ROOT;
if(!root||!resolve(root).includes("opensro-original"))
 throw Error("Pinned original OpenSRO checkout path required");
const src=join(root,"apps/client-next/src");
const entry=join(src,"engine/runtime/assets/worker/world/world.ts");
const scratch="/tmp/hieusro-original-v150-world-decoder";
await mkdir(scratch,{recursive:true});
const outfile=join(scratch,"decoder.mjs");
await build({entryPoints:[entry],bundle:true,platform:"node",format:"esm",
 target:"es2022",outfile,alias:{"@":src}});
const {createWorldDecoder}=await import(pathToFileURL(outfile).href);
const geometryOut=join(scratch,"original-webgl2-admission.mjs");
await build({entryPoints:[resolve("src/native-geometry.ts")],bundle:true,
  format:"esm",platform:"node",target:"es2022",outfile:geometryOut,
  alias:{"@":src}});
const {admitOriginalGeometry}=await import(pathToFileURL(geometryOut).href);

if(typeof createWorldDecoder!=="function")throw Error("Pinned real OpenSRO world decoder unavailable");
const reader=createOriginalPackReader({
 cdnBase:process.env.HIEUSRO_TEST_PACK_CDN,cacheBudgetBytes:96*1024*1024});
const scenePaths=[
 "/assets/world/constantinople/region-694e.json",
 "/assets/world/constantinople/region-6951.json",
 "/assets/world/constantinople/region-694f.json",
 "/assets/world/china/region-62a8.json"
];
const decode=createWorldDecoder();
for(const path of scenePaths){
 const bytes=await reader.read(path);
 const bundle=await decode.resolve(bytes,p=>reader.read(p),path);
 if(!bundle?.objects?.resources)
   throw Error("Original Silkroad scene resource catalog was not resolved: "+path);
 const scene=decode.decode(bundle,true);
 if(!Array.isArray(scene.groups)||!scene.groups.length||
   typeof scene.id!=="string"||!Number.isInteger(scene.originRegion))
   throw Error("Original Silkroad world decoder produced empty/invalid render scene: "+path);
 const counts={
   groups:scene.groups.length,
   terrain:0,lightmap:0,sky:0,water:0,lit:0,unlit:0,
   nativeTextureStages:0,withAnimations:0,cloth:0,instanced:0
 };
 let totalVertices=0,totalIndices=0;
 const texturePaths=new Set();
 const admissionReasons=new Map();let nativeGroupsAdmitted=0;
 const featureFlags={visibility:0,ranges:0,advancedMaterial:0,plainGeometry:0,
   eligibilityWithoutSceneCulling:0};

 for(const group of scene.groups){
   const m=group.material,g=group.geometry;
   if(m.terrain)counts.terrain++;
   if(m.lightmap)counts.lightmap++;
   if(m.sky)counts.sky++;
   if(m.water)counts.water++;
   if(m.unlit===false)counts.lit++;else counts.unlit++;
   if(m.textureStage)counts.nativeTextureStages++;
   if(group.animation)counts.withAnimations++;
   if(g.cloth)counts.cloth++;
   if(g.instances?.length)counts.instanced++;
   if(m.texture)texturePaths.add(m.texture);
   if(!g.positions?.length||!g.indices?.length)throw Error("Real region scene has empty geometry: "+group.id);
   totalVertices+=g.positions.length/3;totalIndices+=g.indices.length;
   if(group.visibility?.length)featureFlags.visibility++;
   if(group.ranges?.length)featureFlags.ranges++;
   if(m.terrain||m.water||m.sky||m.lightmap||m.textureStage)
     featureFlags.advancedMaterial++;
   try{
     admitOriginalGeometry({...g,material:m});
     featureFlags.plainGeometry++;
     if(!(group.animation||group.ranges||m.terrain||m.water||m.sky||m.lightmap))
       featureFlags.eligibilityWithoutSceneCulling++;
   }catch{}
   try{
     // Same material/stage safety gate as original-frontend-stage.ts;
     // no approximation or hidden disabled classes in this audit.
     if(group.animation||group.visibility||group.ranges||m.terrain||
        m.water||m.sky||m.lightmap)
       throw Error("original advanced scene-stage/terrain/sky/water/visibility path");
     const admitted=admitOriginalGeometry({...g,material:m});
     if(!admitted.instanceCount)throw Error("no native instance transform");
     nativeGroupsAdmitted++;
   }catch(error){
     const reason=String(error instanceof Error?error.message:error);
     admissionReasons.set(reason,(admissionReasons.get(reason)??0)+1);
   }
 }
 const out={
   path,sceneId:scene.id,originRegion:scene.originRegion,
   totalVertices,totalTriangles:totalIndices/3,
   texturePaths:texturePaths.size,counts,
   webgl2CurrentSupport:{
     featureFlags,
     admittedGroups:nativeGroupsAdmitted,blockedGroups:scene.groups.length-nativeGroupsAdmitted,
     blockerReasons:[...admissionReasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,14)
   },
   nativeEnvironment:!!scene.environment,navmeshInput:!!bundle.navmesh,
   sceneWarnings:scene.warnings.slice(0,12),
   transport:reader.stats()
 };
 console.log("REAL_ORIGINAL_OPEN_SRO_DECODED_WORLD_SCENE",JSON.stringify(out));
}
console.log("REAL_SRO_V150_ALL_FOUR_SCENES_DECODED_WITH_ORIGINAL_ENGINE=1");
console.log("NOTE: CPU scene decode/metadata does not mean the WebGL2 renderer can draw every material or run GameWorld.");
