/*
 * Convert the REAL OpenSRO NativeTexture contract (no synthetic PNGs).
 * Supports BGRA8, DXT1/BC1, DXT3/BC2, DXT5/BC3 for iPhone WebGL2
 * when WEBGL_compressed_texture_s3tc is absent.
 */
import type { NativeTexture } from "@/engine/contracts/texture";

const MAX_SIDE=4096,MAX_PIXELS=16*1024*1024;
const unpack565=(word:number):[number,number,number]=>[
  Math.round(((word>>11)&31)*255/31),
  Math.round(((word>>5)&63)*255/63),
  Math.round((word&31)*255/31)
];
function blockAlpha(data:Uint8Array,pixel:number){
  const a=data[0]!,b=data[1]!,offset=pixel*3;
  const d=(data[2+(offset>>3)]??0)|((data[3+(offset>>3)]??0)<<8);
  const index=(d>>(offset&7))&7;
  if(index===0)return a;
  if(index===1)return b;
  if(a>b)return Math.floor(((8-index)*a+(index-1)*b)/7);
  if(index===6)return 0;
  if(index===7)return 255;
  return Math.floor(((6-index)*a+(index-1)*b)/5);
}
export function nativeLevelBytes(format:NativeTexture["format"],w:number,h:number):number{
  if(w<=0||h<=0)throw Error("SRO native texture invalid dimensions");
  return format==="bgra8unorm"?w*h*4:
    Math.ceil(w/4)*Math.ceil(h/4)*(format==="bc1-rgba-unorm"?8:16);
}
export function unpackNativeTexture(texture:NativeTexture,level=0){
  if(texture.kind!=="native-texture"||!Number.isInteger(level)||level<0||level>=texture.levels.length)
    throw Error("Invalid SRO native texture or mip level");
  const w=Math.max(1,texture.width>>level),h=Math.max(1,texture.height>>level);
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w>MAX_SIDE||h>MAX_SIDE||w*h>MAX_PIXELS)
    throw Error("Native texture exceeds CPU decode budget");
  const src=texture.levels[level]!;
  if(src.byteLength!==nativeLevelBytes(texture.format,w,h))throw Error("Native texture truncated or corrupt");
  const rgba=new Uint8Array(w*h*4);
  if(texture.format==="bgra8unorm"){
    for(let i=0;i<rgba.length;i+=4){
      rgba[i]=src[i+2]!;rgba[i+1]=src[i+1]!;
      rgba[i+2]=src[i]!;rgba[i+3]=src[i+3]!;
    }
    return {width:w,height:h,pixels:rgba};
  }
  const bc1=texture.format==="bc1-rgba-unorm",bc2=texture.format==="bc2-rgba-unorm";
  const stride=bc1?8:16,blocksX=Math.ceil(w/4),blocksY=Math.ceil(h/4);
  for(let by=0;by<blocksY;by++)for(let bx=0;bx<blocksX;bx++){
    const at=(by*blocksX+bx)*stride,base=at+(bc1?0:8);
    const c0=src[base]!|(src[base+1]!<<8),c1=src[base+2]!|(src[base+3]!<<8);
    const a=unpack565(c0),b=unpack565(c1);
    const palette=[
      [...a,255],[...b,255],
      a.map((v,i)=>Math.floor((2*v+b[i]!)/3)).concat(255),
      a.map((v,i)=>Math.floor((v+2*b[i]!)/3)).concat(255)
    ];
    if(bc1&&c0<=c1){
      palette[2]=a.map((v,i)=>Math.floor((v+b[i]!)/2)).concat(255);
      palette[3]=[0,0,0,0];
    }
    const indices=(src[base+4]!|(src[base+5]!<<8)|
      (src[base+6]!<<16)|(src[base+7]!<<24))>>>0;
    const alphaBlock=src.subarray(at,at+8);
    for(let py=0;py<4;py++)for(let px=0;px<4;px++){
      const x=bx*4+px,y=by*4+py;if(x>=w||y>=h)continue;
      const i=py*4+px,pos=(y*w+x)*4;
      const c=palette[(indices>>>(i*2))&3]!;
      rgba[pos]=c[0]!;rgba[pos+1]=c[1]!;rgba[pos+2]=c[2]!;
      rgba[pos+3]=bc1?c[3]!:bc2?
        ((alphaBlock[i>>1]!>>>((i&1)*4))&15)*17:blockAlpha(alphaBlock,i);
    }
  }
  return {width:w,height:h,pixels:rgba};
}
