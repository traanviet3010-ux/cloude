import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/native-texture.ts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.ESNext}}).outputText;
const {unpackNativeTexture,nativeLevelBytes}=await import("data:text/javascript;base64,"+Buffer.from(output).toString("base64"));
const native=(format,width,height,level)=>({kind:"native-texture",format,width,height,levels:[level]});

test("original BGRA Silkroad texture is converted to RGBA without swapping opacity",()=>{
 const d=unpackNativeTexture(native("bgra8unorm",2,1,new Uint8Array([3,2,1,4,7,6,5,8])));
 assert.deepEqual([...d.pixels],[1,2,3,4,5,6,7,8]);
});
test("BC1/DXT1 decodes authentic DXT red color indices",()=>{
 const d=unpackNativeTexture(native("bc1-rgba-unorm",4,4,
   new Uint8Array([0,248,0,0,0,0,0,0])));
 assert.deepEqual([...d.pixels.slice(0,4)],[255,0,0,255]);
 assert.equal(d.pixels.length,64);
});
test("BC1 supports one-bit alpha when c0 <= c1",()=>{
 const d=unpackNativeTexture(native("bc1-rgba-unorm",4,4,
   new Uint8Array([0,0,0,248,255,255,255,255])));
 assert.equal(d.pixels[3],0);
});
test("BC2/DXT3 alpha nibbles are retained per pixel",()=>{
 const d=unpackNativeTexture(native("bc2-rgba-unorm",4,4,
   new Uint8Array([0x0f,0,0,0,0,0,0,0,0,248,0,0,0,0,0,0])));
 assert.equal(d.pixels[3],255);
 assert.equal(d.pixels[7],0);
});
test("BC3/DXT5 all-zero alpha indices select alpha endpoint",()=>{
 const d=unpackNativeTexture(native("bc3-rgba-unorm",4,4,
   new Uint8Array([219,0,0,0,0,0,0,0,0,248,0,0,0,0,0,0])));
 assert.equal(d.pixels[3],219);
});
test("missing/corrupt mip and runaway decode cannot silently render garbage",()=>{
 assert.equal(nativeLevelBytes("bc2-rgba-unorm",5,7),64);
 assert.throws(()=>unpackNativeTexture(native("bc1-rgba-unorm",4,4,new Uint8Array(3))),/corrupt/);
 assert.throws(()=>unpackNativeTexture(native("bgra8unorm",8192,8192,new Uint8Array(4))),/budget/);
 assert.throws(()=>unpackNativeTexture(native("bgra8unorm",1,1,new Uint8Array(4)),1),/mip/);
});
