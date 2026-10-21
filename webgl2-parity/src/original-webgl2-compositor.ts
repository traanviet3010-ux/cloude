/**
 * Both ORIGINAL OpenSRO draw streams share exactly ONE WebGL2 context.
 * The native UiScene is painted after native geometry and never erased by
 * a separate HTML recreation. No GameWorld/session logic lives here.
 */
import type { Geometry } from "@/engine/contracts/geometry";
import type { UiScene } from "@/engine/contracts/ui";
import type { NativeTexture,WorldTexture } from "@/engine/contracts/texture";
import type { CharacterModel,CharacterActor } from "@/engine/contracts/character";
import { OriginalWorldWebgl2 } from "./native-world-webgl2";
import { NativeUiWebgl2Renderer } from "./native-ui-webgl2";
import { createOriginalStageBridge } from "./original-frontend-stage";
import { createOriginalUiBridge } from "./original-ui-runtime-bridge";
import {createOriginalWebgl2Characters} from "./original-characters-webgl2";
import {viewProjection} from "@/engine/foundation/rendering/world-math";
import type {WorldCamera} from "@/engine/contracts/scene";
export function createOriginalSilkroadWebgl2(canvas:HTMLCanvasElement){
  const world=new OriginalWorldWebgl2(canvas,/iPhone|iPad/.test(navigator.userAgent)?160:512);
  let ui:NativeUiWebgl2Renderer;
  try{ui=new NativeUiWebgl2Renderer(canvas,/iPhone|iPad/.test(navigator.userAgent)?96:256,world.glContext());}
  catch(error){world.dispose();throw error;}
  const stage=createOriginalStageBridge(world);
  const bridge=createOriginalUiBridge(ui);
  const characters=createOriginalWebgl2Characters(world);
  let titleCamera:WorldCamera|null=null;
  let disposed=false;
  function assert(){if(disposed)throw Error("Original client WebGL2 compositor disposed");}
  return {
    setOriginalGeometry(id:string,geometry:Geometry|null){assert();world.set(id,geometry);},
    // Direct adapters for the ACTUAL createFrontend()/createUi() callbacks.
    adoptWorld:stage.adoptWorld,
    cancelWorldUpdate:stage.cancelWorldUpdate,
    worldStats:stage.worldStats,
    neededWorldTextures:stage.neededWorldTextures,
    setWorldTexture:stage.setWorldTexture,
    setUi:bridge.setUi,
    setUiTexture:bridge.setUiTexture,
    setCharacterModel(id:string,model:CharacterModel,images:WorldTexture[]){
      assert();characters.retainModel(id,model,images);
    },
    setCharacterActors(actors:readonly CharacterActor[]){assert();characters.setActors(actors);},
    setWorldCamera(camera:WorldCamera){assert();titleCamera=camera;},
    /** Processes a single authentic world lease, never fakes GameWorld success. */
    originalFrontendFrame(maxUploads=2){
      assert();
      if(!titleCamera)throw Error("Original Silkroad frontend camera not available");
      stage.step(maxUploads);
      const matrix=viewProjection(titleCamera,canvas.width/Math.max(1,canvas.height));
      const origin=stage.originRegion();
      const actorIds=origin===null?[]:characters.update(origin);
      const scene=world.render(matrix,[...stage.drawIds(),...actorIds]);
      const visible=bridge.draw();
      return {...scene,ui:bridge.stats(),visible,stage:stage.worldStats(),characters:characters.stats()};
    },
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
      bridge.dispose();characters.dispose();stage.dispose();ui.dispose();world.dispose();
    }
  };
}
