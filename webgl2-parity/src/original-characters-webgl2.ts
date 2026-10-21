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
import {createOriginalCpuCharacterSkin} from "./original-character-cpu-skin";
import {OriginalWorldWebgl2} from "./native-world-webgl2";

const ACTOR_LIMIT=32,PRIMITIVE_LIMIT=32;
type ModelRecord={source:CharacterModel;imagePaths:string[]};
type ActorRecord={model:string;ids:string[];skin:ReturnType<typeof createOriginalCpuCharacterSkin>};
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
     if(!primitive.geometry.material?.unlit)
       throw Error("Native character lighting/material stage not yet ported to WebGL2");
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
       state={model:actor.model,ids:[],skin:createOriginalCpuCharacterSkin(entry.source)};
       residents.set(actor.gid,state);
     }
     const placementMatrix=placement(actor.pose.regionId,originRegion,
       actor.pose.x,actor.pose.y,actor.pose.z,actor.pose.yaw);
     // Scale authored actor basis exactly once. Preserve translation from
     // native region placement; geometry retains its own model root basis.
     for(const index of [0,1,2,4,5,6,8,9,10])placementMatrix[index]!*=(actor.scale);
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
       drawIds.push(id);
     }
     active.add(actor.gid);
   }
   for(const [gid,state] of residents)if(!active.has(gid)){
     for(const id of state.ids)world.set(id,null);
     residents.delete(gid);
   }
   return drawIds;
 }
 return {
   retainModel,setActors,update,
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
