/*
 * The ORIGINAL OpenSRO camera produces WebGPU (0..1) clip depth.
 * WebGL2 requires (-1..1). Preserve the authored x/y/camera basis,
 * remapping only clip-space z to prevent inverted/vanishing world geometry.
 */
export function originalCameraToWebgl2(matrix:Float32Array):Float32Array{
  if(!(matrix instanceof Float32Array)||matrix.length!==16||!matrix.every(Number.isFinite))
    throw Error("Original Silkroad camera matrix invalid");
  const out=matrix.slice();
  for(let col=0;col<4;col++){
    const i=col*4;
    out[i+2]=2*matrix[i+2]!-matrix[i+3]!;
  }
  return out;
}
