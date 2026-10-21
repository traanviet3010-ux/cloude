import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const dir=dirname(fileURLToPath(import.meta.url));
const out=join(dir,"original-stage-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-frontend-stage.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:out});
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
function renderer(){
 const present=new Map(),updates=[],textures=new Map();
 let pinned=[];
 return {
   set(id,geom){updates.push([id,geom]);if(geom)present.set(id,geom);else present.delete(id);},
   setTexture(path,image){if(image)textures.set(path,image);else textures.delete(path);},
   hasTexture:path=>textures.has(path),
   protectPendingTextures(paths){pinned=[...paths];},
   getPinned:()=>[...pinned],present,updates,textures
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
 assert.throws(()=>bridge.adoptWorld(lease("other",[group("old")])),/safe atomic replacement/);
 bridge.dispose();
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
