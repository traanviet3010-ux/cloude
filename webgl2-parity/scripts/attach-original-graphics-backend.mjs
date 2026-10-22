/**
 * Keep the actual original Silkroad Renderer implementation, not the partial
 * stand-alone GL compositor. Expose ONLY the three GPU-specific factories so
 * WebGL2 can eventually replace WebGPU underneath original world/actors/UI.
 *
 * This script modifies only an ephemeral, pinned OpenSRO checkout in CI/TEST.
 * It never writes gameplay, UI, network, storage, or the LIVE deployment.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {execFileSync} from "node:child_process";
const root=process.argv[2];
if(!root || !resolve(root).includes("opensro-original"))
  throw Error("Only a disposable /opensro-original checkout is allowed");
const commit="4f6919d6900d169b89e75647e56c99ca8ebd5cfb";
const head=execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(head!==commit)throw Error("Unexpected original OpenSRO revision");
const file=join(root,"apps/client-next/src/engine/runtime/renderer/renderer.ts");
let original=await readFile(file,"utf8");
function replaceExactly(before,after,count=1){
  const matches=original.split(before).length-1;
  if(matches!==count)throw Error("Original renderer source anchor changed: "+before.slice(0,75)+" (found "+matches+")");
  original=original.replaceAll(before,after);
}
// Native createRenderer() still owns the full 50-method Renderer API. Default
// inputs are identical to before: no behavior change on WebGPU, including LIVE.
replaceExactly(
  'diagnostics: import("@/engine/contracts/runtime").RuntimeDiagnostics = {}\n): Renderer {',
  'diagnostics: import("@/engine/contracts/runtime").RuntimeDiagnostics = {},\n' +
  '\tdeviceFactory: typeof createDevice = createDevice,\n' +
  '\tsurfaceFactory: typeof createSurface = createSurface,\n' +
  '\tframeFactory: typeof createFrame = createFrame\n): Renderer {'
);
replaceExactly('createDevice( diagnostics.gpuTiming, diagnostics.gpuAnimation !== false )',
               'deviceFactory( diagnostics.gpuTiming, diagnostics.gpuAnimation !== false )',2);
replaceExactly('createSurface( canvas, device.surfaceCommands()!, device.format() )',
               'surfaceFactory( canvas, device.surfaceCommands()!, device.format() )');
replaceExactly('createFrame( device.commands()! )',
               'frameFactory( device.commands()! )',2);
// No renderer public method, frontend, world/character owner or call chain
// has been renamed. A later GL implementation must meet the existing typed
// DeviceOwner / SurfaceOwner / FrameOwner contracts, not reimplement Renderer.
await writeFile(file,original);
console.log("ORIGINAL_50_METHOD_RENDERER_OWNED_GRAPHICS_SEAM=ATTACHED");
