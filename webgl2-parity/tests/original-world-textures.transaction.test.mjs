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
  let next=0,fail=false;
  const gl={
    MAX_TEXTURE_SIZE:3379, TEXTURE_2D:3553, RGBA8:32856, RGBA:6408,
    UNSIGNED_BYTE:5121, NO_ERROR:0, UNPACK_ALIGNMENT:3317,
    UNPACK_FLIP_Y_WEBGL:37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,
    TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,
    TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243, LINEAR:9729,REPEAT:10497,
    getParameter(value){assert.equal(value,this.MAX_TEXTURE_SIZE);return 4096;},
    getExtension(){return null;}, // Exercise Safari BCn-to-RGBA fallback
    createTexture(){const object={id:++next};live.add(object);return object;},
    deleteTexture(object){if(!live.delete(object))throw Error("double delete");
      deleted.push(object.id);},
    bindTexture(){},pixelStorei(){},texImage2D(){},texParameteri(){},
    getError(){return fail?1280:0;}
  };
  return {gl,live,deleted,setFail(value){fail=value;}};
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
