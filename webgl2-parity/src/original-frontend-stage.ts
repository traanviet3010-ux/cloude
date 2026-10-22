/**
 * Receives the exact single-consumption OpenSRO frontend world lease.
 * Keeps the original createFrontendStage() API boundary. Never creates
 * substitute Constantinople scenery or a synthetic character stage.
 *
 * Limited to scene groups already faithfully supported by OriginalWorldWebgl2.
 * Rejects the whole stage before GPU mutation if any material/mesh requires
 * yet-unported original Silkroad shaders/animation.
 */
import type { Renderer } from "@/engine/contracts/runtime";
import type { WorldRenderStats } from "@/engine/contracts/scene";
import { admitOriginalGeometry } from "./native-geometry";
import { OriginalWorldWebgl2 } from "./native-world-webgl2";
import {selectOriginalTerrain} from "./original-terrain-selection";
import type {WorldCamera,WorldGroup} from "@/engine/contracts/scene";

type Stage = {
  readonly sceneId:string;
  readonly groups:readonly import("@/engine/contracts/scene").WorldGroup[];
  readonly entries:readonly {id:string;key:string;geometry:import("@/engine/contracts/geometry").Geometry;terrain?:WorldGroup;textures:readonly string[]}[];
  readonly detail:"full"|"distance";
  cursor:number;
  texturePaths:readonly string[];
  originRegion:number;
  environment:import("@/engine/contracts/scene").WorldEnvironment|undefined;
};
const MAX_PENDING_BYTES=128*1024*1024;
const MAX_GROUPS=12_000;
// The pinned OpenSRO frontend stage requests at most three asset jobs/frame.
// Demand only four next real WorldGroups instead of all stage textures at once.
const TEXTURE_WINDOW_GROUPS=4;

export function createOriginalStageBridge(world:OriginalWorldWebgl2){
  let pending:Stage|null=null;
  let sceneId:string|null=null;
  let originRegion:number|null=null;
  let activeEnvironment:import("@/engine/contracts/scene").WorldEnvironment|undefined;
  let readyIds:string[]=[];
  let readyEntries:Stage["entries"]=[];
  let namespace=0;
  let activeGroups:readonly import("@/engine/contracts/scene").WorldGroup[]=[];
  let activeDetail:"full"|"distance"="full";
  let renderedVisible=0,renderedTriangles=0;
  const terrainCells=new Map<string,string>();
  let disposed=false;
  let error:string|null=null;
  const check=()=>{if(disposed)throw Error("Original Silkroad WebGL2 stage disposed");};
  /** All stage-owned sources have arrived through setWorldTexture; the native
   * world material decoder owns unique asset paths, while character texture
   * keys use their own "character:" namespace. Only destroy uploads that
   * became unreachable after a successful stage swap/cancel/world exit.
   * This runs AFTER retiring old mesh handles, never while they are drawn.
   */
  const activeTexturePaths=()=>new Set(readyEntries.flatMap(entry=>entry.textures));
  function retireTextures(paths:readonly string[],keep:ReadonlySet<string>){
    for(const path of paths){
      if(keep.has(path))continue;
      if(world.hasTexture(path))world.setTexture(path,null);
    }
  }

  const adoptWorld:Renderer["adoptWorld"]=(lease,detail,terrain)=>{
    check();
    if(pending)throw Error("Cannot replace native stage while GPU admission is pending");
    // Keep the EXACT original world.adopt() outdoor-region composition:
    // every part is already decoded in the scene's origin coordinates.
    // Do not shift, rebuild, or duplicate any original map vertices.
    const regions=new Set<number>();
    let terrainBytes=0;
    for(const part of terrain??[]){
      if(!Number.isSafeInteger(part.bytes)||part.bytes<0||
         !Number.isInteger(part.region)||!Array.isArray(part.groups)||
         regions.has(part.region))
        throw Error("Invalid native WorldTerrainPart");
      regions.add(part.region);
      terrainBytes+=part.bytes;
      if(terrainBytes>MAX_PENDING_BYTES)
        throw Error("Original outdoor terrain residency budget exceeded");
    }
    if(detail && detail!=="full"&&detail!=="distance")throw Error("Invalid original stage detail");
    // WorldSceneLease.takeWorld() is called exactly once. Never copy a second
    // encoded scene or alter frontend camera/GDR state.
    const prepared=lease.takeWorld();
    if(prepared.scene.id!==lease.sceneId)throw Error("Original stage lease identity mismatch");
    if((terrain?.length??0)>0 && prepared.scene.residency==="frontend")
      throw Error("Frontend scenes cannot have outdoor terrain parts");
    if((terrain??[]).some(part=>part.origin!==prepared.scene.originRegion))
      throw Error("Original outdoor region terrain origin mismatch");
    const scene=(terrain?.length??0)>0?{
      ...prepared.scene,
      groups:[...prepared.scene.groups,...terrain!.flatMap(part=>part.groups)]
    }:prepared.scene;
    const sceneBytes=prepared.bytes+terrainBytes;
    if(!Number.isSafeInteger(sceneBytes)||sceneBytes<0||
       sceneBytes>MAX_PENDING_BYTES||scene.groups.length>MAX_GROUPS)
      throw Error("Original stage asset payload exceeds admission budget");
    const entries: {id:string;key:string;geometry:import("@/engine/contracts/geometry").Geometry;terrain?:WorldGroup;textures:readonly string[]}[]=[];
    const existingKeys=new Set(readyIds),newKeys=new Set<string>();
    const seen=new Set<string>(), required=new Set<string>();
    let bytes=0;
    for(const g of scene.groups){
      if(!g.id||seen.has(g.id))throw Error("Original scene has duplicate/empty group ID");
      seen.add(g.id);
      // A new authentic scene may reuse old WorldGroup IDs. Do not replace
      // a live GPU mesh until the complete next scene is ready to publish.
      let key=g.id;
      if(existingKeys.has(key)||newKeys.has(key)){
        do{key="__native_scene_"+(++namespace)+":"+g.id;}
        while(existingKeys.has(key)||newKeys.has(key));
      }
      if(key.length>512)throw Error("Native stage GPU key exceeds renderer limit");
      newKeys.add(key);
      if(g.visibility && (
        !g.geometry.instances || !g.instanceRadius ||
        g.visibility.length>g.geometry.instances.length/16
      ))throw Error("Original scene visibility has invalid placement binding");
      if(g.animation||
         (g.material.sky!==undefined&&![1,2,3,4,5,6].includes(g.material.sky)))
        throw Error("Original stage needs an unported native animated, star/moon or water GPU pass: "+g.id);
      if(!!g.ranges!==!!g.material.terrain)
        throw Error("Original terrain requires matching native material and cell ranges: "+g.id);
      // WorldGroup owns its material, not necessarily Geometry.material.
      const mesh={...g.geometry,material:g.material};
      // Geometry with native terrain ranges is admitted from the original
      // per-cell LOD index plan instead of incorrectly uploading all LODs.
      const native=admitOriginalGeometry(g.ranges?{
        ...mesh,...selectOriginalTerrain(g,{eye:[0,0,0]},"full").geometry,
        material:g.material
      }:mesh);
      const textures=[...new Set([
        ...(g.material.texture?[g.material.texture]:[]),
        ...(g.material.frames??[])
      ])];
      for(const path of textures)required.add(path);
      // Lunar phases remain original authored DDS frames. The four-group
      // demand window must include ALL textures of a selected native group.
      bytes+=native.byteSize;
      if(bytes>MAX_PENDING_BYTES)throw Error("Original stage exceeds GPU budget");
      entries.push({id:g.id,key,geometry:mesh,terrain:g.ranges?g:undefined,textures});
    }
    const requiredPaths=[...required];
    world.protectPendingTextures(requiredPaths);
    world.protectStageGroups(readyIds);
    pending={sceneId:scene.id,groups:scene.groups,entries,cursor:0,texturePaths:requiredPaths,originRegion:scene.originRegion,environment:scene.environment,
      detail:detail??scene.terrainDetail??"full"};
    error=null;
  };
  function step(maxGroups=2):number{
    check();
    if(!Number.isInteger(maxGroups)||maxGroups<1||maxGroups>16)
      throw Error("Original stage per-frame upload budget invalid");
    const task=pending;if(!task)return 0;
    // Never block admission of already-decoded groups on textures owned by
    // distant groups. The original frontend polls neededWorldTextures()
    // every frame and caps its own concurrent asset requests at three.
    let n=0;
    try{
      while(n<maxGroups&&task.cursor<task.entries.length){
        const g=task.entries[task.cursor]!;
        // The current group must be fully textured before uploading its
        // authentic geometry. Missing original textures are not substituted.
        if(g.textures.some(path=>!world.hasTexture(path)))break;
        if(g.terrain){
          // Admit only the authored LOD0 triangles. The real camera-dependent
          // terrainLod() selection is applied to resident buffers each frame
          // when the original frontend publishes its camera.
          const plan=selectOriginalTerrain(g.terrain,{eye:[0,0,0]},"full");
          world.set(g.key,{...plan.geometry,material:g.terrain.material});
        }else world.set(g.key,g.geometry);
        world.protectStageGroup(g.key);
        task.cursor++;n++;
      }
      if(task.cursor===task.entries.length){
        // Atomic visible stage transition: old stage stays visible
        // throughout admission; publish new draw-order only on completion.
        const nextIds=task.entries.map(g=>g.key);
        const retiringTexturePaths=[...activeTexturePaths()];
        for(const old of readyIds)if(!nextIds.includes(old))world.set(old,null);
        readyIds=nextIds;readyEntries=task.entries;sceneId=task.sceneId;activeGroups=task.groups;originRegion=task.originRegion;activeDetail=task.detail;
        renderedVisible=0;renderedTriangles=0;
        terrainCells.clear();
        world.protectStageGroups(readyIds);
        activeEnvironment=task.environment;pending=null;
        world.protectPendingTextures([]);
        // The new complete scene is already published. A texture shared by
        // both stages retains its handle; original old-only intro/dock art
        // is retired before entering the authoritative GameWorld.
        retireTextures(retiringTexturePaths,activeTexturePaths());
      }
      return n;
    }catch(e){
      error=String(e);
      for(let i=0;i<task.cursor;i++){
        const key=task.entries[i]!.key;
        if(!readyIds.includes(key))world.set(key,null);
      }
      // Failed stage admission can have streamed texture images that the
      // original old complete scene never referenced. Drop only those.
      pending=null;
      world.protectPendingTextures([]);
      world.protectStageGroups(readyIds);
      retireTextures(task.texturePaths,activeTexturePaths());
      throw e;
    }
  }
  const cancelWorldUpdate:Renderer["cancelWorldUpdate"]=()=>{
    check();
    if(!pending)return;
    for(let i=0;i<pending.cursor;i++){
      const key=pending.entries[i]!.key;
      if(!readyIds.includes(key))world.set(key,null);
    }
    const canceledPaths=pending.texturePaths;
    pending=null;
    world.protectPendingTextures([]);
    world.protectStageGroups(readyIds);
    retireTextures(canceledPaths,activeTexturePaths());
  };
  /**
   * Native createFrontend() calls renderer.setWorld(null) when leaving the
   * title/character dock for authoritative GameWorld. Release all old GPU
   * stage leases atomically: no stale Constantinople geometry is retained.
   */
  function clearWorld(){
    check();
    const abandonedPaths=[...new Set([
      ...activeTexturePaths(),...(pending?.texturePaths??[])
    ])];
    if(pending){
      for(let i=0;i<pending.cursor;i++){
        const key=pending.entries[i]!.key;
        if(!readyIds.includes(key))world.set(key,null);
      }
      pending=null;
    }
    for(const id of readyIds)world.set(id,null);
    readyIds=[];readyEntries=[];activeGroups=[];sceneId=null;originRegion=null;
    terrainCells.clear();renderedVisible=0;renderedTriangles=0;
    activeEnvironment=undefined;error=null;
    world.protectPendingTextures([]);
    world.protectStageGroups([]);
    retireTextures(abandonedPaths,new Set());
  }
  const neededWorldTextures:Renderer["neededWorldTextures"]=()=>{
    check();
    if(!pending)return [];
    const wanted=new Set<string>();
    for(const entry of pending.entries.slice(pending.cursor,pending.cursor+TEXTURE_WINDOW_GROUPS)){
      for(const path of entry.textures)if(!world.hasTexture(path))wanted.add(path);
    }
    return [...wanted];
  };
  const setWorldTexture:Renderer["setWorldTexture"]=(path,image)=>{
    check();
    if(!pending||!pending.texturePaths.includes(path))
      throw Error("Unrequested native scene texture upload: "+path);
    world.setTexture(path,image);
  };
  const worldStats:Renderer["worldStats"]=():WorldRenderStats=>{
    check();
    const remaining=pending?pending.entries.length-pending.cursor:0;
    return {pendingGroups:remaining,sceneId:pending?null:sceneId,
      residentGroups:readyIds.length,visibleGroups:renderedVisible,triangles:renderedTriangles,
      pendingTextures:pending?.texturePaths.filter(path=>!world.hasTexture(path)).length??0,
      bundleRebuilds:0};
  };
  return {
    adoptWorld,cancelWorldUpdate,clearWorld,neededWorldTextures,setWorldTexture,worldStats,step,
    /** Called only AFTER a successful native WebGL2 frame with real authored
     * stage draw IDs. Old ready stats cannot masquerade as next-scene success.
     */
    recordFrame(visible:number,triangles:number){
      check();
      if(!Number.isSafeInteger(visible)||visible<0||visible>readyIds.length||
         !Number.isSafeInteger(triangles)||triangles<0)
        throw Error("Invalid native renderer world frame evidence");
      renderedVisible=visible;renderedTriangles=triangles;
    },
    drawIds:()=>{check();return [...readyIds];},
    drawEntries:()=>{check();return readyEntries.map(({id,key})=>({id,key}));},
    /** Native terrainLod() updates GPU buffers only on a new eye cell.
     * Neither meshes nor their textures are rebuilt as the camera moves.
     */
    updateTerrain(eye:readonly [number,number,number]){
      check();
      if(!eye.every(Number.isFinite))
        throw Error("Original terrain camera is not finite");
      let updated=0,triangles=0;
      for(const entry of readyEntries){
        if(!entry.terrain)continue;
        const eyeX=Math.floor(eye[0]/320),eyeZ=Math.floor(eye[2]/320);
        const stamp=activeDetail+":"+eyeX+":"+eyeZ;
        if(terrainCells.get(entry.key)===stamp)continue;
        const plan=selectOriginalTerrain(entry.terrain,{eye},activeDetail);
        world.updateOriginalTerrain(entry.key,{
          ...plan.geometry,material:entry.terrain.material
        });
        terrainCells.set(entry.key,stamp);
        updated++;triangles+=plan.triangles;
      }
      return {updated,triangles};
    },
    activeGroups:()=>{check();return activeGroups;},
    originRegion:()=>{check();return originRegion;},
    activeEnvironment:()=>{check();return activeEnvironment;},
    error:()=>error,
    dispose(){
      if(disposed)return;
      const abandonedPaths=[...new Set([
        ...activeTexturePaths(),...(pending?.texturePaths??[])
      ])];
      if(pending)for(let i=0;i<pending.cursor;i++){
        const key=pending.entries[i]!.key;
        if(!readyIds.includes(key))world.set(key,null);
      }
      for(const id of readyIds)world.set(id,null);
      pending=null;readyIds=[];readyEntries=[];activeGroups=[];sceneId=null;originRegion=null;activeEnvironment=undefined;renderedVisible=0;renderedTriangles=0;disposed=true;
      terrainCells.clear();
      world.protectPendingTextures([]);
      world.protectStageGroups([]);
      retireTextures(abandonedPaths,new Set());
    }
  };
}
