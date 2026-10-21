import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Requires pinned original OpenSRO source checkout");
const dir=dirname(fileURLToPath(import.meta.url));
const file=join(dir,"original-character-render-bundle.mjs");
await build({entryPoints:[join(dir,"../src/original-characters-webgl2.ts")],
 bundle:true,platform:"node",format:"esm",target:"es2022",outfile:file,
 alias:{"@":root+"/apps/client-next/src"}});
const {createOriginalWebgl2Characters}=await import(pathToFileURL(file).href);
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const primitive=()=>({
 name:"actual-original-Silkroad-mesh",node:0,joints:[0],inverseBind:identity(),image:0,
 geometry:{positions:new Float32Array([0,0,0,1,0,0,0,1,0]),
  normals:new Float32Array([0,1,0,0,1,0,0,1,0]),
  uvs:new Float32Array([0,0,1,0,0,1]),indices:new Uint32Array([0,1,2]),
  joints:new Uint32Array(12),
  weights:new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),
  transform:identity(),material:{unlit:false,color:[1,1,1,1],doubleSided:true}}
});
const model=()=>({
 nodes:[{name:"Bip01",parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],
 primitives:[primitive()],images:[{width:1,height:1}],
 clips:[{name:"retail-walk",duration:2,channels:[{
  node:0,path:"translation",interpolation:"LINEAR",
  times:new Float32Array([0,1,2]),
  values:new Float32Array([0,0,0,2,0,0,0,0,0])
 }]}]
});
function fakeWorld(){
 const geometries=new Map(),textures=new Map(),events=[];
 return {geometries,textures,events,setTexture(path,image){events.push(["texture",path]);if(image)textures.set(path,image);else textures.delete(path);},
 hasTexture(path){return textures.has(path);},
 set(id,geometry){events.push(["new",id]);if(geometry)geometries.set(id,geometry);else geometries.delete(id);},
 updateAnimatedGeometry(id,geometry){if(!geometries.has(id))throw Error("Never uploaded");events.push(["update",id]);geometries.set(id,geometry);}
 };
}
const actor=(time)=>({
 gid:101,model:"original-avatar",pose:{regionId:0,x:3,y:0,z:4,yaw:0},
 clip:"retail-walk",time,loop:true,scale:1
});
test("native OpenSRO model bytes -> original actor animation -> exact GL geometry with world placement",()=>{
 const world=fakeWorld(),port=createOriginalWebgl2Characters(world);
 const m=model(),tex={kind:"native-texture",width:1,height:1,format:"bgra8unorm",
   levels:[new Uint8Array([0,255,0,255])]};
 port.retainModel("original-avatar",m,[tex]);
 const path="character:original-avatar:texture:0";
 assert.equal(world.textures.get(path),tex);
 port.setActors([actor(.5)]);
 const ids=port.update(0);
 assert.deepEqual(ids,["original-character:101:0"]);
 const first=world.geometries.get(ids[0]);
 assert.equal(first.material.texture,path);
 assert.equal(first.positions[0],1,"Native pose timeline must animate X via original skeleton");
 assert.equal(first.transform[12],3,"Actor placement from original GameWorld position");
 assert.equal(first.transform[14],4);
 port.setActors([actor(1)]);
 port.update(0);
 assert.equal(world.geometries.get(ids[0]).positions[0],2);
 assert.equal(world.events.filter(e=>e[0]==="new"&&e[1]===ids[0]).length,1,
   "Skinned actor must not reallocate GPU VBO every animation frame");
 assert.equal(world.events.filter(e=>e[0]==="update").length,1);
 assert.equal(port.stats().actors,1);
 port.setActors([]);assert.deepEqual(port.update(0),[]);
 assert.equal(port.stats().actors,0);assert.equal(world.geometries.size,0);
 port.dispose();assert.equal(world.textures.size,0);
});
test("original actor with missing real models and unsupported branches cannot be silently drawn",()=>{
 const world=fakeWorld(),port=createOriginalWebgl2Characters(world);
 assert.throws(()=>port.setActors([actor(0)]),/model\/GID/);
 const m=model();port.retainModel("original-avatar",m,[{
  kind:"native-texture",width:1,height:1,format:"bgra8unorm",
  levels:[new Uint8Array([0,0,0,255])]
 }]);
 assert.throws(()=>port.setActors([{...actor(0),attachment:{gid:10,bone:"hand",offset:[0,0,0]}}]),/dedicated/);
 assert.throws(()=>port.setActors([{...actor(0),scale:NaN}]),/pose invalid/);
 assert.throws(()=>port.retainModel("original-avatar",m,[]),/duplicate/);
 port.dispose();
});
