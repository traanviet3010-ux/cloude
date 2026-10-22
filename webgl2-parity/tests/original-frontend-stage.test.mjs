import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const dir=dirname(fileURLToPath(import.meta.url));
const out=join(dir,"original-stage-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-frontend-stage.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:out,
 alias:{"@":process.env.SRO_SOURCE_ROOT+"/apps/client-next/src"}});
const {createOriginalStageBridge}=await import(pathToFileURL(out).href+"?t=1");

const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const mesh=()=>({
 positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
 indices:new Uint32Array([0,1,2]),transform:identity
});
const material=()=>({color:[1,1,1,1],unlit:true,doubleSided:false,alphaCutoff:0,blend:false});
function lease(id, groups,bytes=512){
 let n=0;
 return {sceneId:id,takeWorld(){n++;if(n>1)throw Error("lease consumed more than once");return{
 scene:{id,originRegion:0,groups,warnings:[]},bytes,starBytes:0};},count:()=>n};
}
function group(id,overrides={}){
 return {id,geometry:mesh(),material:material(),center:[0,0,0],radius:1,...overrides};
}
function renderer(maxSlots=Infinity){
 const present=new Map(),updates=[],textures=new Map();
 let pinned=[],stageProtected=new Set();
 return {
   updateOriginalTerrain(id,geom){
     assert.ok(present.has(id),"Native terrain must reuse a live geometry slot");
     const old=present.get(id);
     present.set(id,{...old,positions:geom.positions,indices:geom.indices});
     updates.push(["lod:"+id,geom]);
   },
   set(id,geom){
     updates.push([id,geom]);
     if(geom){
       if(!present.has(id)&&present.size>=maxSlots){
         const evict=[...present.keys()].find(key=>!stageProtected.has(key));
         if(evict)present.delete(evict);
         else throw Error("Native GPU residency limit");
       }
       present.set(id,geom);
     }else present.delete(id);
   },
   setTexture(path,image){if(image)textures.set(path,image);else textures.delete(path);},
   hasTexture:path=>textures.has(path),
   protectPendingTextures(paths){pinned=[...paths];},
   protectStageGroups(ids){stageProtected=new Set(ids);},
   protectStageGroup(id){
     assert.ok(present.has(id),"Only admitted native meshes can be pinned");
     stageProtected.add(id);
   },
   getPinned:()=>[...pinned],
   getStageProtected:()=>[...stageProtected],
   present,updates,textures
 };
}
test("genuine OpenSRO one-use scene lease, bounded frame uploads and honest renderer readiness",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 const actual=lease("sro-title-intro",[group("constantinople-1"),group("constantinople-2")]);
 bridge.adoptWorld(actual,"full");
 assert.equal(actual.count(),1);
 assert.equal(bridge.worldStats().sceneId,null);
 assert.equal(bridge.worldStats().pendingGroups,2);
 assert.deepEqual(bridge.drawIds(),[]);
 assert.equal(bridge.step(1),1);
 assert.equal(bridge.worldStats().pendingGroups,1);
 assert.deepEqual(bridge.drawIds(),[],"No incomplete stage can claim playable 3D");
 bridge.step(1);
 assert.equal(bridge.worldStats().sceneId,"sro-title-intro");
 assert.equal(bridge.worldStats().residentGroups,2);
 assert.deepEqual(bridge.drawIds(),["constantinople-1","constantinople-2"]);
 assert.equal(w.present.get("constantinople-1")?.material?.unlit,true);
 bridge.dispose();
 assert.equal(w.present.size,0);
 assert.throws(()=>bridge.step(),/disposed/);
});
test("unsupported native Silkroad lighting/animation/texture never silently draws flat fake scene",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 for(const data of [
   group("stage-lit",{material:{...material(),unlit:false}}),
   group("stage-skin",{geometry:{...mesh(),bones:new Float32Array(16)}}),
   group("stage-terrain",{material:{...material(),terrain:true}}),
   group("stage-animated",{animation:{model:"silkroad-native",primitive:0,clip:"idle"}}),
 ]) {
   assert.throws(()=>bridge.adoptWorld(lease("native-"+data.id,[data])),/lighting|staged|skeleton|terrain|animated/);
   assert.equal(bridge.worldStats().sceneId,null);
   assert.deepEqual(bridge.drawIds(),[]);
   assert.equal(w.present.size,0);
 }
 bridge.dispose();
});
test("old stage stays drawn until next complete real scene, then all stale GPU resources destroyed",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 bridge.adoptWorld(lease("original-intro",[group("first")]));
 bridge.step();
 bridge.adoptWorld(lease("original-dock",[group("second"),group("third")]));
 bridge.step(1);
 assert.deepEqual(bridge.drawIds(),["first"]);
 assert.ok(w.present.has("first"));
 bridge.step(1);
 assert.deepEqual(bridge.drawIds(),["second","third"]);
 assert.ok(!w.present.has("first"));
 bridge.dispose();
});
test("cancellation removes unfinished uploads but preserves original active stage",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 bridge.adoptWorld(lease("original-intro",[group("old")]));
 bridge.step();
 bridge.adoptWorld(lease("pending-next",[group("new-a"),group("new-b")]));
 bridge.step(1);bridge.cancelWorldUpdate();
 assert.deepEqual(w.getPinned(),[],"A cancelled scene must release its pending image leases");
 assert.equal(bridge.worldStats().sceneId,"original-intro");
 assert.ok(!w.present.has("new-a"));
 assert.deepEqual(bridge.drawIds(),["old"]);
 // Real scene leases may use the exact same WorldGroup ID. GPU keys must
 // remain separate and the active stage may only change after admission.
 bridge.adoptWorld(lease("other",[group("old")]));
 bridge.step();
 assert.equal(bridge.worldStats().sceneId,"other");
 assert.equal(bridge.drawEntries()[0].id,"old");
 assert.notEqual(bridge.drawEntries()[0].key,"old");
 assert.ok(!w.present.has("old"),"retired native GPU slot is released");
 bridge.dispose();
});
test("original GPU group ID reused across stages remains atomic during loading and rollback",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 bridge.adoptWorld(lease("real-intro",[group("shared"),group("intro-only")]));
 bridge.step(2);
 const previous=bridge.drawIds();
 bridge.adoptWorld(lease("real-dock",[group("shared"),group("dock-only")]));
 assert.equal(bridge.step(1),1);
 assert.deepEqual(bridge.drawIds(),previous,"old scene still owns presentation keys");
 const staged=[...w.present.keys()].filter(k=>!previous.includes(k));
 assert.equal(staged.length,1,"overlapping scene group must have its own GPU slot");
 assert.equal(w.present.has("shared"),true);
 bridge.cancelWorldUpdate();
 assert.deepEqual([...w.present.keys()].sort(),previous.slice().sort(),
   "rollback releases the temporary GPU slot, not the original mesh");
 bridge.adoptWorld(lease("real-dock-2",[group("shared"),group("dock-only")]));
 bridge.step(1);
 assert.deepEqual(bridge.drawIds(),previous,"partial next scene never published");
 bridge.step(1);
 assert.equal(bridge.worldStats().sceneId,"real-dock-2");
 const active=bridge.drawEntries();
 assert.deepEqual(active.map(row=>row.id),["shared","dock-only"]);
 assert.notEqual(active[0].key,"shared");
 assert.deepEqual([...w.present.keys()].sort(),active.map(row=>row.key).sort(),
   "retired GPU stage has no leaked geometry");
 bridge.dispose();
 assert.equal(w.present.size,0);
});
test("low GPU budget fails closed without evicting original visible or culled meshes",()=>{
 const w=renderer(1),bridge=createOriginalStageBridge(w);
 bridge.adoptWorld(lease("native-intro",[group("shared-native-mesh")]));
 bridge.step();
 assert.deepEqual(w.getStageProtected(),["shared-native-mesh"]);
 bridge.adoptWorld(lease("native-dock",[group("shared-native-mesh")]));
 assert.throws(()=>bridge.step(),/GPU residency limit/);
 assert.equal(bridge.worldStats().sceneId,"native-intro");
 assert.equal(bridge.worldStats().pendingGroups,0);
 assert.deepEqual(bridge.drawIds(),["shared-native-mesh"]);
 assert.ok(w.present.has("shared-native-mesh"),
   "Never evict real title mesh because a new authentic scene uses the same ID");
 assert.deepEqual(w.getStageProtected(),["shared-native-mesh"]);
 bridge.clearWorld();
 assert.deepEqual(w.getStageProtected(),[]);
 bridge.dispose();
});
test("native original terrain groups are admitted at LOD0 and updated in place with real camera cell",()=>{
 const w=renderer(),stage=createOriginalStageBridge(w);
 const heights=new Array(289).fill(2);
 const terrain=group("authentic-terrain",{
   material:{...material(),terrain:true},
   geometry:{...mesh(),
     positions:new Float32Array([0,0,0,320,0,0,0,0,320]),
     indices:new Uint32Array([0,1,2,0,2,1]),
     uvs:new Float32Array([0,0,1,0,0,1])
   },
   ranges:[
     {cell:[0,0],lod:0,indexStart:0,indexCount:3,
      vertexStart:0,vertexCount:3,center:[0,0,0],radius:320,heights,
      seamVertices:new Uint32Array([0,8])},
     {cell:[6,0],lod:1,indexStart:3,indexCount:3,
      vertexStart:0,vertexCount:3,center:[1920,0,0],radius:320,heights}
   ]
 });
 const originalIndices=[...terrain.geometry.indices];
 const originalPositions=[...terrain.geometry.positions];
 stage.adoptWorld(lease("native-terrain-world",[terrain]),"distance");
 stage.step();
 assert.equal(stage.worldStats().sceneId,"native-terrain-world");
 assert.deepEqual([...w.present.get("authentic-terrain").indices],[0,1,2],
   "Initial terrain admission draws only authored LOD0, not all four LODs");
 assert.equal(stage.updateTerrain([0,0,0]).updated,1);
 assert.deepEqual([...w.present.get("authentic-terrain").indices],[0,1,2,0,2,1],
   "Uses actual original terrainLod() range selection");
 assert.equal(stage.updateTerrain([0,0,0]).updated,0,
   "Same camera cell must not re-upload or rebuild geometry");
 assert.equal(stage.updateTerrain([14*320,0,0]).updated,1);
 assert.equal(w.present.get("authentic-terrain").indices.length,0,
   "Nonresident cell renders no invented terrain");
 assert.deepEqual([...terrain.geometry.indices],originalIndices);
 assert.deepEqual([...terrain.geometry.positions],originalPositions,
   "Original scene lease vertex/index arrays are never mutated");
 assert.equal(w.present.size,1,"LOD selection must not create a second GPU model");
 stage.dispose();
 assert.equal(w.present.size,0);
});
test("authentic outdoor WorldTerrainPart groups join exact original scene origin, no map regeneration",()=>{
 const world=renderer(),stage=createOriginalStageBridge(world);
 const city=group("original-city"),terrain=group("original-outdoor-terrain-part");
 const original=lease("outdoor-region",[city]);
 const part={region:32,origin:0,groups:[terrain],bytes:1024};
 stage.adoptWorld(original,"distance",[part]);
 stage.step(2);
 assert.equal(original.count(),1);
 assert.deepEqual(stage.activeGroups(),[city,terrain],
   "Native scene and terrain part groups retain original source references");
 assert.equal(stage.worldStats().sceneId,"outdoor-region");
 assert.deepEqual(stage.drawIds(),["original-city","original-outdoor-terrain-part"]);
 assert.deepEqual(part.groups,[terrain],"TerrainPart input is not rewritten");
 stage.dispose();
 assert.equal(world.present.size,0);
 const other=createOriginalStageBridge(renderer());
 assert.throws(()=>other.adoptWorld(lease("wrong-origin",[]),"distance",[
   {...part,origin:2}
 ]),/origin mismatch/);
 assert.throws(()=>other.adoptWorld(lease("duplicate-region",[]),"distance",[
   part,part
 ]),/WorldTerrainPart/);
 other.dispose();
});
test("stage lease input bounds and double admissions fail without overwriting the original stage",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 assert.throws(()=>bridge.adoptWorld(lease("large",[group("x")],200*1024*1024)),/budget/);
 bridge.adoptWorld(lease("valid",[group("one")]));
 assert.throws(()=>bridge.adoptWorld(lease("second",[group("two")])),/pending/);
 assert.equal(bridge.worldStats().pendingGroups,1);
 bridge.dispose();
});

test("native Constantinople scene waits for actual original WorldTexture before revealing GL geometry",()=>{
 const w=renderer(),bridge=createOriginalStageBridge(w);
 const path="/assets/title/constantinople/stone.dds";
 const g=group("real-constantinople-textured",{geometry:{...mesh(),uvs:new Float32Array([0,0,1,0,0,1])},
   material:{...material(),texture:path}});
 bridge.adoptWorld(lease("title-constantinople",[g]));
 assert.deepEqual(bridge.neededWorldTextures(),[path]);
 assert.deepEqual(w.getPinned(),[path],"Pin real pending texture to avoid evict/reload loops");
 assert.equal(bridge.worldStats().pendingTextures,1);
 assert.equal(bridge.step(),0);
 assert.deepEqual(bridge.drawIds(),[]);
 assert.throws(()=>bridge.setWorldTexture("/assets/other",{}),/Unrequested/);
 const image={kind:"native-texture",format:"bgra8unorm",width:1,height:1,levels:[new Uint8Array([3,2,1,255])]};
 bridge.setWorldTexture(path,image);
 assert.equal(w.textures.get(path),image);
 assert.deepEqual(bridge.neededWorldTextures(),[]);
 assert.equal(bridge.worldStats().pendingTextures,0);
 bridge.step();
 assert.equal(bridge.worldStats().sceneId,"title-constantinople");
 assert.deepEqual(w.getPinned(),[],"Release pending texture protection after full scene admission");
 assert.deepEqual(bridge.drawIds(),[g.id]);
 bridge.dispose();
});

test("original frontend world-entry setWorld(null) releases all completed and pending old GPU title groups",()=>{
 const w=renderer(),stage=createOriginalStageBridge(w);
 stage.adoptWorld(lease("authentic-title",[group("sro-old-1"),group("sro-old-2")]));
 stage.step(2);
 assert.equal(stage.worldStats().sceneId,"authentic-title");
 stage.adoptWorld(lease("authentic-dock",[group("sro-dock-1"),group("sro-dock-2")]));
 stage.step(1);
 assert.equal(w.present.size,3);
 stage.clearWorld();
 assert.equal(w.present.size,0);
 assert.equal(stage.worldStats().pendingGroups,0);
 assert.equal(stage.worldStats().sceneId,null);
 assert.deepEqual(stage.drawIds(),[]);
 assert.deepEqual(stage.activeGroups(),[]);
 assert.deepEqual(w.getPinned(),[]);
 stage.adoptWorld(lease("next-actual-stage",[group("sro-next")]));
 stage.step();
 assert.equal(stage.worldStats().sceneId,"next-actual-stage");
 stage.dispose();
});

test("Pandora-inspired four-group original texture demand window advances without blocking on distant groups",()=>{
 const world=renderer(),bridge=createOriginalStageBridge(world);
 const groups=Array.from({length:7},(_,i)=>group("native-group-"+i,{
   // Textured original Geometry always carries an authored UV stream;
   // no texture stand-in or generated procedural vertices are admitted.
   geometry:{...mesh(),uvs:new Float32Array([0,0,1,0,0,1])},
   material:{...material(),texture:"/assets/sro/authored-"+i+".texture"}
 }));
 bridge.adoptWorld(lease("original-large-constantinople-stage",groups));
 const path=i=>"/assets/sro/authored-"+i+".texture";
 assert.deepEqual(bridge.neededWorldTextures(),[0,1,2,3].map(path),
   "The unmodified OpenSRO frontend must request no more than four upcoming native groups");
 assert.equal(bridge.worldStats().pendingTextures,7,
   "Overall admission progress must retain all real texture dependencies");
 assert.equal(bridge.step(2),0,"Never draw a mesh without its real Silkroad material texture");
 const original={kind:"native-texture",format:"bgra8unorm",
   width:1,height:1,levels:[new Uint8Array([1,2,3,255])]};
 bridge.setWorldTexture(path(0),original);
 bridge.setWorldTexture(path(1),original);
 assert.equal(bridge.step(2),2,"Admit ready authentic groups even if distant textures still load");
 assert.deepEqual(bridge.drawIds(),[],"A partial next native stage never becomes the active scene");
 assert.deepEqual(bridge.neededWorldTextures(),[2,3,4,5].map(path));
 assert.equal(bridge.worldStats().pendingGroups,5);
 assert.equal(bridge.worldStats().pendingTextures,5);
 for(let i=2;i<6;i++)bridge.setWorldTexture(path(i),original);
 assert.equal(bridge.step(2),2);
 assert.equal(bridge.step(2),2);
 assert.deepEqual(bridge.neededWorldTextures(),[path(6)]);
 assert.equal(bridge.step(2),0,"Missing last original texture still gates whole-scene publication");
 bridge.setWorldTexture(path(6),original);
 assert.equal(bridge.step(2),1);
 assert.equal(bridge.worldStats().sceneId,"original-large-constantinople-stage");
 assert.equal(bridge.worldStats().residentGroups,7);
 assert.equal(bridge.worldStats().pendingTextures,0);
 assert.equal(bridge.neededWorldTextures().length,0);
 assert.deepEqual(bridge.drawIds(),groups.map(g=>g.id));
 bridge.dispose();
 assert.equal(world.present.size,0);
});


test("world readiness counters become positive only after an actual successful native GL scene frame",()=>{
 const world=renderer(),bridge=createOriginalStageBridge(world);
 bridge.adoptWorld(lease("actual-original-title-scene",[group("authentic-building")]));
 bridge.step();
 assert.equal(bridge.worldStats().residentGroups,1);
 assert.equal(bridge.worldStats().visibleGroups,0,
   "Admitted geometry is not proof a real GL frame painted");
 bridge.recordFrame(1,1);
 assert.equal(bridge.worldStats().visibleGroups,1);
 assert.equal(bridge.worldStats().triangles,1);
 bridge.adoptWorld(lease("next-scene",[group("authentic-new-building")]));
 assert.equal(bridge.worldStats().sceneId,null,
   "New scene admission still blocks frontend-ready even if prior scene was drawn");
 bridge.step();
 assert.equal(bridge.worldStats().sceneId,"next-scene");
 assert.equal(bridge.worldStats().visibleGroups,0,
   "Prior WebGL2 frame evidence cannot mark a different scene ready");
 bridge.recordFrame(1,1);
 assert.equal(bridge.worldStats().visibleGroups,1);
 assert.throws(()=>bridge.recordFrame(2,1),/frame evidence/);
 bridge.clearWorld();
 assert.equal(bridge.worldStats().visibleGroups,0);
 assert.equal(bridge.worldStats().triangles,0);
 bridge.dispose();
});
