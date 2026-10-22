import test from "node:test";
import assert from "node:assert/strict";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";

const dir=dirname(fileURLToPath(import.meta.url));
const out=join(dir,"native-gameworld-lease-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-scene-lease.ts")],
  bundle:true,platform:"node",format:"esm",target:"es2022",outfile:out});
const {leaseOriginalWorldScene}=await import(pathToFileURL(out).href);
const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function nativeScene(){
 const shared=new Float32Array([0,0,0,1,0,0,0,1,0]);
 const scene={id:"original-gameworld-packet",originRegion:0,warnings:[],
   groups:[{id:"original-terrain-0",center:[0,0,0],radius:1,
     material:{color:[1,1,1,1],unlit:true,alphaCutoff:0,blend:false,doubleSided:true},
     geometry:{positions:shared,indices:new Uint32Array([0,1,2]),transform:I,
       normals:shared.subarray(0,9)}}]};
 return scene;
}
test("direct original GameWorld WorldScene retains exact object, references and one-use ownership",()=>{
 const scene=nativeScene();
 const lease=leaseOriginalWorldScene(scene);
 assert.equal(lease.sceneId,scene.id);
 const prepared=lease.takeWorld();
 assert.equal(prepared.scene,scene);
 assert.equal(prepared.scene.groups[0].geometry.positions,scene.groups[0].geometry.positions);
 assert.equal(prepared.scene.groups[0].geometry.indices,scene.groups[0].geometry.indices);
 assert.equal(prepared.bytes,
   scene.groups[0].geometry.positions.buffer.byteLength+
   scene.groups[0].geometry.indices.buffer.byteLength+I.buffer.byteLength,
   "Shared vertex/normal ArrayBuffer must only be accounted once");
 assert.throws(()=>lease.takeWorld(),/already consumed/);
});
test("direct real WorldScene rejects malformed metadata and payloads",()=>{
 const original=nativeScene();
 assert.throws(()=>leaseOriginalWorldScene({...original,id:""}),/invalid/);
 assert.throws(()=>leaseOriginalWorldScene({...original,originRegion:NaN}),/invalid/);
 assert.throws(()=>leaseOriginalWorldScene({...original,groups:null}),/invalid/);
});
