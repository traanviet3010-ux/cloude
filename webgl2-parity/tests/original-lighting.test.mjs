import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/original-lighting.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.ESNext}}).outputText;
const {readOriginalGlLighting}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
function packed(){
  const data=new Float32Array(128);
  data.set([.75,.5,.25],8);
  data.set([.15,.35,.55],12);
  data.set([0,1,0],84);
  return data;
}
test("native OpenSRO fixed packed environment offsets stay unchanged",()=>{
 const v=packed(),s=readOriginalGlLighting(v);
 assert.deepEqual([...s.diffuse],[v[8],v[9],v[10]]);
 assert.deepEqual([...s.ambient],[v[12],v[13],v[14]]);
 assert.ok(Math.abs(s.direction[0]-Math.SQRT1_2)<1e-6);
 assert.ok(Math.abs(s.direction[1]-Math.SQRT1_2)<1e-6);
 assert.equal(s.direction[2],0);
 s.diffuse[0]=0;
 assert.equal(v[8],Math.fround(.75),"Never mutate original packed native environment");
});
test("optional original sun stage uses authored native environment sun direction",()=>{
 const s=readOriginalGlLighting(packed(),true);
 assert.deepEqual([...s.direction],[0,1,0]);
 const bad=packed();bad.fill(0,84,87);
 assert.throws(()=>readOriginalGlLighting(bad,true),/sun direction/);
});
test("NaN and truncated native world shader uniforms fail closed",()=>{
 const bad=packed();bad[10]=Number.NaN;
 assert.throws(()=>readOriginalGlLighting(bad),/Invalid native/);
 assert.throws(()=>readOriginalGlLighting(new Float32Array(8)),/Invalid native/);
 const out=packed();out[9]=-1;
 assert.throws(()=>readOriginalGlLighting(out),/outside packed range/);
});
