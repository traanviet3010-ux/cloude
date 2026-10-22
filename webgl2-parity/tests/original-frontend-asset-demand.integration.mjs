/**
 * Integration with the REAL pinned OpenSRO createFrontendStage() owner,
 * not a replacement frontend. AssetOwner is simulated with ORIGINAL path
 * and result contracts; no claim of an authenticated game session or real
 * network streaming is made by this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Pinned original OpenSRO checkout required");
const src=join(root,"apps/client-next/src");
const dir=dirname(fileURLToPath(import.meta.url));
const entry=join(dir,"../src/original-frontend-stage.ts");
const other=join(src,"engine/runtime/frontend/stage/stage.ts");
const outputs=[join(dir,"native-stage-demand-bridge.mjs"),join(dir,"original-stage-owner-demand.mjs")];
await Promise.all([entry,other].map((point,i)=>build({
  entryPoints:[point],bundle:true,write:true,outfile:outputs[i],
  platform:"node",format:"esm",target:"es2022",alias:{"@":src}
})));
const {createOriginalStageBridge}=await import(pathToFileURL(outputs[0]).href);
const {createFrontendStage}=await import(pathToFileURL(outputs[1]).href);

const transform=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const geometry=()=>({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
  uvs:new Float32Array([0,0,1,0,0,1]),
  indices:new Uint32Array([0,1,2]),transform});
const groups=Array.from({length:9},(_,i)=>({
  id:"retail-authored-"+i,geometry:geometry(),
  material:{unlit:true,color:[1,1,1,1],
    texture:"/assets/sro/native-"+i+".png"},
  center:[0,0,0],radius:1
}));
function fakeWorld(){
 const meshes=new Map(),textures=new Map();
 return {meshes,textures,
  set(id,geom){if(geom)meshes.set(id,geom);else meshes.delete(id);},
  setTexture(path,image){if(image)textures.set(path,image);else textures.delete(path);},
  hasTexture:path=>textures.has(path),
  protectPendingTextures(){},protectStageGroups(){},
  protectStageGroup(id){assert.ok(meshes.has(id));},
  updateOriginalTerrain(){throw Error("No terrain in this fixture");}
 };
}
function makeAssets(bridge){
 let id=0,maxInflight=0;const inflight=new Map(),log=[];
 const stats=()=>({maxInflight,requested:log});
 const owner={
   available(){return Math.max(0,3-inflight.size);},
   request(url){
     if(inflight.size>=3)throw Error("Fixture exceeded original asset worker concurrency");
     const path=new URL(url).pathname;
     let result;
     if(path.endsWith("/world-manifest.json")){
       result={kind:"bytes",buffer:new TextEncoder().encode(JSON.stringify({
         regionBundlePublicPath:"/assets/sro/native-region.world"
       })).buffer};
     }else if(path.endsWith("/native-region.world")){
       const lease={sceneId:"sro-original-city",takeWorld(){return{
         scene:{id:"sro-original-city",originRegion:0,groups,warnings:[]},
         bytes:2048,starBytes:0
       };}};
       result={kind:"world",world:lease,images:[]};
     }else if(path.endsWith(".png")){
       const n=Number(/native-(\\d+)\\.png$/.exec(path)?.[1]);
       assert.ok(Number.isSafeInteger(n)&&n>=0&&n<groups.length,
         "Only actual original scene material URLs can be requested");
       const cursor=groups.length-bridge.worldStats().pendingGroups;
       assert.ok(n<cursor+4,
         "Original frontend must not queue a distant texture outside the four-group window");
       result={kind:"image",image:{width:1,height:1,close(){}}};
     }else throw Error("Unexpected original asset request: "+path);
     const job=++id;inflight.set(job,result);log.push(path);
     maxInflight=Math.max(maxInflight,inflight.size);
     return job;
   },
   take(job){const value=inflight.get(job);if(value)inflight.delete(job);return value??null;},
   cancel(job){inflight.delete(job);}
 };
 return {owner,stats};
}
test("pinned native createFrontendStage requests bounded original WebGL2 texture windows",()=>{
 const world=fakeWorld(),bridge=createOriginalStageBridge(world);
 const {owner,stats}=makeAssets(bridge);
 const frontend=createFrontendStage(owner,bridge,"https://assets.example.invalid/");
 frontend.install("/assets/sro/world-manifest.json","distance");
 let ready=false;
 for(let frame=0;frame<35;frame++){
   frontend.step();
   bridge.step(2);
   if(frontend.ready()){ready=true;break;}
 }
 assert.equal(frontend.error(),null);
 assert.equal(ready,true,"Original createFrontendStage must progress to scene readiness");
 assert.equal(bridge.worldStats().residentGroups,9);
 assert.equal(bridge.worldStats().pendingTextures,0);
 assert.equal(stats().requested.filter(p=>p.endsWith(".png")).length,9,
   "Every genuine required original image requested exactly once");
 assert.ok(stats().maxInflight<=3,
   "Original AssetOwner concurrency/backpressure must remain intact");
 assert.deepEqual(bridge.drawIds(),groups.map(g=>g.id));
 frontend.dispose();bridge.dispose();
 assert.equal(world.meshes.size,0);
});
