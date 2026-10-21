import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import ts from "typescript";

// This reads the REAL pinned original OpenSRO flow.ts that CI checks out.
// No HieuSRO replacement finite state machine is allowed.
const root=process.env.SRO_SOURCE_ROOT;
if(!root)throw Error("Set SRO_SOURCE_ROOT to pinned OpenSRO source before running");
const file=resolve(root,"apps/client-next/src/engine/runtime/frontend/flow/flow.ts");
const source=readFileSync(file,"utf8");
const output=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const {createFrontendFlow}=await import("data:text/javascript;base64,"+Buffer.from(output).toString("base64"));
const current=flow=>flow.snapshot().phase;
const ready=flow=>flow.ready(flow.snapshot().generation);

test("AUTHENTIC original intro->retail login->camera dock (no new HTML login)",()=>{
 const flow=createFrontendFlow();
 assert.equal(current(flow),"loading-title");
 ready(flow);assert.equal(current(flow),"intro");
 for(let k=0;k<6;k++)flow.advance(3,false);
 assert.ok(flow.snapshot().logoAlpha>0,"original intro logo fades only after camera/keyframe duration");
 flow.reveal();assert.equal(current(flow),"login-reveal");
 flow.advance(.5);assert.equal(current(flow),"login");
 flow.authenticated();assert.equal(current(flow),"login-accepted");
 flow.advance(.5);assert.equal(current(flow),"loading-dock");
 ready(flow);assert.equal(current(flow),"dock-arrival");
 flow.advance(.1,false);assert.equal(current(flow),"dock-arrival","dock requires real completed camera");
 flow.advance(.1,true);assert.equal(current(flow),"dock");
});

test("AUTHENTIC create race choice->customize->backend-accepted return, no invented flow",()=>{
 const flow=createFrontendFlow();
 ready(flow);flow.reveal();flow.advance(.5);flow.authenticated();flow.advance(.5);
 ready(flow);flow.advance(.1,true);
 assert.equal(current(flow),"dock");
 flow.create();assert.equal(current(flow),"create-arrival");
 flow.advance(.3,true);assert.equal(current(flow),"create");
 flow.race();assert.equal(current(flow),"race-zoom");
 flow.advance(.1,true);assert.equal(current(flow),"loading-create");
 ready(flow);assert.equal(current(flow),"customize");
 flow.created();assert.equal(current(flow),"loading-dock");
 ready(flow);assert.equal(current(flow),"dock-arrival");
 flow.advance(.1,true);assert.equal(current(flow),"dock");
});

test("AUTHENTIC login/creation world handoff only after server-world-ready signal",()=>{
 const flow=createFrontendFlow();
 ready(flow);flow.reveal();flow.advance(.5);flow.authenticated();flow.advance(.5);
 ready(flow);flow.advance(.1,true);
 flow.start();assert.equal(current(flow),"departing");
 flow.advance(.5);assert.equal(current(flow),"loading-world");
 flow.advance(.5);assert.equal(current(flow),"loading-world",
   "Never claim the world is ready merely because UI fades completed");
 flow.worldReady();assert.equal(current(flow),"world");
 flow.returnedToDock();assert.equal(current(flow),"loading-dock");
});

test("AUTHENTIC stale asset load generations do not teleport login/creation state",()=>{
 const flow=createFrontendFlow();
 const first=flow.snapshot().generation;
 ready(flow);assert.equal(current(flow),"intro");
 flow.ready(first);assert.equal(current(flow),"intro");
 flow.reveal();flow.advance(.5);assert.equal(current(flow),"login");
 flow.ready(first);assert.equal(current(flow),"login");
 flow.dispose();
});
