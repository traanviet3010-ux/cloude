/**
 * Native HieuSRO v1.150 terrain submission plan, for WebGL2.
 * Only consumes WorldGroup.ranges, vertex buffers and the original
 * OpenSRO terrainLod() function. No new tile geometry or textures.
 *
 * Source GPU world/world.ts:
 * - full title/character detail chooses LOD 0 for every cell.
 * - distance detail chooses terrainLod squared eye-cell distance.
 * - only selected index ranges are submitted.
 * - skirts stitch to the adjacent cell's coarser LOD.
 */
import type {WorldGroup,WorldCamera} from "@/engine/contracts/scene";
import type {Geometry} from "@/engine/contracts/geometry";
import {terrainLod} from "@/engine/foundation/rendering/world-math";

export interface OriginalTerrainPlan {
  readonly geometry:Geometry;
  readonly rangeCount:number;
  readonly triangles:number;
  readonly eyeCell:readonly [number,number];
  readonly changedVertices:number;
}

export function selectOriginalTerrain(
  group:WorldGroup,
  camera:Pick<WorldCamera,"eye">,
  detail:"full"|"distance"
):OriginalTerrainPlan {
  const ranges=group.ranges;
  if(!ranges?.length)throw Error("Original terrain has no authored cell ranges");
  if(detail!=="full" && detail!=="distance")throw Error("Invalid original terrain detail policy");
  if(!camera.eye.every(Number.isFinite))throw Error("Invalid native terrain camera");
  const eyeCellX=Math.floor(camera.eye[0]/320),eyeCellZ=Math.floor(camera.eye[2]/320);
  const selectLod=(dx:number,dz:number)=>
    detail==="full"?0:terrainLod(dx*dx+dz*dz);
  const original=group.geometry;
  const outputIndices=new Uint32Array(original.indices.length);
  const positions=original.positions.slice(); // no mutation of old scene/worker ownership
  let indexCount=0,changedVertices=0,rangeCount=0;
  for(const range of ranges) {
    if(!Number.isInteger(range.lod)||range.lod<0||range.lod>3||
      !range.cell?.every(Number.isInteger)||
      !Number.isSafeInteger(range.indexStart)||range.indexStart<0||
      !Number.isSafeInteger(range.indexCount)||range.indexCount<0||
      range.indexCount%3!==0||
      range.indexStart+range.indexCount>original.indices.length)
      throw Error("Original terrain index range is corrupt");
    const [cx,cz]=range.cell;
    if(range.lod!==selectLod(cx-eyeCellX,cz-eyeCellZ))continue;
    if(indexCount+range.indexCount>outputIndices.length)
      throw Error("Original terrain selected indices exceed native group budget");
    outputIndices.set(
      original.indices.subarray(range.indexStart,range.indexStart+range.indexCount),
      indexCount
    );
    indexCount+=range.indexCount;rangeCount++;
    const seams=range.seamVertices;
    if(!seams?.length)continue;
    if(seams.length%2||!Array.isArray(range.heights)||range.heights.length!==289)
      throw Error("Invalid original terrain seam inputs");
    const step=1<<range.lod;
    const north=selectLod(cx-eyeCellX,cz-1-eyeCellZ)>range.lod;
    const east=selectLod(cx+1-eyeCellX,cz-eyeCellZ)>range.lod;
    const south=selectLod(cx-eyeCellX,cz+1-eyeCellZ)>range.lod;
    const west=selectLod(cx-1-eyeCellX,cz-eyeCellZ)>range.lod;
    for(let at=0;at<seams.length;at+=2){
      const index=seams[at]!,heightIndex=seams[at+1]!;
      if(index>=positions.length/3||heightIndex>=289)
        throw Error("Original terrain seam index invalid");
      const x=heightIndex%17,z=Math.floor(heightIndex/17);
      let y=range.heights[heightIndex]!;
      if(((z===0&&north)||(z===16&&south)) && (x/step)%2===1){
        if(x<step||x+step>16)throw Error("Native terrain skirt height out of grid");
        y=(range.heights[z*17+x-step]!+range.heights[z*17+x+step]!)/2;
      } else if(((x===0&&west)||(x===16&&east)) && (z/step)%2===1){
        if(z<step||z+step>16)throw Error("Native terrain skirt width out of grid");
        y=(range.heights[(z-step)*17+x]!+range.heights[(z+step)*17+x]!)/2;
      }
      if(!Number.isFinite(y))throw Error("Invalid native terrain seam height");
      if(positions[index*3+1]!==Math.fround(y)){
        positions[index*3+1]=y;changedVertices++;
      }
    }
  }
  // "full" and "distance" both submit exactly original selected indices:
  // never draw all four LODs simultaneously or change authored UVs/material.
  const geometry:Geometry={
    ...original,positions,indices:outputIndices.slice(0,indexCount),
    vertices:undefined,dynamicVertices:false
  };
  return {geometry,rangeCount,triangles:indexCount/3,
    eyeCell:[eyeCellX,eyeCellZ],changedVertices};
}
