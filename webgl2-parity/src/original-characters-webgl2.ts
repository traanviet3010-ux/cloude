/**
 * Original HieuSRO GPU CharacterModel/CharacterActor consumer for WebGL2.
 *
 * Uses native model.images and per-actor createCharacterPose state. No extra
 * roster/avatar JSON or procedural models. Limited initial admission:
 * authored unlit textured skeletal primitives only, no effects/cloth.
 */
import type {CharacterModel,CharacterActor} from "@/engine/contracts/character";
import type {WorldTexture} from "@/engine/contracts/texture";
import type {Geometry} from "@/engine/contracts/geometry";
import {placement} from "@/engine/foundation/rendering/world-math";
import {multiply} from "@/engine/foundation/math/pose-math";
import {pickRay,pickRayProjector,pickGeometry} from "@/engine/foundation/rendering/picking";
import {selectPickCandidate,type PickCandidate} from "@/engine/foundation/animation/character-pick";
import {createOriginalCpuCharacterSkin} from "./original-character-cpu-skin";
import {OriginalWorldWebgl2} from "./native-world-webgl2";

const MOBILE=typeof navigator!=="undefined" && /iPhone|iPad/.test(navigator.userAgent);
const ACTOR_LIMIT=MOBILE?8:32, PRIMITIVE_LIMIT=32;
const VERTICES_PER_FRAME=MOBILE?180_000:600_000;
type ModelRecord={source:CharacterModel;imagePaths:string[]};
type ActorRecord={model:string;ids:string[];skin:ReturnType<typeof createOriginalCpuCharacterSkin>;
  // Last completed CPU-skin pose + exact native placement matrix, identical
  // to the geometry uploaded for the latest GPU frame. Never pick T-pose.
  drawn:Geometry[];pickable:boolean;actor:CharacterActor};
export function createOriginalWebgl2Characters(world:OriginalWorldWebgl2){
 const models=new Map<string,ModelRecord>(),residents=new Map<number,ActorRecord>();
 let actors:readonly CharacterActor[]=[];
 let disposed=false;
 const check=()=>{if(disposed)throw Error("Original SRO WebGL2 character owner disposed");};
 function retainModel(id:string,model:CharacterModel,images:readonly WorldTexture[]){
   check();
   if(!id||id.length>256||models.has(id))throw Error("Invalid/duplicate native character model");
   if(!model.primitives.length||model.primitives.length>PRIMITIVE_LIMIT ||
      images.length!==model.images.length)
     throw Error("Native character model/image count exceeds WebGL2 budget");
   const imagePaths=images.map((_,i)=>"character:"+id+":texture:"+i);
   for(const primitive of model.primitives){
     if(!Number.isInteger(primitive.image)||primitive.image<0||primitive.image>=images.length)
       throw Error("Original character model texture binding invalid");
     // OpenSRO's default undefined unlit is NOLIGHT. Explicit false is
     // original object-lit mode supported by the native lighting pass.
     // Complex stage/reflection/cloth shaders are still rejected at admission.
     if(primitive.geometry.material?.unlit===false && !primitive.geometry.normals)
       throw Error("Original lit character primitive needs normal stream");
   }
   const uploaded:string[]=[];
   try{
     for(let i=0;i<images.length;i++){
       world.setTexture(imagePaths[i]!,images[i]!);uploaded.push(imagePaths[i]!);
     }
     models.set(id,{source:model,imagePaths});
   }catch(error){
     for(const path of uploaded)world.setTexture(path,null);
     throw error;
   }
 }
 function setActors(value:readonly CharacterActor[]){
   check();
   if(value.length>ACTOR_LIMIT)throw Error("Native character visible actor count exceeds WebGL2 CPU budget");
   const seen=new Set<number>();
   let totalVertices=0;
   for(const actor of value){
     if(!Number.isSafeInteger(actor.gid)||seen.has(actor.gid)||!models.has(actor.model))
       throw Error("Original world character model/GID not resident");
     if(!Number.isFinite(actor.scale)||actor.scale<=0||
        !Number.isFinite(actor.time)||actor.time<0 ||
        !Number.isFinite(actor.pose.yaw))
       throw Error("Original world actor pose invalid");
     if(actor.attachment||actor.mountedOn!==undefined||actor.effectBasis||
        actor.effectEntity||actor.modelAnimation||actor.bloodEffects||actor.deferredParticle)
       throw Error("Original mounted/attached/effect actor needs dedicated WebGL2 pass");
     const m=models.get(actor.model)!;
     totalVertices+=m.source.primitives.reduce((n,p)=>n+p.geometry.positions.length/3,0);
     if(totalVertices>VERTICES_PER_FRAME)
       throw Error("Original animated actor group exceeds Safari CPU-skinning frame budget");
     seen.add(actor.gid);
   }
   actors=value;
 }
 function update(originRegion:number):readonly string[]{
   check();
   if(!Number.isInteger(originRegion)||originRegion<0||originRegion>65535)
     throw Error("Original scene origin region invalid");
   const active=new Set<number>(),drawIds:string[]=[];
   for(const actor of actors){
     const entry=models.get(actor.model)!;
     let state=residents.get(actor.gid);
     if(state&&state.model!==actor.model){
       for(const id of state.ids)world.set(id,null);
       residents.delete(actor.gid);state=undefined;
     }
     if(!state){
       state={model:actor.model,ids:[],skin:createOriginalCpuCharacterSkin(entry.source),
         drawn:[],pickable:actor.pickable!==false,actor};
       residents.set(actor.gid,state);
     }
     const placementMatrix=placement(actor.pose.regionId,originRegion,
       actor.pose.x,actor.pose.y,actor.pose.z,actor.pose.yaw);
     // Scale authored actor basis exactly once. Preserve translation from
     // native region placement; geometry retains its own model root basis.
     for(const index of [0,1,2,4,5,6,8,9,10])placementMatrix[index]=placementMatrix[index]!*actor.scale;
     for(let i=0;i<entry.source.primitives.length;i++){
       const p=entry.source.primitives[i]!;
       const imagePath=entry.imagePaths[p.image]!;
       if(!world.hasTexture(imagePath))throw Error("Original character texture missing: "+imagePath);
       const skinned=state.skin.skin(p,actor);
       const root=new Float32Array(16);
       multiply(placementMatrix,skinned.geometry.transform,root);
       const material={...p.geometry.material!,texture:imagePath};
       const geometry:Geometry={...skinned.geometry,material,transform:root};
       const id="original-character:"+actor.gid+":"+i;
       if(i>=state.ids.length){world.set(id,geometry);state.ids.push(id);}
       else world.updateAnimatedGeometry(id,geometry);
       // Only publish a pickable skinned surface AFTER successful actual
       // WebGL2 upload; a Safari VBO allocation failure must not expose
       // triangle positions that the user never saw on screen.
       state.drawn[i]=geometry;
       drawIds.push(id);
     }
     state.drawn.length=entry.source.primitives.length;
     state.pickable=actor.pickable!==false;
     state.actor=actor;
     active.add(actor.gid);
   }
   for(const [gid,state] of residents)if(!active.has(gid)){
     for(const id of state.ids)world.set(id,null);
     residents.delete(gid);
   }
   return drawIds;
 }
 function pickRenderedActor(viewProjection:Float32Array,x:number,y:number,
   eligible?:ReadonlySet<number>):{gid:number;depth:number}|null{
   check();
   // The ORIGINAL pickRay() uses WebGPU's 0..1 camera depth. Reuse that
   // exact math, not a hand-authored OpenGL inverse-projection heuristic.
   const ray=pickRay(viewProjection,x,y);
   if(!ray)return null;
   let best:{gid:number;depth:number}|null=null;
   for(const [gid,state] of residents){
     if(!state.pickable||(eligible&&!eligible.has(gid)))continue;
     for(const geometry of state.drawn){
       // The original pickGeometry() supports the CPU-skinned geometry
       // directly; joint weights were already applied during the actual
       // GL upload. A partially transparent mesh needs the retail per-texel
       // pick-alpha mask, not yet available through the WebGL2 asset owner.
       if((geometry.material?.alphaCutoff??0)>0||
          geometry.material?.blend||geometry.material?.textureAlpha||
          geometry.material?.surfaceAlpha||
          geometry.material?.alphaCompare!==undefined||
          (geometry.material?.color?.[3]??1)<1)continue;
       const depth=pickGeometry(ray,geometry,geometry.transform,undefined,{});
       if(depth!==null&&(!best||depth<best.depth))best={gid,depth};
     }
   }
   return best;
 }
 function pickRenderedEntityFan(matrix:Float32Array,x:number,y:number,
    width:number,height:number,excluded:ReadonlySet<number>=new Set()):number|null{
   check();
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
      width<1||height<1)return null;
   const project=pickRayProjector(matrix);
   if(!project)return null;
   const rays=[];
   for(let row=0;row<3;row++)for(let col=0;col<3;col++){
     const rx=Math.trunc(x*width+(col-1)*width*.016)/width;
     const ry=Math.trunc(y*height+(row-1)*height*.016)/height;
     const ray=project(rx,ry);
     if(!ray)return null;
     rays.push(ray);
   }
   const candidates:PickCandidate[]=[];
   for(const [gid,state] of residents){
     if(excluded.has(gid)||!state.pickable)continue;
     const model=models.get(state.model)?.source;
     if(!model)continue;
     const hits=[];
     for(let i=0;i<rays.length;i++){
       let closest=Infinity;
       for(const geo of state.drawn){
         if((geo.material?.alphaCutoff??0)>0||
            geo.material?.blend||geo.material?.textureAlpha||
            geo.material?.surfaceAlpha||
            geo.material?.alphaCompare!==undefined||
            (geo.material?.color?.[3]??1)<1)continue;
         const depth=pickGeometry(rays[i]!,geo,geo.transform,undefined,{});
         if(depth!==null)closest=Math.min(closest,depth);
       }
       if(Number.isFinite(closest))hits.push({ray:i,depth:closest,
         distance:closest*Math.hypot(...rays[i]!.delta)});
     }
     if(hits.length){
       candidates.push({actor:state.actor,model,
         matrix:state.drawn[0]!.transform,hits});
     }
   }
   return selectPickCandidate(candidates)?.gid??null;
 }
 return {
   retainModel,setActors,update,pickRenderedActor,pickRenderedEntityFan,
   stats:()=>({models:models.size,actors:residents.size,
     primitives:[...residents.values()].reduce((n,s)=>n+s.ids.length,0)}),
   dispose(){
     if(disposed)return;
     for(const state of residents.values())for(const id of state.ids)world.set(id,null);
     residents.clear();
     for(const m of models.values())for(const path of m.imagePaths)world.setTexture(path,null);
     models.clear();actors=[];disposed=true;
   }
 };
}
