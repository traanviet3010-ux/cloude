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
import {createOriginalInstanceSelection} from "./original-instance-selection";
import {viewProjection} from "@/engine/foundation/rendering/world-math";
import {worldEnvironment} from "@/engine/foundation/rendering/world-environment";
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
  let visibleGroupSet:ReturnType<typeof createOriginalInstanceSelection>|null=null;
  let selectedSceneGroups:ReturnType<typeof stage.activeGroups>|null=null;
  let nativeFrameIndex=0,nativeLastSeconds:number|null=null;
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
    originalFrontendFrame(maxUploads=2,originalSeconds=0){
      assert();
      if(!titleCamera)throw Error("Original Silkroad frontend camera not available");
      stage.step(maxUploads);
      const aspect=canvas.width/Math.max(1,canvas.height);
      // The packed world lighting is produced by the EXACT OpenSRO owner,
      // using the title/dock's actual WorldScene.environment track.
      // Never substitute a custom ambient/sun/clock for the original.
      const nativeEnvironment=worldEnvironment(
        stage.activeEnvironment(),titleCamera,aspect,originalSeconds);
      world.setOriginalLighting(nativeEnvironment);
      const matrix=viewProjection(titleCamera,aspect);
      const origin=stage.originRegion();
      const groups=stage.activeGroups();
      if(groups!==selectedSceneGroups){
        visibleGroupSet?.dispose();
        visibleGroupSet=createOriginalInstanceSelection(groups);
        selectedSceneGroups=groups;
      }
      const dx=titleCamera.originRegion && origin!==null ?
        ((titleCamera.originRegion&255)-(origin&255))*1920:0;
      const dz=titleCamera.originRegion && origin!==null ?
        ((titleCamera.originRegion>>>8)-(origin>>>8))*1920:0;
      const localCamera={
        eye:[titleCamera.eye[0]+dx,titleCamera.eye[1],titleCamera.eye[2]+dz] as [number,number,number],
        target:[titleCamera.target[0]+dx,titleCamera.target[1],titleCamera.target[2]+dz] as [number,number,number]
      };
      const dt=nativeLastSeconds===null?0:
        Math.min(1,Math.max(0,originalSeconds-nativeLastSeconds));
      nativeLastSeconds=originalSeconds;
      const selection=visibleGroupSet!.select(localCamera,dt,++nativeFrameIndex);
      const nativeSelected=new Map(selection.map(row=>[row.id,row]));
      const stageIds=stage.drawIds().filter(id=>{
        const original=groups.find(g=>g.id===id);
        if(!original || original.instanceRadius===undefined ||
           !!original.ranges || !!original.material.sky)return true;
        const row=nativeSelected.get(id);
        world.updateOriginalInstances(id,
          row?.matrices??new Float32Array(0),
          row?.opacity??new Float32Array(0));
        return !!row?.count;
      });
      const actorIds=origin===null?[]:characters.update(origin);
      const scene=world.render(matrix,[...stageIds,...actorIds]);
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
      visibleGroupSet?.dispose();bridge.dispose();characters.dispose();stage.dispose();ui.dispose();world.dispose();
    }
  };
}
