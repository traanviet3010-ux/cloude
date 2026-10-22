/**
 * The native original renderer has two scene input shapes: one-use
 * WorldSceneLease (asset worker) and an already admitted WorldScene (GameWorld).
 * Reuse the exact object/arrays in both cases. This adapter neither creates a
 * map nor alters WorldGroup IDs, material data or terrain ranges.
 */
import type {WorldScene} from "@/engine/contracts/scene";
import type {WorldSceneLease} from "@/engine/contracts/world-admission";
const MAX_SCENE_BYTES=128*1024*1024;
export function leaseOriginalWorldScene(scene:WorldScene):WorldSceneLease {
 if(!scene||typeof scene.id!=="string"||!scene.id||
   !Array.isArray(scene.groups)||!Number.isInteger(scene.originRegion))
   throw Error("Original GameWorld scene is invalid");
 let bytes=0;
 const buffers=new Set<ArrayBufferLike>();
 for(const group of scene.groups){
   const g=group.geometry;
   for(const a of [
     g.positions,g.indices,g.transform,g.normals,g.uvs,g.colors,g.maskUVs,
     g.instances,g.joints,g.weights,g.bones,g.vertices
   ]){
     if(!a)continue;
     // A view may refer to a shared transferable ArrayBuffer; count every
     // owned byte only once to avoid misclassifying genuine source scenes.
     if(!ArrayBuffer.isView(a)||!Number.isSafeInteger(a.byteLength))
       throw Error("Malformed native GameWorld geometry view");
     if(!buffers.has(a.buffer)){
       buffers.add(a.buffer);
       bytes+=a.buffer.byteLength;
     }
     if(bytes>MAX_SCENE_BYTES)
       throw Error("Original GameWorld render data exceeds admission budget");
   }
   for(const range of group.ranges??[]){
     const seams=range.seamVertices;
     if(seams&&!buffers.has(seams.buffer)){
       buffers.add(seams.buffer);bytes+=seams.buffer.byteLength;
     }
     bytes+=(range.heights?.length??0)*8;
     if(bytes>MAX_SCENE_BYTES)throw Error("Original terrain metadata exceeds budget");
   }
 }
 let consumed=false;
 return {
   sceneId:scene.id,
   takeWorld(){
     if(consumed)throw Error("Original GameWorld scene lease already consumed");
     consumed=true;
     return {scene,bytes,starBytes:0};
   }
 };
}
