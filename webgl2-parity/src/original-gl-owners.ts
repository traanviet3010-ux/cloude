/**
 * One coordinated WebGL2 graphics generation for the existing original game.
 * The original asset/scene/UI/gameplay controllers remain the only owners of
 * game content. No synthetic scene or reauthored asset is created here.
 */
import {createOriginalGlDevice,type OriginalGlDeviceOptions} from "./original-gl-device";
import {createOriginalGlSurface} from "./original-gl-surface";
import {createOriginalGlFrame} from "./original-gl-frame";

export function createOriginalGlOwners(canvas:HTMLCanvasElement,options:OriginalGlDeviceOptions={}){
 const device=createOriginalGlDevice(canvas,options);
 let surface:ReturnType<typeof createOriginalGlSurface>;
 try{surface=createOriginalGlSurface(device);}
 catch(error){device.dispose();throw error;}
 const frame=createOriginalGlFrame(device,surface);
 let disposed=false;
 return {
  device,surface,frame,
  dispose(){
    if(disposed)return;
    disposed=true;
    frame.dispose();surface.dispose();device.dispose();
  },
  stats:()=>({device:device.stats(),surface:surface.stats(),disposed})
 };
}
