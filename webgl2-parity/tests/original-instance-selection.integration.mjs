import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Exact OpenSRO source required for original instance residency tests");
const dir=dirname(fileURLToPath(import.meta.url));
const out=join(dir,"original-instance-selection-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-instance-selection.ts")],
  bundle:true,platform:"node",format:"esm",target:"es2022",outfile:out,
  alias:{"@":root+"/apps/client-next/src"}});
const {createOriginalInstanceSelection}=await import(pathToFileURL(out).href);
const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const model=(id)=>{
 const a=I.slice(),b=I.slice();a[12]=1;b[12]=500;
 return {
  id,center:[0,0,0],radius:520,instanceRadius:2,
  material:{color:[1,1,1,1],texture:"/assets/actual-model.png",objectFade:true},
  geometry:{
   positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
   indices:new Uint32Array([0,1,2]),transform:I,instances:new Float32Array([...a,...b])
  },
  visibility:[
   {id:"native-building-near",radius:2,range:200,sceneryRange:false,
    cells:[[0,0]],cellRadius:0},
   {id:"native-building-far",radius:2,range:200,sceneryRange:false,
    cells:[[2,0]],cellRadius:0}
  ]
 };
};
test("original residentSlots selects only Silkroad placements in target map cell",()=>{
 const group=model("original-placement-pair");
 const original=group.geometry.instances.slice();
 const selector=createOriginalInstanceSelection([group]);
 const near=selector.select({eye:[1,0,0],target:[0,0,0]},1/60,1);
 assert.equal(near.length,1);
 assert.equal(near[0].id,group.id);
 assert.equal(near[0].count,1);
 assert.equal(near[0].matrices[12],1);
 assert.equal(near[0].opacity[0],1);
 const far=selector.select({eye:[500,0,0],target:[640,0,0]},1/60,2);
 assert.equal(far.length,1);
 assert.equal(far[0].count,1);
 assert.equal(far[0].matrices[12],500);
 assert.equal(far[0].opacity[0],1);
 assert.deepEqual([...group.geometry.instances],[...original],
   "Original actor/world placement matrix buffer must remain unchanged");
 assert.equal(selector.stats().fadingPlacements,2);
 selector.dispose();
 assert.throws(()=>selector.select({eye:[0,0,0],target:[0,0,0]},1/60,3),/disposed/);
});
test("existing GPU fades share placement id between object material parts",()=>{
 const x=model("partA"),y=model("partB");
 const selector=createOriginalInstanceSelection([x,y]);
 const selected=selector.select({eye:[1,0,0],target:[0,0,0]},1/60,1);
 assert.equal(selected.length,2);
 assert.equal(selected[0].matrices[12],1);
 assert.equal(selected[1].matrices[12],1);
 assert.equal(selector.stats().fadingPlacements,1,
   "Native material pieces of a building share one original fade record");
 selector.dispose();
});
test("wrong target frames or out-of-budget time are rejected",()=>{
 const selector=createOriginalInstanceSelection([model("part")]);
 assert.throws(()=>selector.select({eye:[NaN,0,0],target:[0,0,0]},1/60,1),/invalid/);
 selector.select({eye:[0,0,0],target:[0,0,0]},1/60,1);
 assert.throws(()=>selector.select({eye:[0,0,0],target:[0,0,0]},1/60,1),/invalid/);
 assert.throws(()=>selector.select({eye:[0,0,0],target:[0,0,0]},Infinity,2),/invalid/);
 selector.dispose();
});
