/*
 * Real OpenSRO decoder + genuine 2007 Silkroad v1.150 asset bundles.
 *
 * No generated scenes, no HTML login clone, no procedural meshes.
 * The SAME pinned asset-worker world.ts is compiled for this Node diagnostic;
 * geometry comes only from the user's existing verified TEST SROPACK2 packs.
 *
 * This proves decoded ORIGINAL WorldScene compatibility and categorizes the
 * remaining GLSL material/terrain gaps. It DOES NOT prove playable WebGL2.
 */
import assert from "node:assert/strict";
import {build} from "esbuild";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {createOriginalPackReader} from "../server/native-pack-reader.mjs";

const original=process.env.SRO_SOURCE_ROOT;
const cdnBase=process.env.HIEUSRO_TEST_PACK_CDN;
if(!original||!cdnBase)throw Error("Pinned original source and isolated TEST CDN required");
const source=resolve(original,"apps/client-next/src");
const dir=dirname(fileURLToPath(import.meta.url));
const compiled=join(dir,"native-original-world-decoder-bundle.mjs");
await build({
 entryPoints:[join(source,"engine/runtime/assets/worker/world/world.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:compiled,
 alias:{"@":source},
});
const {createWorldDecoder}=await import(pathToFileURL(compiled).href);
const terrainModule=join(dir,"original-native-terrain-real-bundle.mjs");
await build({
 entryPoints:[join(dir,"../src/original-terrain-selection.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:terrainModule,
 alias:{"@":source}
});
const {selectOriginalTerrain}=await import(pathToFileURL(terrainModule).href);
assert.equal(typeof createWorldDecoder,"function");
const reader=createOriginalPackReader({cdnBase,cacheBudgetBytes:0});
const stage=process.env.HIEUSRO_NATIVE_SCENE ||
 "/assets/world/constantinople/region-6951.json";
if(!/^\/assets\/world\/[a-z0-9-]+\/region-[0-9a-f]+\.json$/.test(stage))
 throw Error("Invalid original TEST region path");
const started=performance.now();
const bytes=await reader.read(stage);
if(bytes.length>128*1024*1024)
 throw Error("Real world region exceeds original worker's 128MiB budget");
const decoder=createWorldDecoder();
const usedPaths=new Set();
let dependencyBytes=0;
const referenced=async path=>{
 usedPaths.add(path);
 const data=await reader.read(path);
 dependencyBytes+=data.byteLength;
 if(dependencyBytes>128*1024*1024)
   throw Error("Original stage dependency transaction over 128MiB");
 return data;
};
const resolved=await decoder.resolve(bytes,referenced,stage);
const scene=decoder.decode(resolved,true);
assert.equal(typeof scene.id,"string");
assert.ok(Array.isArray(scene.groups)&&scene.groups.length>0,
 "Authentic original WorldScene must have decoded mesh groups");
const terrainGroup=scene.groups.find(g=>g.material?.terrain&&g.ranges?.some(r=>r.lod===0&&r.indexCount>0));
if(!terrainGroup)
 throw Error("Real HieuSRO title scene has no authored full-detail terrain range");
const sourcePositions=terrainGroup.geometry.positions.slice();
const sourceIndices=terrainGroup.geometry.indices.slice();
const terrainFull=selectOriginalTerrain(terrainGroup,{eye:[0,0,0]},"full");
assert.ok(terrainFull.triangles>0&&terrainFull.rangeCount>0,
 "Original title LOD0 must select real terrain cell triangles");
assert.ok(terrainFull.geometry.indices.length<terrainGroup.geometry.indices.length,
 "Original title terrain must not submit the unselected LOD1-LOD3 triangles");
assert.deepEqual(terrainGroup.geometry.positions,sourcePositions,
 "WebGL2 original terrain admission never mutates the pinned decoder source");
assert.deepEqual(terrainGroup.geometry.indices,sourceIndices,
 "WebGL2 terrain indices must not overwrite other client-native LOD buffers");
console.log("REAL_ORIGINAL_SILKROAD_TERRAIN_LOD0_VERIFIED",JSON.stringify({
 scene:scene.id,group:terrainGroup.id,selectedCells:terrainFull.rangeCount,
 triangles:terrainFull.triangles,changedVertices:terrainFull.changedVertices
}));
const textures=new Set(),materials={lit:0,unlit:0,terrain:0,animated:0,mask:0,advanced:0};
const blocked={};
let meshVertices=0,meshTriangles=0,instances=0;
const reasons=[];
for(const g of scene.groups){
 const geometry=g.geometry,mat=g.material??{};
 if(!geometry?.positions || !geometry?.indices)
   throw Error("Original decoder published group with no mesh/index data: "+g.id);
 meshVertices+=geometry.positions.length/3;
 meshTriangles+=geometry.indices.length/3;
 const sourceFlags=[];
 if(g.instances?.length){instances++;sourceFlags.push("instanced");}
 if(g.visibility?.length||g.ranges?.length)sourceFlags.push("visibility/ranges");
 if(g.animation)sourceFlags.push("animated-stage");
 if(g.material?.terrain)sourceFlags.push("terrain");
 if(g.material?.sky||g.material?.water)sourceFlags.push("environment");
 if(g.material?.textureStage||g.material?.lightmap)sourceFlags.push("multistage/lightmap");
 if(g.material?.frames||g.material?.textureAlpha||g.material?.surfaceAlpha)
   sourceFlags.push("material-animation/alpha");
 if(g.material?.texture)textures.add(g.material.texture);
 if(mat.unlit===false)materials.lit++;else materials.unlit++;
 if(mat.terrain)materials.terrain++;
 if(g.animation)materials.animated++;
 if(mat.textureStage||mat.lightmap||mat.environmentReflection)materials.advanced++;
 for(const flag of sourceFlags){
   blocked[flag]=(blocked[flag]??0)+1;
   if(reasons.length<20)reasons.push({group:g.id,reason:flag});
 }
}
const outcome={
 actualPinnedOpenSroDecoder:true,
 nativeScenePath:stage,sceneId:scene.id,originRegion:scene.originRegion,
 groups:scene.groups.length,meshVertices,meshTriangles,
 uniqueTextures:textures.size,instancedGroups:instances,materials,
 unsupportedSourceFeatureCounts:blocked,examples:reasons,
 binarySourceMiB:Number((bytes.length/1048576).toFixed(2)),
 dependencyMiB:Number((dependencyBytes/1048576).toFixed(2)),
 dependencyPaths:usedPaths.size,
 durationMs:Math.round(performance.now()-started),
 resourceStats:reader.stats(),
 disclaimer:"Authentic decoder data only; this is not yet full WebGL2 world rendering, character login or playability."
};
console.log("ORIGINAL_OPEN_SRO_REAL_WORLD_SCENE_DECODE_PASS",JSON.stringify(outcome));
