import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFileSync} from "node:fs";
async function moduleAt(path) {
 const source=readFileSync(new URL(path,import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,
   module:ts.ModuleKind.ESNext}}).outputText;
 return await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
}
const {admitOriginalGeometry}=await moduleAt("../src/native-geometry.ts");
const {originalCameraToWebgl2}=await moduleAt("../src/clip-space.ts");
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const triangle=()=>({
  positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
  indices:new Uint32Array([0,1,2]),
  uvs:new Float32Array([0,0,1,0,0,1]),
  normals:new Float32Array([0,0,1,0,0,1,0,0,1]),
  colors:new Float32Array([1,0,0,1,0,1,0,1,0,0,1,1]),
  transform:identity.slice(),
  material:{color:[1,1,1,1],unlit:true,doubleSided:false,alphaCutoff:0,blend:false}
});
test("real original Geometry streams preserve native vertex values and typed indices",()=>{
 const model=admitOriginalGeometry(triangle());
 assert.equal(model.vertexCount,3);assert.equal(model.triangles,1);
 assert.deepEqual([...model.vertices.slice(0,12)],[0,0,0,0,0,1,0,0,1,0,0,1]);
 assert.deepEqual([...model.indices],[0,1,2]);
 assert.deepEqual([...model.transform],[...identity]);
});
test("wrong 3D indices, UVs and arrays are blocked before any GL allocation",()=>{
 for(const g of [
  {...triangle(),indices:new Uint32Array([0,1,3])},
  {...triangle(),uvs:new Float32Array(2)},
  {...triangle(),positions:new Float32Array([1,NaN,0,0,1,0,0,0,1])},
 ])assert.throws(()=>admitOriginalGeometry(g),/geometry|vertex/i);
});
test("original animation and corrupt resource types are never silently omitted",()=>{
 for(const property of [
 {joints:new Uint32Array(12)},{instances:new Float32Array(15)},
 {dynamicVertices:true},
 ])assert.throws(()=>admitOriginalGeometry({...triangle(),...property}),/skeleton|instance|dynamic|staged/i);
});
test("WebGPU original native projection maps into WebGL2 depth range with x/y unchanged",()=>{
 const m=identity.slice();m[10]=0.8;m[14]=-.2;
 const original=m.slice();
 const gl=originalCameraToWebgl2(m);
 assert.ok(Math.abs(gl[10]-1.6)<1e-6);assert.ok(Math.abs(gl[14]+1.4)<1e-6);
 assert.deepEqual([...gl.slice(0,8)],[...m.slice(0,8)]);
 assert.deepEqual([...m],[...original]);
});

test("original unlit SRO UV material keeps native texture reference for real renderer",()=>{
 const m=admitOriginalGeometry({...triangle(),material:{...triangle().material,texture:"/assets/original.png"}});
 assert.equal(m.vertexCount,3);
 assert.equal(m.vertices[6],0);
 assert.throws(()=>admitOriginalGeometry({...triangle(),uvs:undefined,material:{...triangle().material,texture:"/assets/original.png"}}),/UV/);
});

test("original Constantinople GPU instance matrices are retained without expanding meshes on CPU",()=>{
 const a=identity.slice();a[12]=-.55;
 const b=identity.slice();b[12]=.55;
 const resident=admitOriginalGeometry({...triangle(),
   instances:new Float32Array([...a,...b])});
 assert.equal(resident.instanceCount,2);
 assert.equal(resident.triangles,2);
 assert.equal(resident.vertexCount,3);
 assert.deepEqual([...resident.instances],[...a,...b]);
 assert.equal(resident.byteSize,
   resident.vertices.byteLength+resident.indices.byteLength+
   resident.transform.byteLength+resident.instances.byteLength);
 const wrong=identity.slice();wrong[3]=1;
 assert.throws(()=>admitOriginalGeometry({...triangle(),instances:wrong}),/affine/);
});

test("Original 2007 Silkroad D3DCMPFUNC comparison 1..8 preserved, invalid enum rejected",()=>{
 const base=triangle();
 for(let compare=1;compare<=8;compare++){
   const geometry={...base,material:{...base.material,alphaCompare:compare,alphaCutoff:0.5}};
   assert.equal(admitOriginalGeometry(geometry).triangles,1,"Native material enum "+compare);
 }
 for(const v of [0,9,NaN,1.5]){
   assert.throws(()=>admitOriginalGeometry({...base,material:{
     ...base.material,alphaCompare:v}}),/alpha comparison invalid/);
 }
 for(const cutoff of [-1,2,NaN]){
   assert.throws(()=>admitOriginalGeometry({...base,material:{
     ...base.material,alphaCutoff:cutoff}}),/alpha cutoff/);
 }
});
