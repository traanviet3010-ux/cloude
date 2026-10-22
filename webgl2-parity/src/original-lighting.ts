/**
 * Read the UNCHANGED packed environment that the original HieuSRO GPU
 * publishes through worldEnvironment(). Never invent retail sky/light colors.
 *
 * Native pipeline offsets are documented in pinned OpenSRO
 * runtime/renderer/renderer.ts: DIFFUSE=8, AMBIENT=12, SUN_DIRECTION=84.
 */
export interface OriginalGlLighting {
  readonly diffuse: Float32Array;
  readonly ambient: Float32Array;
  readonly direction: Float32Array;
}
const DIFFUSE=8,AMBIENT=12,SUN_DIRECTION=84;
const RETAIL_LIGHT=Math.SQRT1_2;

export function readOriginalGlLighting(packed: Float32Array,
  useOriginalSunDirection=false):OriginalGlLighting {
  if(!(packed instanceof Float32Array)||packed.length<=SUN_DIRECTION+2||
    !packed.every(Number.isFinite))
    throw Error("Invalid native OpenSRO packed worldEnvironment lighting");
  for(const offset of [DIFFUSE,AMBIENT])
    for(let i=0;i<3;i++)
      if(packed[offset+i]!<0||packed[offset+i]!>1)
        throw Error("Native Silkroad lighting color outside packed range");
  const diffuse=packed.slice(DIFFUSE,DIFFUSE+3);
  const ambient=packed.slice(AMBIENT,AMBIENT+3);
  const nativeSun=packed.slice(SUN_DIRECTION,SUN_DIRECTION+3);
  const len=Math.hypot(...nativeSun);
  if(useOriginalSunDirection&&(!(len>0.00001)||!Number.isFinite(len)))
    throw Error("Native Silkroad sun direction missing");
  return {
    diffuse,ambient,
    direction:useOriginalSunDirection?
      Float32Array.of(nativeSun[0]!/len,nativeSun[1]!/len,nativeSun[2]!/len):
      Float32Array.of(RETAIL_LIGHT,RETAIL_LIGHT,0)
  };
}
