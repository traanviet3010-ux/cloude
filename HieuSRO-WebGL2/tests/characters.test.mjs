import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFileSync} from "node:fs";
const original=readFileSync(new URL("../src/characters.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {makeNativeDraft,fetchRoster,createNativeCharacter}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));
test("native CH and EU model and starter indices match OpenSRO v1.150",()=>{
 const ch=makeNativeDraft({name:"HieuTest",race:"CH",gender:"MAN"},"global-official");
 const eu=makeNativeDraft({name:"TestEuro",race:"EU",gender:"WOMAN"},"global-official");
 assert.equal(ch.modelCodename,"CHAR_CH_MAN_NOBLEBOY");
 assert.equal(eu.modelCodename,"CHAR_EU_WOMAN_NOBLE");
 assert.equal(ch.weaponIndex,1);
 assert.equal(eu.weaponIndex,2);
 assert.equal(ch.protectorIndex,1);
 assert.equal(ch.divisionId,"global-official");
 assert.equal(ch.armorSelected,true);
 assert.equal(eu.weaponSelected,true);
});
test("invalid names do not generate server requests",()=>{
 for(const name of ["","a","thisNameIsWayTooLong","with space","1Invalid"]){
   assert.throws(()=>makeNativeDraft({name,race:"CH",gender:"MAN"},"global-official"));
 }
});
test("fetchRoster reads actual native protocol response and sends no cookies",async()=>{
 const saved=globalThis.fetch;const seen=[];
 try{
   globalThis.fetch=async (path,init)=>{
     seen.push({path,init});
     return new Response(JSON.stringify({nativeResult:1,characters:[{id:12,name:"Hero",level:1}]}),{status:200,headers:{"Content-Type":"application/json"}});
   };
   const rows=await fetchRoster("test-token");
   assert.deepEqual(rows,[{id:12,name:"Hero",level:1}]);
   assert.equal(seen[0].path,"/api/character/list");
   assert.equal(seen[0].init.credentials,"omit");
   assert.equal(seen[0].init.headers.Authorization,"Bearer test-token");
 }finally{globalThis.fetch=saved;}
});
test("create only sends name check then native create; no synthetic roster writes",async()=>{
 const saved=globalThis.fetch;const calls=[];
 try{
   globalThis.fetch=async (path,init)=>{
     calls.push({path,body:JSON.parse(init.body)});
     const payload=path.endsWith("/name-overlap")?
       {action:4,nativeResult:1}:
       {action:1,nativeResult:1,character:{name:"HieuTest",id:73,level:1}};
     return new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}});
   };
   const char=await createNativeCharacter("test-token","global-official",{name:"HieuTest",race:"CH",gender:"MAN"});
   assert.equal(char.id,73);
   assert.deepEqual(calls.map(c=>c.path),["/api/character/name-overlap","/api/character/create"]);
   assert.equal(calls[1].body.modelCodename,"CHAR_CH_MAN_NOBLEBOY");
   assert.equal(calls[1].body.characterName,"HieuTest");
 }finally{globalThis.fetch=saved;}
});
test("duplicate name is refused without mutating the game server",async()=>{
 const saved=globalThis.fetch;const calls=[];
 try{
   globalThis.fetch=async path=>{
     calls.push(path);
     return new Response(JSON.stringify({action:4,nativeResult:0,nativeErrorCode:17}),{status:200,headers:{"Content-Type":"application/json"}});
   };
   await assert.rejects(()=>createNativeCharacter("test-token","global-official",{name:"Duplicate",race:"EU",gender:"MAN"}),/đã có người/);
   assert.deepEqual(calls,["/api/character/name-overlap"]);
 }finally{globalThis.fetch=saved;}
});
