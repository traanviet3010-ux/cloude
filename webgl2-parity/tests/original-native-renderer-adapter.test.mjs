import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const directory=dirname(fileURLToPath(import.meta.url));
const output=join(directory,"native-original-renderer-adapter-bundle.mjs");
await build({
 entryPoints:[join(directory,"../src/original-native-renderer-adapter.ts")],
 outfile:output,platform:"node",format:"esm",target:"es2022",bundle:true,
 plugins:[{
  name:"original-renderer-contract-fixture",
  setup(builder){
   builder.onResolve({filter:/^@\\/engine\\/runtime\\/renderer\\/renderer$/},
     ()=>({path:"old-sro-renderer",namespace:"native"}));
   builder.onLoad({filter:/.*/,namespace:"native"},
     ()=>({contents:"export function createRenderer(...args){return {args, source:'ORIGINAL_OLD_RENDERER'};}",loader:"js"}));
  }
 }]
});
const {bindOriginalGraphicsBackend}=await import(pathToFileURL(output).href);
test("one old Renderer API, one backend selection per original canvas",()=>{
 const calls=[],device=()=>{},surface=()=>{},frame=()=>{};
 const renderer=bindOriginalGraphicsBackend(canvas=>{
   calls.push(canvas);
   return {device,surface,frame};
 });
 const canvas1={id:"original-canvas-a"};
 const canvas2={id:"original-canvas-b"};
 const game1=renderer(canvas1,"native-rng","native-audio",{});
 const game2=renderer(canvas2,"native-rng","native-audio",{});
 assert.equal(game1.source,"ORIGINAL_OLD_RENDERER");
 assert.deepEqual(calls,[canvas1,canvas2]);
 assert.deepEqual(game1.args,[canvas1,"native-rng","native-audio",{},device,surface,frame]);
 assert.deepEqual(game2.args[0],canvas2);
});
test("WebGL2 factory set is required together, never silently fall back to WebGPU",()=>{
 assert.throws(()=>bindOriginalGraphicsBackend(null),/provider missing/);
 const renderer=bindOriginalGraphicsBackend(()=>({device:()=>{},surface:null,frame:()=>{}}));
 assert.throws(()=>renderer({}),/must be complete/);
});
