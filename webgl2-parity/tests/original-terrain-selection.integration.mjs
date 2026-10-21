import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Pinned OpenSRO required for native terrain selection tests");
const dir=dirname(fileURLToPath(import.meta.url)),out=join(dir,"original-terrain-selection-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-terrain-selection.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:out,
 alias:{"@":root+"/apps/client-next/src"}});
const {selectOriginalTerrain}=await import(pathToFileURL(out).href);
const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const make=(corrupt=false)=>{
 const heights=new Array(289).fill(2),positions=new Float32Array(9);
 const original=new Uint32Array([0,1,2,2,1,0]);
 const g={id:"native-Silkroad-terrain",material:{terrain:true,color:[1,1,1,1]},
 geometry:{positions,indices:original,transform:I,uvs:new Float32Array(6)},
 ranges:[
 {cell:[0,0],lod:0,indexStart:0,indexCount:3,
  seamVertices:new Uint32Array([0,8]),heights},
 {cell:[6,0],lod:1,indexStart:3,indexCount:3,
  seamVertices:new Uint32Array([1,8]),heights}
 ]};
 if(corrupt)g.ranges[1].indexCount=120;
 return g;
};
test("title/character creation full detail selects original LOD0 indices only",()=>{
 const g=make(),sourcePos=g.geometry.positions.slice();
 const v=selectOriginalTerrain(g,{eye:[0,0,0]},"full");
 assert.equal(v.triangles,1);
 assert.equal(v.rangeCount,1);
 assert.deepEqual([...v.geometry.indices],[0,1,2]);
 assert.equal(v.geometry.positions[1],2);
 assert.deepEqual([...g.geometry.positions],[...sourcePos],
   "Do not mutate original GPU worker/WorldScene vertex stream");
 assert.equal(v.eyeCell[0],0);
});
test("original terrainLod 16 / 39 / 81 eye-cell squared thresholds preserved",()=>{
 const g=make();
 // At eye cell origin, (6,0) selects LOD1; (0,0) selects LOD0.
 const v=selectOriginalTerrain(g,{eye:[0,0,0]},"distance");
 assert.equal(v.rangeCount,2);
 assert.equal(v.triangles,2);
 assert.deepEqual([...v.geometry.indices],[0,1,2,2,1,0]);
 assert.equal(v.changedVertices,2);
 const away=selectOriginalTerrain(g,{eye:[14*320,0,0]},"distance");
 assert.equal(away.rangeCount,0,"Never render unchosen native cell LOD at arbitrary camera distances");
});
test("terrain range bounds and non-finite camera are rejected before renderer admission",()=>{
 assert.throws(()=>selectOriginalTerrain(make(true),{eye:[0,0,0]},"full"),/index range/);
 assert.throws(()=>selectOriginalTerrain(make(),{eye:[NaN,0,0]},"full"),/camera/);
 assert.throws(()=>selectOriginalTerrain({...make(),ranges:[]},{eye:[0,0,0]},"full"),/authored/);
});
