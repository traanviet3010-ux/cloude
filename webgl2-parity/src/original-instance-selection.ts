/**
 * Original Silkroad object instance residency + fades for the WebGL2 adapter.
 * Delegates to the pinned HieuSRO GPU compileWalkTable(), residentSlots(),
 * and createObjectFades(). This does not invent buildings or interpolate
 * procedural models. The native placed matrices and object ids survive.
 *
 * Source: pinned OpenSRO world/walk-table.ts + object-fades.ts.
 */
import type {WorldGroup,WorldCamera} from "@/engine/contracts/scene";
import {compileWalkTable,residentSlots,WALK_INSTANCED} from
  "@/engine/runtime/renderer/world/walk-table";
import {createObjectFades} from "@/engine/runtime/renderer/world/object-fades";

interface SelectedNativeInstance {
 readonly id:string;
 readonly matrices:Float32Array;
 readonly opacity:Float32Array;
 readonly count:number;
}
export function createOriginalInstanceSelection(groups:readonly WorldGroup[]){
 const table=compileWalkTable(groups,new WeakMap());
 const fades=createObjectFades();
 let disposed=false,lastFrame=-1;
 const check=()=>{if(disposed)throw Error("Native instance selection disposed");};
 return {
  select(camera:Pick<WorldCamera,"eye"|"target">,dt:number,frame:number,
    backgroundDistance=3500):readonly SelectedNativeInstance[]{
   check();
   if(!camera.eye.every(Number.isFinite)||!camera.target.every(Number.isFinite)||
     !Number.isFinite(dt)||dt<0||dt>1||!Number.isSafeInteger(frame)||
     frame<=lastFrame||!Number.isFinite(backgroundDistance)||backgroundDistance<=0)
     throw Error("Original instance selection frame/camera invalid");
   lastFrame=frame;
   const cellX=Math.floor(camera.target[0]/320),cellZ=Math.floor(camera.target[2]/320);
   const sceneryRange=Math.min(2500,
     Math.fround(backgroundDistance*Math.fround(.8)))-480;
   const selected:SelectedNativeInstance[]=[];
   for(let i=0;i<groups.length;i++){
     if(table.kind[i]!==WALK_INSTANCED)continue;
     const group=groups[i]!,src=group.geometry.instances!;
     const count=residentSlots(table,i,cellX,cellZ);
     const start=table.slotBase[i]!;
     const matrices=new Float32Array(count*16);
     const opacity=new Float32Array(count);
     let kept=0;
     for(let j=0;j<count;j++){
       const slot=table.resident[start+j]!;
       const descriptor=group.visibility?.[slot];
       let alpha=255;
       if(descriptor){
         const row=fades.row(descriptor.id);
         if(fades.lastFrame(row)!==frame){
           const at=slot*16;
           const dx=Math.fround(camera.eye[0]-src[at+12]!);
           const dy=Math.fround(camera.eye[1]-src[at+13]!);
           const dz=Math.fround(camera.eye[2]-src[at+14]!);
           const distance=Math.fround(Math.sqrt(
             Math.fround(Math.fround(dy*dy)+Math.fround(dx*dx)+Math.fround(dz*dz))));
           const range=descriptor.sceneryRange?sceneryRange:descriptor.range;
           fades.advance(row,distance,descriptor.radius,range,dt,frame);
         }
         alpha=fades.state(row)===0?0:fades.published(row);
       }
       if(alpha===0)continue;
       matrices.set(src.subarray(slot*16,slot*16+16),kept*16);
       opacity[kept]=alpha/255;
       kept++;
     }
     if(kept)selected.push({
       id:group.id,matrices:matrices.slice(0,kept*16),
       opacity:opacity.slice(0,kept),count:kept
     });
   }
   return selected;
  },
  stats:()=>{check();return {nativeGroups:table.groups.length,fadingPlacements:fades.size()};},
  dispose(){fades.clear();disposed=true;}
 };
}
