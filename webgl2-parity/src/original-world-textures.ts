/* Original Silkroad WorldTexture GPU upload — WebGL2 (S3TC native or Safari fallback).
 * Ownership is transferred from original asset worker into this renderer.
 * No external URLs, fake model skins, base64 caching, or new texture formats.
 */
import type { WorldTexture } from "@/engine/contracts/texture";
import { nativeLevelBytes,unpackNativeTexture } from "./native-texture";
type Slot={handle:WebGLTexture;bytes:number;width:number;height:number;last:number};
export class OriginalWorldTextures {
 private readonly data=new Map<string,Slot>();
 private used=0;
 private current=0;
 private readonly limit:number;
 constructor(private readonly gl:WebGL2RenderingContext,memoryMB=96){
   if(!Number.isFinite(memoryMB)||memoryMB<8||memoryMB>512)throw Error("Native world texture budget invalid");
   this.limit=Math.floor(memoryMB*1048576);
 }
 has(path:string){return this.data.has(path);}
 get(path:string):WebGLTexture{
   const entry=this.data.get(path);if(!entry)throw Error("Original Silkroad world texture missing: "+path);
   entry.last=this.current;return entry.handle;
 }
 frame(){this.current++;}
 put(path:string,image:WorldTexture|null,protectedPaths:ReadonlySet<string>=new Set()){
   if(!path||path.length>1024||path.includes(".."))throw Error("Original Silkroad texture path invalid");
   const gl=this.gl;
   if(!image){
     const old=this.data.get(path);
     if(old){gl.deleteTexture(old.handle);this.data.delete(path);this.used-=old.bytes;}
     return;
   }
   const {width,height}=image;
   const max=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
     width<1||height<1||width>max||height>max||width*height>16*1024*1024)
     throw Error("Original Silkroad texture dimensions invalid");
   const native="kind" in image && image.kind==="native-texture";
   const first=native?image.levels[0]:null;
   if(native && (!first||first.byteLength!==nativeLevelBytes(image.format,width,height)))
     throw Error("Original world texture's native first mip is corrupt");
   const compressed=native && image.format!=="bgra8unorm"?
     gl.getExtension("WEBGL_compressed_texture_s3tc"):null;
   const bytes=compressed && first?first.byteLength:width*height*4;
   const old=this.data.get(path);
   if(bytes>this.limit)throw Error("Native world texture exceeds memory allowance");
   const keep=new Set(protectedPaths);keep.add(path);
   const candidates=[...this.data].sort((a,b)=>a[1].last-b[1].last);
   for(const [key,slot] of candidates){
     if(this.used-(old?.bytes??0)+bytes>this.limit && !keep.has(key)){
       gl.deleteTexture(slot.handle);this.data.delete(key);this.used-=slot.bytes;
     }
   }
   if(this.used-(old?.bytes??0)+bytes>this.limit)
     throw Error("Native scene visible textures exceed WebGL2 budget");
   const tex=gl.createTexture();if(!tex)throw Error("Cannot allocate native scene texture");
   try{
     gl.bindTexture(gl.TEXTURE_2D,tex);
     gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
     gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);
     if(native){
       if(compressed){
         const fmt=image.format==="bc1-rgba-unorm"?compressed.COMPRESSED_RGBA_S3TC_DXT1_EXT:
           image.format==="bc2-rgba-unorm"?compressed.COMPRESSED_RGBA_S3TC_DXT3_EXT:
            compressed.COMPRESSED_RGBA_S3TC_DXT5_EXT;
         gl.compressedTexImage2D(gl.TEXTURE_2D,0,fmt,width,height,0,first!);
       }else{
         const rgba=unpackNativeTexture(image);
         gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,
           gl.RGBA,gl.UNSIGNED_BYTE,rgba.pixels);
       }
     }else if(image instanceof ImageBitmap){
       gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
     }else throw Error("Unsupported native Silkroad world texture input");
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
     if(gl.getError()!==gl.NO_ERROR)throw Error("Original Silkroad world texture GPU upload failed");
     if(old){gl.deleteTexture(old.handle);this.used-=old.bytes;}
     this.data.set(path,{handle:tex,bytes,width,height,last:this.current});
     this.used+=bytes;
     if(image instanceof ImageBitmap)image.close();
   }catch(e){gl.deleteTexture(tex);throw e;}
 }
 stats(){return {residentMB:this.used/1048576,textureCount:this.data.size};}
 dispose(){
   for(const entry of this.data.values())this.gl.deleteTexture(entry.handle);
   this.data.clear();this.used=0;
 }
}
