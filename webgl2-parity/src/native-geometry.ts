/*
 * OpenSRO original Geometry contract admission for WebGL2.
 * Does not create substitutes for unsupported native materials/animation:
 * failing admission is required until the correct Silkroad draw path exists.
 */
import type { Geometry } from "@/engine/contracts/geometry";
export interface GlNativeGeometry {
  vertices:Float32Array; // pos3, normals3, uv2, color4
  indices:Uint32Array;
  instances:Float32Array;
  instanceCount:number;
  transform:Float32Array;
  vertexCount:number;
  triangles:number;
  byteSize:number;
}
const MAX_VERTICES=250_000, MAX_INDICES=900_000, MAX_INSTANCES=8192;
const finite=(v:ArrayLike<number>)=>{
  for(let i=0;i<v.length;i++)if(!Number.isFinite(v[i]))return false;
  return true;
};
export function admitOriginalGeometry(source:Geometry):GlNativeGeometry {
  const {positions,indices,uvs,normals,colors,transform}=source;
  if(!(positions instanceof Float32Array)||!(indices instanceof Uint32Array)||
    !(transform instanceof Float32Array)||transform.length!==16)
    throw Error("Original SRO geometry has invalid array types");
  const n=positions.length/3;
  if(!Number.isInteger(n)||n<=0||n>MAX_VERTICES||
    indices.length%3!==0||indices.length>MAX_INDICES||!indices.length)
    throw Error("Original SRO geometry exceeds WebGL2 admission budget");
  if(uvs&&uvs.length!==n*2 || normals&&normals.length!==n*3 ||
    colors&&colors.length!==n*4 || !finite(positions)||
    !finite(transform)||(uvs&&!finite(uvs))||(normals&&!finite(normals))||
    (colors&&!finite(colors)))throw Error("Original geometry stream malformed");
  for(let k=0;k<indices.length;k++)if(indices[k]!>=n)
    throw Error("Original geometry index outside admitted vertex buffer");
  if(source.joints||source.weights||source.bones||source.cloth)
    throw Error("SRO skeleton/cloth cannot be silently drawn as static geometry");
  const instanceBuffer=source.instances;
  if(instanceBuffer&&(!(instanceBuffer instanceof Float32Array)||
     !instanceBuffer.length||instanceBuffer.length%16!==0||
     instanceBuffer.length/16>MAX_INSTANCES||!finite(instanceBuffer)))
    throw Error("Original Silkroad instance matrices invalid/exceed WebGL2 budget");
  const instances=instanceBuffer??new Float32Array([
    1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1
  ]);
  for(let i=0;i<instances.length;i+=16){
    if(Math.abs(instances[i+3]!)>1e-4||Math.abs(instances[i+7]!)>1e-4||
      Math.abs(instances[i+11]!)>1e-4||Math.abs(instances[i+15]!-1)>1e-4)
      throw Error("Original Silkroad instance matrix invalid affine transform");
  }
  if(source.dynamicVertices||source.vertices)throw Error("Original dynamic vertex mesh needs native update pipeline");
  const mat=source.material;
  if(mat?.unlit===false&&(!normals||normals.length!==n*3))
    throw Error("Original lighting requires native per-vertex normals");
  if(mat?.objectLight!==undefined &&
      (!Number.isFinite(mat.objectLight)||mat.objectLight<0))
    throw Error("Original object lighting scalar invalid");
  if(mat?.stageFactor!==undefined &&
     (!Number.isFinite(mat.stageFactor)||mat.stageFactor<0||mat.stageFactor>4))
    throw Error("Original native material stage factor invalid");
  if(mat?.ambient && (mat.ambient.length!==3 ||
     mat.ambient.some(v=>!Number.isFinite(v)||v<0||v>1)))
    throw Error("Original ambient lighting color invalid");
  if(mat?.alphaCompare!==undefined &&
    (!Number.isInteger(mat.alphaCompare) || mat.alphaCompare<1 || mat.alphaCompare>8))
    throw Error("Original Silkroad D3DCMPFUNC alpha comparison invalid");
  if(mat?.alphaCutoff!==undefined && (!Number.isFinite(mat.alphaCutoff)||mat.alphaCutoff<0||mat.alphaCutoff>1))
    throw Error("Original Silkroad alpha cutoff outside native 0..1 range");
  if(mat?.frames||mat?.textureStage||mat?.uvVelocity||mat?.uvAtlas||
     mat?.water||(mat?.sky!==undefined&&![1,3,5,6].includes(mat.sky))||mat?.colorTimeline||mat?.textureFactorPulse||
     mat?.environmentReflection||mat?.deferredParticle||
     mat?.fog||mat?.groundDecal||mat?.instanceFade||
     mat?.instanceMaterialTint||mat?.textureAlpha||mat?.surfaceAlpha||
     mat?.shaderDiffuse||mat?.decal||mat?.fogDisabled)
    throw Error("Original material requires native staged WebGL2 shader parity");
  if(mat?.texture && (!uvs||uvs.length!==n*2))
    throw Error("Original textured Silkroad mesh has no native UV coordinates");
  // The native static geometry layout supports explicit original lit and NOLIGHT modes.
  // Authored geometry values are preserved without scaling or triangulation.
  const data=new Float32Array(n*12);
  for(let i=0;i<n;i++){
    const o=i*12;
    data[o]=positions[i*3]!;
    data[o+1]=positions[i*3+1]!;
    data[o+2]=positions[i*3+2]!;
    data[o+3]=normals?.[i*3]??0;
    data[o+4]=normals?.[i*3+1]??1;
    data[o+5]=normals?.[i*3+2]??0;
    data[o+6]=uvs?.[i*2]??0;
    data[o+7]=uvs?.[i*2+1]??0;
    data[o+8]=colors?.[i*4]??1;
    data[o+9]=colors?.[i*4+1]??1;
    data[o+10]=colors?.[i*4+2]??1;
    data[o+11]=colors?.[i*4+3]??1;
  }
  return {vertices:data,indices:indices.slice(),instances:instances.slice(),
    instanceCount:instances.length/16,transform:transform.slice(),
    vertexCount:n,triangles:indices.length/3*instances.length/16,
    byteSize:data.byteLength+indices.byteLength+transform.byteLength+instances.byteLength};
}
