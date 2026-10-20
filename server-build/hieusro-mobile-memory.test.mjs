import "../helpers/native-source-loader.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const {
  createGpuLedger, gpuMemoryStats, registerGpuDevice, unregisterGpuDevice,
  maxMobilePixelRatio, mobileGpuBudgetMB, GPU_BUDGET_IOS_MB,
  GPU_BUDGET_IOS_RESCUE_MB, rescueMode, startMobileMemorySession
} = await import("../../src/engine/foundation/rendering/mobile-memory.ts");
function fakeBuffer() {
  let destroyed=0;
  return {get destroyed(){return destroyed;},destroy(){destroyed++;}};
}
function fakeTexture() {return fakeBuffer();}
test("GPU byte registry tracks allocations and balances owner destruction",()=>{
 const ledger=createGpuLedger(1);
 const a=fakeBuffer(),b=fakeTexture();
 ledger.registerBuffer(a,{size:32768,usage:1});
 ledger.registerTexture(b,{size:[128,128,1],format:"rgba8unorm",usage:1,mipLevelCount:1});
 assert.equal(ledger.stats().assets,2);
 assert.equal(ledger.stats().totalMB,Math.round((32768+65536)/1048576*10)/10);
 a.destroy();
 assert.equal(ledger.stats().assets,1);
 ledger.dispose();
 assert.equal(b.destroyed,1);
 assert.equal(ledger.stats().assets,0);
 ledger.dispose();
 assert.equal(b.destroyed,1);
});
test("LRU evicts only assets explicitly offered by their owner, never during frame",()=>{
 const ledger=createGpuLedger(1);
 const a=fakeBuffer(),b=fakeBuffer(),c=fakeBuffer();
 ledger.registerBuffer(a,{size:600000,usage:1});
 ledger.registerBuffer(b,{size:600000,usage:1});
 // No unowned object can be destroyed simply because estimated use exceeds budget.
 assert.equal(a.destroyed,0);
 assert.equal(b.destroyed,0);
 assert.ok(ledger.stats().overBudgetMB>0);
 ledger.offerEviction(a,()=>a.destroy());
 ledger.beginFrame();
 ledger.registerBuffer(c,{size:600000,usage:1});
 assert.equal(a.destroyed,0); // never evict while a frame is being recorded
 ledger.endFrame();
 assert.equal(a.destroyed,1); // oldest opt-in candidate reclaimed after frame
 // The still-owned allocations have no opt-in callback and must remain alive.
 assert.equal(b.destroyed,0);
 assert.equal(c.destroyed,0);
 ledger.dispose();
});
test("GPU generation tracks all native createBuffer/createTexture calls and reports release",()=>{
 const device={
   createBuffer(desc){ return Object.assign(fakeBuffer(),{size:desc.size}); },
   createTexture(desc){ return fakeTexture(); }
 };
 const budget=registerGpuDevice(device);
 const a=device.createBuffer({size:65536,usage:1});
 const b=device.createTexture({size:[128,128,1],format:"rgba8unorm",usage:1});
 assert.equal(budget.stats().assets,2);
 assert.ok(gpuMemoryStats().assets>=2);
 a.destroy();
 assert.equal(budget.stats().assets,1);
 unregisterGpuDevice(budget);
 assert.equal(b.destroyed,1);
 assert.equal(budget.stats().assets,0);
});
test("WebContent rescue policy is 250MB only for prior interrupted iPhone load",()=>{
 const nav=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 const ss=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
 const pr=Object.getOwnPropertyDescriptor(globalThis,"devicePixelRatio");
 const store=new Map();
 try {
   Object.defineProperty(globalThis,"navigator",{configurable:true,value:{userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7)"}});
   Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{
     getItem:key=>store.get(key)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)
   }});
   Object.defineProperty(globalThis,"devicePixelRatio",{configurable:true,value:3});
   assert.equal(mobileGpuBudgetMB(),GPU_BUDGET_IOS_MB);
   assert.equal(maxMobilePixelRatio(),1.5);
   store.set("hieusro-mobile-v2-rescue","1");
   assert.equal(rescueMode(),true);
   assert.equal(mobileGpuBudgetMB(),GPU_BUDGET_IOS_RESCUE_MB);
   assert.equal(maxMobilePixelRatio(),1);
 } finally {
   for (const [k,prev] of [["navigator",nav],["sessionStorage",ss],["devicePixelRatio",pr]]){
     if(prev) Object.defineProperty(globalThis,k,prev); else delete globalThis[k];
   }
 }
});
test("patch preserves correct device-loss limit and page cleanup",()=>{
 const b=readFileSync(new URL("../../src/bootstrap.ts",import.meta.url),"utf8");
 assert.match(b,/pagehide/);
 assert.match(b,/beforeunload/);
 assert.match(b,/ownedMobileGame\?\.dispose\(\)/);
 const render=readFileSync(new URL("../../src/engine/runtime/renderer/renderer.ts",import.meta.url),"utf8");
 assert.match(render,/recoveries < \(mobileLiteEnabled\(\) \? 1 : 3\)/);
 const pack=readFileSync(new URL("../../src/engine/runtime/assets/worker/packs/blocks.ts",import.meta.url),"utf8");
 assert.match(pack,/budget = mobileLiteEnabled\(\) \? 0/);
 const world=readFileSync(new URL("../../src/engine/runtime/assets/worker/world/resources/resources.ts",import.meta.url),"utf8");
 assert.match(world,/Math\.abs\(dx\) \+ Math\.abs\(dz\) > 1/);
});
