/**
 * WebGL2 frame coordinator on the existing native Silkroad scene/UI path.
 * A caller supplies genuine original renderer draw callbacks, never new art,
 * alternate gameplay state or a replacement login screen.
 */
import type {OriginalGlDevice} from "./original-gl-device";
import type {OriginalGlSurface} from "./original-gl-surface";
import {createOriginalGlGpuCommands} from "./original-gl-gpu-commands";
export interface OriginalGlFrameInputs<TScene,THud> {
 readonly width:number;
 readonly height:number;
 readonly world:()=>TScene;
 readonly hud:()=>THud;
}
export function createOriginalGlFrame(device:OriginalGlDevice,surface:OriginalGlSurface){
 let disposed=false;
 const commands=createOriginalGlGpuCommands(device);
 const render=<TScene,THud>(inputs:OriginalGlFrameInputs<TScene,THud>)=>{
   if(disposed)throw Error("Original GL frame coordinator disposed");
   device.assert();
   surface.acquire({width:inputs.width,height:inputs.height});
   device.beginFrame();
   let scene!:TScene;
   let hud!:THud;
   try{
     surface.beginScene();
     // Native WorldScene GL renderer retains its own shader/material selection
     // and clears the target at the beginning of the main world pass.
     scene=inputs.world();
     surface.encodePresent();
     // Hud layers must follow the world resolve, never vice versa.
     hud=inputs.hud();
     return {scene,hud};
   }catch(error){
     surface.abortScene();
     throw error;
   }finally{
     // Released GL resources cannot be destroyed while the frame is open.
     device.endFrame();
   }
 };
 return {render,commands,dispose(){if(disposed)return;disposed=true;commands.dispose();}};
}
export type OriginalGlFrame=ReturnType<typeof createOriginalGlFrame>;
