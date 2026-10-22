import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"native-draw-order-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-draw-order.ts")],
  bundle:true,platform:"node",format:"esm",outfile:output,target:"es2022"});
const {orderOriginalWorldGroups,orderOriginalGpuStageEntries}=
  await import(pathToFileURL(output).href);
const group=(id,material,materialOrder)=>({id,material,materialOrder});
test("native OpenSRO draw phases keep sky, terrain, lightmap, opaque and blend in retail order",()=>{
 const all=[
  group("transparent-first",{blend:true}),
  group("object-last",{blend:false}),
  group("sky-cloud",{sky:5}),
  group("lightmap",{lightmap:true}),
  group("terrain-blended",{terrain:true,blend:true,order:5}),
  group("sky-star",{sky:2}),
  group("terrain-opaque",{terrain:true,blend:false}),
  group("terrain-blended-first",{terrain:true,blend:true,order:1}),
  group("object-faded",{objectFade:true,blend:true}),
  group("transparent-second",{blend:true})
 ];
 const sorted=orderOriginalWorldGroups(all);
 assert.deepEqual(sorted.map(g=>g.id),[
  "sky-star","sky-cloud","terrain-opaque",
  "terrain-blended-first","terrain-blended","lightmap",
  "object-last","object-faded",
  "transparent-first","transparent-second"
 ]);
 assert.deepEqual(all.map(g=>g.id)[0],"transparent-first",
   "Never reorder original worker-owned group arrays");
});
test("native material set order overrides alphabetical sorting of object member names",()=>{
 const all=[
  group("z-member",{blend:false},{set:"multi-mesh-set",index:1}),
  group("a-member",{blend:false},{set:"multi-mesh-set",index:0}),
  group("standalone",{blend:false})
 ];
 assert.deepEqual(orderOriginalWorldGroups(all).map(g=>g.id),[
  "a-member","z-member","standalone"
 ]);
 const entries=all.map((g,i)=>({id:g.id,key:"original-gpu-"+i}));
 assert.deepEqual(orderOriginalGpuStageEntries(all,entries).map(x=>x.key),[
  "original-gpu-1","original-gpu-0","original-gpu-2"
 ]);
 assert.deepEqual(entries.map(x=>x.id),all.map(x=>x.id));
});
test("native draw list rejects duplicate or absent original GPU source IDs",()=>{
 const groups=[group("a",{blend:false}),group("b",{blend:false})];
 assert.throws(()=>orderOriginalWorldGroups([groups[0],groups[0]]),/unique/);
 assert.throws(()=>orderOriginalGpuStageEntries(groups,[{id:"a",key:"a"}]),/differ/);
 assert.throws(()=>orderOriginalGpuStageEntries(groups,[{id:"a",key:"a"},{id:"a",key:"b"}]),/Duplicate/);
 assert.throws(()=>orderOriginalGpuStageEntries(groups,[{id:"a",key:"a"},{id:"c",key:"c"}]),/missing/);
});
