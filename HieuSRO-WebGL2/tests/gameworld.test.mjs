import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFileSync} from "node:fs";
const raw=readFileSync(new URL("../src/gameworld.ts",import.meta.url),"utf8");
const javascript=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {encodeFrame,decodeFrame,encodeHello,verifyWelcome,encodeEnterWorld,parseEnterWorld,worldSocketUrl}=
  await import("data:text/javascript;base64,"+Buffer.from(javascript).toString("base64"));

test("transport HELLO matches pinned OpenSRO protocol v2 and carries only a ticket",()=>{
  const f=decodeFrame(encodeHello("test-ticket"));
  assert.equal(f.opcode,1);
  assert.equal(f.payload[0],2);
  assert.equal(f.payload[1],0);
  assert.equal(new DataView(f.payload.buffer,f.payload.byteOffset).getUint16(2,true),11);
  assert.equal(new TextDecoder().decode(f.payload.subarray(4)),"test-ticket");
  assert.throws(()=>encodeHello(""),/ticket/);
});
test("strict WELCOME validation prevents pretending connection succeeded",()=>{
  const p=new Uint8Array(27);p[0]=2;p[10]=16;
  assert.doesNotThrow(()=>verifyWelcome(p));
  p[10]=0;
  assert.throws(()=>verifyWelcome(p),/WELCOME/);
});
test("EnterWorld frame has native u16-length-prefixed division, name and token",()=>{
  const f=decodeFrame(encodeEnterWorld("global-official","HieuTest","admit"));
  assert.equal(f.opcode,6);
  const view=new DataView(f.payload.buffer,f.payload.byteOffset);
  let offset=0;
  for(const value of ["global-official","HieuTest","admit"]){
    const n=view.getUint16(offset,true);offset+=2;
    assert.equal(new TextDecoder().decode(f.payload.subarray(offset,offset+n)),value);offset+=n;
  }
  assert.equal(offset,f.payload.length);
});
function reply(obj,success=1){
  const bytes=new TextEncoder().encode(JSON.stringify(obj));
  const p=new Uint8Array(9+bytes.length);p[0]=success;
  new DataView(p.buffer).setUint32(5,bytes.length,true);
  p.set(bytes,9);return p;
}
test("only real server EnterWorld result with bootstrap counts as success",()=>{
  assert.deepEqual(parseEnterWorld(reply({v:2,bootstrap:{id:1},references:{path:"/transport/references/abc"}})),
    {bootstrapVersion:2,referencesAdvertised:true});
  assert.deepEqual(parseEnterWorld(reply({v:1,bootstrap:{id:1}})),
    {bootstrapVersion:1,referencesAdvertised:false});
  assert.throws(()=>parseEnterWorld(reply({v:2,bootstrap:{}})),/references/);
  assert.throws(()=>parseEnterWorld(reply({v:3,bootstrap:{}})),/schema/);
  assert.throws(()=>parseEnterWorld(reply({v:1,bootstrap:{}},0)),/từ chối/);
});
test("socket routing remains on Babylon TEST origin even if server advertises another host",()=>{
 const origin="https://hieusro-babylon-webgl2-test.onrender.com";
 const expected="wss://hieusro-babylon-webgl2-test.onrender.com/shards/global-official/transport/ws";
 assert.equal(worldSocketUrl("/shards/global-official",origin),expected);
 assert.equal(worldSocketUrl("https://backend.example/shards/global-official",origin),expected);
 for(const v of ["https://evil.example/other","/api/title/login","/shards/a?token=sensitive"]){
   assert.throws(()=>worldSocketUrl(v,origin),/không hợp lệ/);
 }
});
