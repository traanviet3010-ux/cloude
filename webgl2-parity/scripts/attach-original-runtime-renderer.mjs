/**
 * Attach a typed GPU backend factory to the ACTUAL original HieuSRO runtime.
 * No title, character, camera, scene, GameWorld or UI logic is rewritten.
 * Only exact pinned disposable OpenSRO source may be patched for TEST.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {execFileSync} from "node:child_process";
const root=process.argv[2];
if(!root||!resolve(root).includes("opensro-original"))
 throw Error("A disposable pinned /opensro-original checkout is required");
const sha="4f6919d6900d169b89e75647e56c99ca8ebd5cfb";
const head=execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(head!==sha)throw Error("Refuse to edit drifted native Silkroad engine checkout");
const file=join(root,"apps/client-next/src/engine/runtime/runtime.ts");
let original=await readFile(file,"utf8");
const changes=[
 [
  "\tdiagnostics: import(\"@/engine/contracts/runtime\").RuntimeDiagnostics = {}\n): RuntimeControl {",
  "\tdiagnostics: import(\"@/engine/contracts/runtime\").RuntimeDiagnostics = {},\n\t// Backend must implement the full original Renderer contract.\n\trenderBackend: typeof createRenderer = createRenderer\n): RuntimeControl {"
 ],
 [
  "\t\tconst renderer = own(\n\t\t\tcreateRenderer( canvas, random, audio.enqueue, diagnostics )\n\t\t);",
  "\t\tconst renderer = own(\n\t\t\trenderBackend( canvas, random, audio.enqueue, diagnostics )\n\t\t);"
 ]
];
for(const [before,after] of changes){
 const n=original.split(before).length-1;
 if(n!==1)throw Error("Pinned engine source anchor changed: "+n);
 original=original.replace(before,after);
}
await writeFile(file,original);
console.log("ORIGINAL_SRO_RUNTIME_RENDERER_BACKEND_FACTORY=ATTACHED");
