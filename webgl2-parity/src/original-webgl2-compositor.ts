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
import {createOriginalGlDevice} from "./original-gl-device";
import {createOriginalGlSurface} from "./original-gl-surface";
import {createOriginalGlFrame} from "./original-gl-frame";
import { NativeUiWebgl2Renderer } from "./native-ui-webgl2";
import { createOriginalStageBridge } from "./original-frontend-stage";
import {leaseOriginalWorldScene} from "./original-scene-lease";
import { createOriginalUiBridge } from "./original-ui-runtime-bridge";
import {createOriginalWebgl2Characters} from "./original-characters-webgl2";
import {createOriginalInstanceSelection} from "./original-instance-selection";
import {orderOriginalGpuStageEntries} from "./original-draw-order";
import {viewProjection} from "@/engine/foundation/rendering/world-math";
import {worldEnvironment} from "@/engine/foundation/rendering/world-environment";
import type {WorldCamera} from "@/engine/contracts/scene";
export function createOriginalSilkroadWebgl2(canvas:HTMLCanvasElement){
  const world=new OriginalWorldWebgl2(canvas,/iPhone|iPad/.test(navigator.userAgent)?160:512);
  // Shared native GL context for all authored world and HUD streams.
  // The new device/surface/frame owners handle lifetime and passes, while
  // the existing original scene/UI owners still submit the actual artwork.
  const glDevice=createOriginalGlDevice(canvas,{
    context:world.glContext(),mobile:/iPhone|iPad|Android/.test(navigator.userAgent)
  });
  const glSurface=createOriginalGlSurface(glDevice,{
    directToCanvas:/iPhone|iPad|Android/.test(navigator.userAgent)
  });
  const glFrame=createOriginalGlFrame(glDevice,glSurface);
  let ui:NativeUiWebgl2Renderer;
  try{ui=new NativeUiWebgl2Renderer(canvas,/iPhone|iPad/.test(navigator.userAgent)?96:256,world.glContext());}
  catch(error){glSurface.dispose();glDevice.dispose();world.dispose();throw error;}
  const stage=createOriginalStageBridge(world);
  const bridge=createOriginalUiBridge(ui);
  const characters=createOriginalWebgl2Characters(world);
  let titleCamera:WorldCamera|null=null;
  let visibleGroupSet:ReturnType<typeof createOriginalInstanceSelection>|null=null;
  let selectedSceneGroups:ReturnType<typeof stage.activeGroups>|null=null;
  let stageGroupById=new Map<string,ReturnType<typeof stage.activeGroups>[number]>();
  let sortedStageEntries:ReturnType<typeof stage.drawEntries>=[];
  let nativeFrameIndex=0,nativeLastSeconds:number|null=null;
  // Picking can only use the camera matrix from the LAST successfully
  // presented original GL frame. Never pick actors in an unpainted scene.
  let lastRenderedPickView:Float32Array|null=null;
  let disposed=false;
  function assert(){if(disposed)throw Error("Original client WebGL2 compositor disposed");}
  return {
    setOriginalGeometry(id:string,geometry:Geometry|null){assert();world.set(id,geometry);},
    // Direct adapters for the ACTUAL createFrontend()/createUi() callbacks.
    adoptWorld:stage.adoptWorld,
    cancelWorldUpdate:stage.cancelWorldUpdate,
    setWorld(scene:import("@/engine/contracts/scene").WorldScene|null){
      assert();
      if(scene===null){stage.clearWorld();lastRenderedPickView=null;return;}
      // The original session publishes a real WorldScene here, not a new
      // login/scene implementation. Feed the exact source arrays into the
      // already validated one-use GPU admission path.
      stage.adoptWorld(leaseOriginalWorldScene(scene),scene.terrainDetail);
    },
    worldStats:stage.worldStats,
    neededWorldTextures:stage.neededWorldTextures,
    setWorldTexture:stage.setWorldTexture,
    setUi:bridge.setUi,
    setUiTexture:bridge.setUiTexture,
    setCharacterModel(id:string,model:CharacterModel,images:WorldTexture[]){
      assert();characters.retainModel(id,model,images);
    },
    setCharacterActors(actors:readonly CharacterActor[]){assert();characters.setActors(actors);}, 
    /** Original frontend roster selection against last painted CPU-skinned
     * triangles. Uses pinned OpenSRO pickRay()/pickGeometry(), not GPU
     * color-coded mock IDs; alpha-masked retail picks still need porting.
     */
    pickFrontendCharacter(x:number,y:number,ids:readonly number[]){
      assert();
      if(!lastRenderedPickView)return null;
      return characters.pickRenderedActor(lastRenderedPickView,x,y,new Set(ids))?.gid??null;
    },
    /** 692680 / 69282B source: exact native 3x3 ray fan with center
     * priority, limited to solid meshes rendered and GPU-admitted here.
     * Full game entity pick still also needs native gate/alpha/UI filters.
     */
    pickRenderedEntity(x:number,y:number,excluded:readonly number[]=[]){
      assert();
      if(!lastRenderedPickView)return null;
      return characters.pickRenderedEntityFan(lastRenderedPickView,x,y,
        canvas.width,canvas.height,new Set(excluded));
    },
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
      // Identical to original world.render(): sky star quad offsets are
      // exactly one pixel in clip space per old asset's maskUV coordinate.
      nativeEnvironment[57]=1/Math.max(1,canvas.width);
      nativeEnvironment[58]=1/Math.max(1,canvas.height);
      // Native OpenSRO source environment controls the zenith/horizon.
      // Do not draw synthetic sky in a cleared/out-of-world scene.
      world.setOriginalLighting(nativeEnvironment,false,
        !!stage.activeEnvironment());
      const matrix=viewProjection(titleCamera,aspect);
      const origin=stage.originRegion();
      const groups=stage.activeGroups();
      if(groups!==selectedSceneGroups){
        visibleGroupSet?.dispose();
        visibleGroupSet=createOriginalInstanceSelection(groups);
        selectedSceneGroups=groups;
        stageGroupById=new Map(groups.map(g=>[g.id,g]));
        sortedStageEntries=orderOriginalGpuStageEntries(groups,stage.drawEntries());
      }
      const dx=titleCamera.originRegion && origin!==null ?
        ((titleCamera.originRegion&255)-(origin&255))*1920:0;
      const dz=titleCamera.originRegion && origin!==null ?
        ((titleCamera.originRegion>>>8)-(origin>>>8))*1920:0;
      const localCamera={
        eye:[titleCamera.eye[0]+dx,titleCamera.eye[1],titleCamera.eye[2]+dz] as [number,number,number],
        target:[titleCamera.target[0]+dx,titleCamera.target[1],titleCamera.target[2]+dz] as [number,number,number]
      };
      // The old OpenSRO terrainLod() selector drives exact resident
      // index-buffer/height updates; this is NOT regenerated landscape.
      stage.updateTerrain(localCamera.eye);
      const dt=nativeLastSeconds===null?0:
        Math.min(1,Math.max(0,originalSeconds-nativeLastSeconds));
      nativeLastSeconds=originalSeconds;
      const selection=visibleGroupSet!.select(localCamera,dt,++nativeFrameIndex);
      const nativeSelected=new Map(selection.map(row=>[row.id,row]));
      const stageIds=sortedStageEntries.filter(({id,key})=>{
        const original=stageGroupById.get(id);
        if(!original || original.instanceRadius===undefined ||
           !!original.ranges || !!original.material.sky)return true;
        const row=nativeSelected.get(id);
        // Native selection keys always use source WorldGroup IDs; GPU
        // residency keys are private so two scene leases can overlap.
        world.updateOriginalInstances(key,
          row?.matrices??new Float32Array(0),
          row?.opacity??new Float32Array(0));
        return !!row?.count;
      }).map(({key})=>key);
      const actorIds=origin===null?[]:characters.update(origin);
      const {scene,hud:visible}=glFrame.render({
        width:canvas.width,height:canvas.height,
        world:()=>world.render(matrix,[...stageIds,...actorIds]),
        hud:()=>bridge.draw()
      });
      // Only a successfully presented native GL frame can advance original
      // WorldRenderStats.visibleGroups. Runtime must not infer readiness
      // from prepared-but-never-drawn title or GameWorld mesh uploads.
      stage.recordFrame(stageIds.length,world.authoredTriangles(stageIds));
      // Promote camera ownership after GL world+HUD submission succeeds.
      // Note: selecting the inventory doll or alpha-masked mesh is separately
      // gated; this method only resolves real solid rendered actor triangles.
      lastRenderedPickView=matrix.slice();
      return {...scene,ui:bridge.stats(),visible,stage:stage.worldStats(),
        characters:characters.stats(),gpuResidency:world.residencyStats()};
    },
    /** Read-only mobile diagnostics; no extra GPU readback or network calls. */
    gpuResidency(){assert();return {world:world.residencyStats(),ui:ui.stats()};},
    setOriginalUiTexture(id:string,image:ImageBitmap|ImageData|NativeTexture|null){assert();ui.setTexture(id,image);},
    frame(originalCamera:Float32Array,originalWorldGroups:readonly string[],originalUi:UiScene){
      assert();
      // No duplicated UI/game scene: the original mesh and UiScene owners
      // draw in the native retail order through the same WebGL2 context.
      const {scene}=glFrame.render({
        width:canvas.width,height:canvas.height,
        world:()=>world.render(originalCamera,originalWorldGroups),
        hud:()=>ui.draw(originalUi,false)
      });
      return {...scene,ui:ui.stats(),gpuResidency:world.residencyStats()};
    },
    dispose(){
      if(disposed)return;disposed=true;
      lastRenderedPickView=null;
      visibleGroupSet?.dispose();bridge.dispose();characters.dispose();stage.dispose();
      ui.dispose();glFrame.dispose();glSurface.dispose();glDevice.dispose();world.dispose();
    }
  };
}
