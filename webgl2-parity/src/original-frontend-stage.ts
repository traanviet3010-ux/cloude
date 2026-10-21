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

type Stage = {
  readonly sceneId:string;
  readonly entries:readonly {id:string;geometry:import("@/engine/contracts/geometry").Geometry}[];
  cursor:number;
  texturePaths:readonly string[];
  originRegion:number;
  environment:import("@/engine/contracts/scene").WorldEnvironment|undefined;
};
const MAX_PENDING_BYTES=128*1024*1024;
const MAX_GROUPS=12_000;

export function createOriginalStageBridge(world:OriginalWorldWebgl2){
  let pending:Stage|null=null;
  let sceneId:string|null=null;
  let originRegion:number|null=null;
  let activeEnvironment:import("@/engine/contracts/scene").WorldEnvironment|undefined;
  let readyIds:string[]=[];
  let disposed=false;
  let error:string|null=null;
  const check=()=>{if(disposed)throw Error("Original Silkroad WebGL2 stage disposed");};
  const adoptWorld:Renderer["adoptWorld"]=(lease,detail,terrain)=>{
    check();
    if(pending)throw Error("Cannot replace native stage while GPU admission is pending");
    if(terrain?.length)throw Error("Native multi-region stage terrain composition is not ported");
    if(detail && detail!=="full"&&detail!=="distance")throw Error("Invalid original stage detail");
    // WorldSceneLease.takeWorld() is called exactly once. Never copy a second
    // encoded scene or alter frontend camera/GDR state.
    const prepared=lease.takeWorld();
    if(prepared.scene.id!==lease.sceneId)throw Error("Original stage lease identity mismatch");
    if(!Number.isSafeInteger(prepared.bytes)||prepared.bytes<0||
       prepared.bytes>MAX_PENDING_BYTES||prepared.scene.groups.length>MAX_GROUPS)
      throw Error("Original stage asset payload exceeds admission budget");
    const entries: {id:string;geometry:import("@/engine/contracts/geometry").Geometry}[]=[];
    const seen=new Set<string>(), required=new Set<string>();
    let bytes=0;
    for(const g of prepared.scene.groups){
      if(!g.id||seen.has(g.id))throw Error("Original scene has duplicate/empty group ID");
      if(readyIds.includes(g.id))throw Error("Original stage shares resident group id; safe atomic replacement not yet supported: "+g.id);
      seen.add(g.id);
      if(g.animation||g.visibility||g.ranges||g.material.terrain||
         g.material.water||g.material.sky||g.material.lightmap){
        throw Error("Original stage needs native animated/terrain/sky/lightmap GL pass: "+g.id);
      }
      // WorldGroup owns its material, not necessarily Geometry.material.
      const mesh={...g.geometry,material:g.material};
      const native=admitOriginalGeometry(mesh);
      if(g.material.texture)required.add(g.material.texture);
      bytes+=native.byteSize;
      if(bytes>MAX_PENDING_BYTES)throw Error("Original stage exceeds GPU budget");
      entries.push({id:g.id,geometry:mesh});
    }
    pending={sceneId:prepared.scene.id,entries,cursor:0,texturePaths:[...required],originRegion:prepared.scene.originRegion,environment:prepared.scene.environment};
    error=null;
  };
  function step(maxGroups=2):number{
    check();
    if(!Number.isInteger(maxGroups)||maxGroups<1||maxGroups>16)
      throw Error("Original stage per-frame upload budget invalid");
    const task=pending;if(!task)return 0;
    // Only paint the original scene when its real bitmap dependencies exist.
    if(task.texturePaths.some(path=>!world.hasTexture(path)))return 0;
    let n=0;
    try{
      while(n<maxGroups&&task.cursor<task.entries.length){
        const g=task.entries[task.cursor]!;
        world.set(g.id,g.geometry);
        task.cursor++;n++;
      }
      if(task.cursor===task.entries.length){
        // Atomic visible stage transition: old stage stays visible
        // throughout admission; publish new draw-order only on completion.
        const nextIds=task.entries.map(g=>g.id);
        for(const old of readyIds)if(!nextIds.includes(old))world.set(old,null);
        readyIds=nextIds;sceneId=task.sceneId;originRegion=task.originRegion;
        activeEnvironment=task.environment;pending=null;
      }
      return n;
    }catch(e){
      error=String(e);
      for(let i=0;i<task.cursor;i++){
        const id=task.entries[i]!.id;
        if(!readyIds.includes(id))world.set(id,null);
      }
      pending=null;
      throw e;
    }
  }
  const cancelWorldUpdate:Renderer["cancelWorldUpdate"]=()=>{
    check();
    if(!pending)return;
    for(let i=0;i<pending.cursor;i++){
      const id=pending.entries[i]!.id;
      if(!readyIds.includes(id))world.set(id,null);
    }
    pending=null;
  };
  const neededWorldTextures:Renderer["neededWorldTextures"]=()=>{
    check();
    return pending?.texturePaths.filter(path=>!world.hasTexture(path))??[];
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
      residentGroups:readyIds.length,visibleGroups:0,triangles:0,
      pendingTextures:pending?.texturePaths.filter(path=>!world.hasTexture(path)).length??0,
      bundleRebuilds:0};
  };
  return {
    adoptWorld,cancelWorldUpdate,neededWorldTextures,setWorldTexture,worldStats,step,
    drawIds:()=>{check();return [...readyIds];},
    originRegion:()=>{check();return originRegion;},
    activeEnvironment:()=>{check();return activeEnvironment;},
    error:()=>error,
    dispose(){
      if(disposed)return;
      if(pending)for(let i=0;i<pending.cursor;i++){
        const id=pending.entries[i]!.id;
        if(!readyIds.includes(id))world.set(id,null);
      }
      for(const id of readyIds)world.set(id,null);
      pending=null;readyIds=[];sceneId=null;originRegion=null;activeEnvironment=undefined;disposed=true;
    }
  };
}
