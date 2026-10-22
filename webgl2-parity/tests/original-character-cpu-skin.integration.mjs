import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";

const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("CPU skin parity tests require pinned original OpenSRO source");
const dir=dirname(fileURLToPath(import.meta.url)),file=join(dir,"skinning-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-character-cpu-skin.ts")],
  bundle:true,platform:"node",format:"esm",target:"es2022",outfile:file,
  alias:{"@":root+"/apps/client-next/src"}});
const {createOriginalCpuCharacterSkin}=await import(pathToFileURL(file).href);
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const primitive=()=>({
 name:"Silkroad_Retail_Skeleton_Mesh",
 node:0,
 joints:[0],
 inverseBind:identity(),
 image:0,
 geometry:{
  positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
  normals:new Float32Array([0,1,0,0,1,0,0,1,0]),
  indices:new Uint32Array([0,1,2]),
  uvs:new Float32Array([0,0,1,0,0,1]),
  joints:new Uint32Array([0,0,0,0,0,0,0,0,0,0,0,0]),
  weights:new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),
  transform:identity(),
  material:{unlit:true,doubleSided:true,color:[1,1,1,1]}
 }
});
const model=(p=primitive())=>({
 nodes:[{name:"Bip01",parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],
 primitives:[p],images:[{width:1,height:1}],
 clips:[{name:"original_walk",duration:2,channels:[{
  node:0,path:"translation",interpolation:"LINEAR",
  times:new Float32Array([0,1,2]),
  values:new Float32Array([0,0,0,2,0,0,0,0,0])
 }]}]
});
const actor=(time,clip="original_walk")=>({
 clip,time,loop:true,layers:undefined,bodyVolume:undefined,boneRotation:undefined
});
test("Original OpenSRO createCharacterPose samples real skeleton clip, WebGL2 CPU skin follows palette",()=>{
 const p=primitive(),m=model(p),owner=createOriginalCpuCharacterSkin(m);
 const sourceBefore=p.geometry.positions.slice(),paletteBefore=p.inverseBind.slice();
 const initial=owner.skin(p,actor(0));assert.equal(initial.boneCount,1);
 assert.deepEqual([...initial.geometry.positions],[0,0,0,1,0,0,0,1,0]);
 const half=owner.skin(p,actor(.5));
 for(const [i,expected] of [[0,1],[3,2],[6,1]])assert.ok(Math.abs(half.geometry.positions[i]-expected)<1e-5);
 const end=owner.skin(p,actor(1));assert.equal(end.geometry.positions[0],2);
 assert.deepEqual([...p.geometry.positions],[...sourceBefore],"Never mutate the original authored vertex stream");
 assert.deepEqual([...p.inverseBind],[...paletteBefore],"Keep exact native inverse-bind matrices");
 assert.equal(half.geometry.joints,undefined,"CPU skinning sends unskinned VBO to WebGL2 draw");
});
test("Unknown native animation, corrupt influences and unsupported cloth cannot silently become fake models",()=>{
 const p=primitive(),owner=createOriginalCpuCharacterSkin(model(p));
 assert.throws(()=>owner.skin(p,actor(0,"nonexistent_retail_BAN")),/Missing animation/);
 const corrupted=primitive();
 corrupted.geometry.joints[0]=3;
 assert.throws(()=>createOriginalCpuCharacterSkin(model(corrupted)).skin(corrupted,actor(0)),/joint\/weight/);
 const cloth={...primitive(),cloth:{positions:new Float32Array(1)}};
 assert.throws(()=>createOriginalCpuCharacterSkin(model(cloth)).skin(cloth,actor(0)),/effects\/cloth/);
});
test("Original native skeleton+skin width budget is enforced before admission",()=>{
 const p=primitive(),m=model(p);m.nodes=[];
 assert.throws(()=>createOriginalCpuCharacterSkin(m),/skeleton/);
 const other=primitive(),owner=createOriginalCpuCharacterSkin(model(other));
 assert.throws(()=>owner.skin(primitive(),actor(0)),/Unknown native character primitive/);
});
