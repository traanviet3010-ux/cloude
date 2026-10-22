/**
 * CI proof: the complete original Renderer (not an independently rewritten
 * 13-method GL facade) remains authoritative after injection. This does not
 * declare the future WebGL2 DeviceOwner implementation complete.
 */
import ts from "typescript";
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {execFileSync} from "node:child_process";
const root=process.argv[2]??process.env.SRO_SOURCE_ROOT;
if(!root||!resolve(root).includes("opensro-original"))
  throw Error("Pinned original checkout required");
const originalCommit="4f6919d6900d169b89e75647e56c99ca8ebd5cfb";
const file="apps/client-next/src/engine/runtime/renderer/renderer.ts";
const patched=readFileSync(join(root,file),"utf8");
const original=execFileSync("git",["-C",root,"show",originalCommit+":"+file],{encoding:"utf8"});
const count=(s,key)=>s.split(key).length-1;
let expected=original;
const replace=(from,to,n)=>{
  if(count(expected,from)!==n)throw Error("OpenSRO renderer source drift: "+from.slice(0,50));
  expected=expected.replaceAll(from,to);
};
replace('diagnostics: import("@/engine/contracts/runtime").RuntimeDiagnostics = {}\n): Renderer {',
  'diagnostics: import("@/engine/contracts/runtime").RuntimeDiagnostics = {},\n' +
  '\tdeviceFactory: typeof createDevice = createDevice,\n' +
  '\tsurfaceFactory: typeof createSurface = createSurface,\n' +
  '\tframeFactory: typeof createFrame = createFrame\n): Renderer {',1);
replace('createDevice( diagnostics.gpuTiming, diagnostics.gpuAnimation !== false )',
        'deviceFactory( diagnostics.gpuTiming, diagnostics.gpuAnimation !== false )',2);
replace('createSurface( canvas, device.surfaceCommands()!, device.format() )',
        'surfaceFactory( canvas, device.surfaceCommands()!, device.format() )',1);
replace('createFrame( device.commands()! )',
        'frameFactory( device.commands()! )',2);
if(patched!==expected)throw Error("Original Renderer methods/source unexpectedly changed");
const source=(name,body)=>ts.createSourceFile(name,body,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const contract=source("contracts/runtime.ts",readFileSync(join(root,"apps/client-next/src/engine/contracts/runtime.ts"),"utf8"));
const interfaceNode=contract.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text==="Renderer");
if(!interfaceNode)throw Error("Original Renderer interface missing");
const required=interfaceNode.members.filter(m=>!m.questionToken)
  .map(m=>m.name?.getText(contract)).filter(Boolean);
function methods(body){
  const tree=source("renderer.ts",body);
  const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="createRenderer");
  const ret=fn?.body?.statements.find(ts.isReturnStatement)?.expression;
  if(!ret||!ts.isObjectLiteralExpression(ret))throw Error("Native Renderer owner changed");
  return ret.properties.map(p=>p.name?.getText(tree)).filter(Boolean);
}
const prior=methods(original),current=methods(patched);
if(JSON.stringify(prior)!==JSON.stringify(current))
  throw Error("A native Renderer API was added, removed or reordered");
const missing=required.filter(k=>!current.includes(k));
if(missing.length)throw Error("Original Renderer itself is incomplete: "+missing.join(", "));
console.log("HIEUSRO_NATIVE_RENDERER_GRAPHICS_SEAM",JSON.stringify({
  nativeRendererRequiredMethods:required.length,ownedOriginalMethods:current.length,
  missingOriginalPublicMethods:0,
  retainedOwners:["world","characters","UI","picking","frame coordination","gameplay presentation"],
  replacedBackendFactories:["createDevice","createSurface","createFrame"],
  webgl2DeviceContractImplemented:false,
  status:"SOURCE_SEAM_PASS__WEBGL2_NOT_YET_PLAYABLE"
}));
