/**
 * Both ORIGINAL OpenSRO draw streams share exactly ONE WebGL2 context.
 * The native UiScene is painted after native geometry and never erased by
 * a separate HTML recreation. No GameWorld/session logic lives here.
 */
import type { Geometry } from "@/engine/contracts/geometry";
import type { UiScene } from "@/engine/contracts/ui";
import type { NativeTexture } from "@/engine/contracts/texture";
import { OriginalWorldWebgl2 } from "./native-world-webgl2";
import { NativeUiWebgl2Renderer } from "./native-ui-webgl2";
export function createOriginalSilkroadWebgl2(canvas:HTMLCanvasElement){
  const world=new OriginalWorldWebgl2(canvas,/iPhone|iPad/.test(navigator.userAgent)?160:512);
  let ui:NativeUiWebgl2Renderer;
  try{ui=new NativeUiWebgl2Renderer(canvas,/iPhone|iPad/.test(navigator.userAgent)?96:256,world.glContext());}
  catch(error){world.dispose();throw error;}
  let disposed=false;
  function assert(){if(disposed)throw Error("Original client WebGL2 compositor disposed");}
  return {
    setOriginalGeometry(id:string,geometry:Geometry|null){assert();world.set(id,geometry);},
    setOriginalUiTexture(id:string,image:ImageBitmap|ImageData|NativeTexture|null){assert();ui.setTexture(id,image);},
    frame(originalCamera:Float32Array,originalWorldGroups:readonly string[],originalUi:UiScene){
      assert();
      const scene=world.render(originalCamera,originalWorldGroups);
      // A missing texture/unsupported UI feature throws before presenting
      // an apparently successful but incomplete Silkroad screen.
      ui.draw(originalUi,false);
      return {...scene,ui:ui.stats()};
    },
    dispose(){
      if(disposed)return;disposed=true;
      ui.dispose();world.dispose();
    }
  };
}
