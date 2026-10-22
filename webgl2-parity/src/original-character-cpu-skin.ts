/**
 * Exact OpenSRO CPU skeletal animation fallback for WebGL2.
 *
 * Uses the ORIGINAL createCharacterPose() timeline, clip blending, native
 * skeleton, inverse-bind palettes and author-supplied four bone weights.
 * GPU original WGSL: bones[joints.x]*weights.x + ... then skin*position.
 * No replacement actor skeletons, no approximate/keyframe reconstruction.
 */
import type { CharacterModel,CharacterPrimitive,CharacterActor } from "@/engine/contracts/character";
import type { Geometry } from "@/engine/contracts/geometry";
import { createCharacterPose } from "@/engine/foundation/animation/animation-pose";

export interface SkinResult {geometry:Geometry;boneCount:number;vertexCount:number};
const VERTEX_LIMIT=65_536;
const JOINT_LIMIT=512;

export function createOriginalCpuCharacterSkin(model:CharacterModel){
 if(!model.nodes.length||model.nodes.length>JOINT_LIMIT||
    !model.nodes.every(n=>n.rotation.length===4&&n.translation.length===3&&n.scale.length===3))
   throw Error("Original character skeleton unsupported or over CPU budget");
 const pose=createCharacterPose(model);
 const scratch=new WeakMap<CharacterPrimitive,Float32Array>();
 function skin(primitive:CharacterPrimitive, actor:Pick<CharacterActor,
  "clip"|"time"|"loop"|"layers"|"bodyVolume"|"boneRotation">):SkinResult{
   if(!model.primitives.includes(primitive))throw Error("Unknown native character primitive");
   if(primitive.cloth||primitive.ribbon||primitive.particleEmitter!==undefined||
      primitive.particleProgram||primitive.billboard)
     throw Error("Original character effects/cloth need separate WebGL2 pass");
   const source=primitive.geometry;
   const n=source.positions.length/3, boneCount=primitive.joints.length;
   if(!Number.isInteger(n)||n<1||n>VERTEX_LIMIT||boneCount<1||boneCount>JOINT_LIMIT)
     throw Error("Native character mesh CPU skinning budget exceeded");
   if(source.positions.length!==n*3||source.joints?.length!==n*4||
      source.weights?.length!==n*4||primitive.inverseBind.length!==boneCount*16)
     throw Error("Original character skin streams/inverse-bind invalid");
   if(source.normals&&source.normals.length!==n*3)
     throw Error("Original character normal stream invalid");
   if(!source.joints||!source.weights)
     throw Error("Original character skin influences absent");
   const {joints,weights}=source;
   for(let i=0;i<joints.length;i++){
     if(!Number.isFinite(weights[i])||weights[i]!<0||weights[i]!>1 ||
       (weights[i]!>0&&joints[i]!>=boneCount))
       throw Error("Original character skin joint/weight out of range");
   }
   const volume=actor.bodyVolume;
   pose.bodyVolume(volume?.index,volume?.female);
   pose.setBoneRotation(actor.boneRotation?.bone??"",actor.boneRotation?.rotation??null);
   pose.evaluate(actor.clip,actor.time,actor.loop,actor.layers);
   let palette=scratch.get(primitive);
   if(!palette){palette=new Float32Array(boneCount*16);scratch.set(primitive,palette);}
   pose.palette(primitive,palette);
   const positions=new Float32Array(source.positions.length);
   const normals=source.normals?new Float32Array(source.normals.length):undefined;
   for(let v=0;v<n;v++){
     const src=v*3,inf=v*4;
     const x=source.positions[src]!,y=source.positions[src+1]!,z=source.positions[src+2]!;
     const nx=source.normals?.[src]??0,ny=source.normals?.[src+1]??1,
       nz=source.normals?.[src+2]??0;
     let ox=0,oy=0,oz=0, nnx=0,nny=0,nnz=0;
     for(let k=0;k<4;k++){
       const w=weights[inf+k]!;
       if(w===0)continue;
       const at=joints[inf+k]!*16;
       ox+=w*(palette[at]! *x+palette[at+4]!*y+palette[at+8]!*z+palette[at+12]!);
       oy+=w*(palette[at+1]! *x+palette[at+5]!*y+palette[at+9]!*z+palette[at+13]!);
       oz+=w*(palette[at+2]! *x+palette[at+6]!*y+palette[at+10]!*z+palette[at+14]!);
       nnx+=w*(palette[at]!*nx+palette[at+4]!*ny+palette[at+8]!*nz);
       nny+=w*(palette[at+1]!*nx+palette[at+5]!*ny+palette[at+9]!*nz);
       nnz+=w*(palette[at+2]!*nx+palette[at+6]!*ny+palette[at+10]!*nz);
     }
     if(!Number.isFinite(ox)||!Number.isFinite(oy)||!Number.isFinite(oz)||
       !Number.isFinite(nnx)||!Number.isFinite(nny)||!Number.isFinite(nnz))
       throw Error("Original character CPU pose produced nonfinite vertices");
     positions[src]=ox;positions[src+1]=oy;positions[src+2]=oz;
     if(normals){normals[src]=nnx;normals[src+1]=nny;normals[src+2]=nnz;}
   }
   // The GPU pipeline expects skinned geometry in the same model-space
   // coordinate basis. A distinct world actor transform remains authoritative
   // and must be supplied by the existing presentation/runtime owner.
   const geometry:Geometry={
     ...source,positions,normals,
     joints:undefined,weights:undefined,bones:undefined,
     // The CPU-skinning input may have an immutable authored transform.
     transform:source.transform.slice(),
     dynamicVertices:false,vertices:undefined
   };
   return {geometry,boneCount,vertexCount:n};
 }
 return {skin,pose};
}
