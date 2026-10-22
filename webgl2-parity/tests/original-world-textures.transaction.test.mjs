import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const entry=fileURLToPath(new URL("../src/original-world-textures.ts",import.meta.url));
const compiled=await build({entryPoints:[entry],bundle:true,write:false,
  platform:"node",format:"esm",target:"es2022"});
const moduleUrl="data:text/javascript;base64,"+
  Buffer.from(compiled.outputFiles[0].text).toString("base64");
const {OriginalWorldTextures}=await import(moduleUrl);

function fakeWebgl2(){
  const live=new Set();
  const deleted=[];
  let next=0,fail=false,maxSize=4096;
  const uploads=[];
  const gl={
    MAX_TEXTURE_SIZE:3379, TEXTURE_2D:3553, RGBA8:32856, RGBA:6408,
    UNSIGNED_BYTE:5121, NO_ERROR:0, UNPACK_ALIGNMENT:3317,
    UNPACK_FLIP_Y_WEBGL:37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,
    TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,
    TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243, LINEAR:9729,REPEAT:10497,
    getParameter(value){assert.equal(value,this.MAX_TEXTURE_SIZE);return maxSize;},
    getExtension(){return null;}, // Exercise Safari BCn-to-RGBA fallback
    createTexture(){const object={id:++next};live.add(object);return object;},
    deleteTexture(object){if(!live.delete(object))throw Error("double delete");
      deleted.push(object.id);},
    bindTexture(){},pixelStorei(){},
    texImage2D(...args){uploads.push({width:args[3],height:args[4]});},texParameteri(){},
    getError(){return fail?1280:0;}
  };
  return {gl,live,deleted,uploads,
    setFail(value){fail=value;},setMaxSize(value){maxSize=value;}};
}
const originalBgra=(width,height)=>({
  kind:"native-texture",format:"bgra8unorm",width,height,
  levels:[new Uint8Array(width*height*4)]
});

test("original old scene survives failed WebGL2 upload before any LRU eviction",()=>{
  const fake=fakeWebgl2(),textures=new OriginalWorldTextures(fake.gl,8);
  const image=originalBgra(1024,1024); // 4 MB per genuine BGRA GPU upload
  textures.put("title/a.dds",image);
  textures.frame();
  textures.put("title/b.dds",image);
  assert.equal(textures.stats().residentMB,8);
  fake.setFail(true);
  assert.throws(()=>textures.put("dock/c.dds",image,new Set(["title/b.dds"])),
    /GPU upload failed/);
  fake.setFail(false);
  assert.equal(textures.has("title/a.dds"),true,
    "The old intro scene must not be evicted by a failed dock upload");
  assert.equal(textures.has("title/b.dds"),true);
  assert.equal(textures.has("dock/c.dds"),false);
  assert.equal(fake.live.size,2,"The failed staging GL texture must be deleted");
  assert.equal(textures.stats().residentMB,8);
  textures.put("dock/c.dds",image,new Set(["title/b.dds"]));
  assert.equal(textures.has("title/a.dds"),false,
    "Only a successful upload may evict an unpinned LRU asset");
  assert.equal(textures.has("title/b.dds"),true);
  assert.equal(textures.has("dock/c.dds"),true);
  assert.equal(fake.live.size,2);
  textures.dispose();
  assert.equal(fake.live.size,0);
  assert.equal(textures.stats().residentMB,0);
});

test("protected native assets and old replacement handle remain intact on failure",()=>{
  const fake=fakeWebgl2(),textures=new OriginalWorldTextures(fake.gl,8);
  const image=originalBgra(1024,1024);
  textures.put("stage/a.dds",image);
  textures.put("stage/b.dds",image);
  assert.throws(()=>textures.put("stage/c.dds",image,
    new Set(["stage/a.dds","stage/b.dds"])),/visible textures exceed/);
  assert.equal(fake.live.size,2);
  fake.setFail(true);
  assert.throws(()=>textures.put("stage/b.dds",image),/GPU upload failed/);
  fake.setFail(false);
  assert.equal(fake.live.size,2);
  assert.equal(textures.has("stage/b.dds"),true);
  textures.dispose();
  assert.equal(fake.live.size,0);
});


test("Pandora-inspired native mip fallback uses ONLY an authored lower mip when GL max texture side is exceeded",()=>{
  const fake=fakeWebgl2(),textures=new OriginalWorldTextures(fake.gl,8);
  fake.setMaxSize(1024);
  const original={
    kind:"native-texture",format:"bgra8unorm",width:2048,height:1024,
    levels:[new Uint8Array(2048*1024*4),new Uint8Array(1024*512*4)]
  };
  textures.put("authentic-terrain.dds",original);
  assert.deepEqual(fake.uploads,[{width:1024,height:512}],
    "Upload only the original mip1 pixels; do not generate replacement textures");
  assert.equal(textures.stats().residentMB,2);
  assert.equal(textures.stats().mipReductions,1);
  assert.equal(textures.has("authentic-terrain.dds"),true);
  assert.deepEqual(original.levels.map(a=>a.byteLength),[8388608,2097152],
    "The original asset owner retains unchanged original mip bytes");
  textures.dispose();
  assert.equal(fake.live.size,0);
});
test("full resolution remains unchanged when Safari GPU texture allocation fits",()=>{
  const fake=fakeWebgl2(),textures=new OriginalWorldTextures(fake.gl,8);
  const original={kind:"native-texture",format:"bgra8unorm",
    width:512,height:512,levels:[new Uint8Array(512*512*4),new Uint8Array(256*256*4)]};
  textures.put("original-CIF-scene-background.dds",original);
  assert.deepEqual(fake.uploads,[{width:512,height:512}]);
  assert.equal(textures.stats().mipReductions,0);
  textures.dispose();
});
test("corrupt lower native mip does not evict the previous genuine title texture",()=>{
  const fake=fakeWebgl2(),textures=new OriginalWorldTextures(fake.gl,8);
  const originalBgra1024=originalBgra(1024,1024);
  textures.put("title/real.dds",originalBgra1024);
  fake.setMaxSize(1024);
  const oversized={kind:"native-texture",format:"bgra8unorm",
    width:2048,height:1024,
    levels:[new Uint8Array(2048*1024*4),new Uint8Array(12)]};
  assert.throws(()=>textures.put("title/real.dds",oversized),/selected native mip is corrupt/);
  assert.equal(textures.has("title/real.dds"),true);
  assert.equal(textures.stats().residentMB,4);
  assert.equal(fake.live.size,1);
  assert.ok(textures.stats().rejectedUploads>=1);
  textures.dispose();
});
