/* Original Silkroad WorldTexture GPU upload — WebGL2 (S3TC native or Safari fallback).
 * Ownership is transferred from original asset worker into this renderer.
 * No external URLs, fake model skins, base64 caching, or new texture formats.
 */
import type { WorldTexture } from "@/engine/contracts/texture";
import { nativeLevelBytes,unpackNativeTexture } from "./native-texture";
type Slot={handle:WebGLTexture;bytes:number;width:number;height:number;last:number;baseMip:number};
export class OriginalWorldTextures {
 private readonly data=new Map<string,Slot>();
 private used=0;
 private current=0;
 private readonly limit:number;
 private mipReductions=0;
 private evictions=0;
 private rejectedUploads=0;
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
     width<1||height<1||width*height>16*1024*1024||
     !Number.isSafeInteger(max)||max<1)
     throw Error("Original Silkroad texture dimensions invalid");
   const native="kind" in image && image.kind==="native-texture";
   const first=native?image.levels[0]:null;
   if(native && (!first||first.byteLength!==nativeLevelBytes(image.format,width,height)))
     throw Error("Original world texture's native first mip is corrupt");
   const compressed=native && image.format!=="bgra8unorm"?
     gl.getExtension("WEBGL_compressed_texture_s3tc"):null;
   // Pandora Android's terrain tile pool inspired this conservative fallback:
   // select only an EXISTING ORIGINAL mip, and only if the full-resolution
   // image cannot fit the device's GL max-size or our per-texture budget.
   // Never rescale invented pixels or degrade textures that already fit.
   let baseMip=0,uploadWidth=width,uploadHeight=height;
   const uploadedBytes=(w:number,h:number)=>
     native&&compressed?nativeLevelBytes(image.format,w,h):w*h*4;
   let bytes=uploadedBytes(width,height);
   while(native && (uploadWidth>max||uploadHeight>max||bytes>this.limit) &&
         baseMip+1<image.levels.length){
     baseMip++;
     uploadWidth=Math.max(1,width>>baseMip);
     uploadHeight=Math.max(1,height>>baseMip);
     bytes=uploadedBytes(uploadWidth,uploadHeight);
   }
   if(uploadWidth>max||uploadHeight>max||bytes>this.limit){
     this.rejectedUploads++;
     throw Error("Native world texture exceeds memory allowance or device dimensions");
   }
   const selected=native?image.levels[baseMip]:null;
   if(native && (!selected||selected.byteLength!==
        nativeLevelBytes(image.format,uploadWidth,uploadHeight))){
     this.rejectedUploads++;
     throw Error("Original Silkroad selected native mip is corrupt");
   }
   const old=this.data.get(path);
   const keep=new Set(protectedPaths);keep.add(path);
   // Plan eviction WITHOUT mutating current title/GameWorld residency.
   // A failed Safari GL upload must never destroy textures that still
   // belong to the previous complete native scene.
   const candidates=[...this.data].sort((a,b)=>a[1].last-b[1].last);
   const victims:Array<readonly [string,Slot]>=[];
   let projected=this.used-(old?.bytes??0)+bytes;
   for(const [key,slot] of candidates){
     if(projected<=this.limit)break;
     if(keep.has(key))continue;
     victims.push([key,slot]);
     projected-=slot.bytes;
   }
   if(projected>this.limit){
     this.rejectedUploads++;
     throw Error("Native scene visible textures exceed WebGL2 budget");
   }
   const tex=gl.createTexture();
   if(!tex){this.rejectedUploads++;throw Error("Cannot allocate native scene texture");}
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
         gl.compressedTexImage2D(gl.TEXTURE_2D,0,fmt,uploadWidth,uploadHeight,0,selected!);
       }else{
         const rgba=unpackNativeTexture(image,baseMip);
         gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,uploadWidth,uploadHeight,0,
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
     // Commit only after the new native bitmap/BCn texture is validated.
     // Until this point, an OOM, lost GL context or corrupt upload leaves
     // the already-visible original Silkroad stage untouched.
     for(const [key,slot] of victims){
       gl.deleteTexture(slot.handle);this.data.delete(key);this.used-=slot.bytes;
       this.evictions++;
     }
     if(old){gl.deleteTexture(old.handle);this.used-=old.bytes;}
     this.data.set(path,{handle:tex,bytes,width:uploadWidth,height:uploadHeight,
       last:this.current,baseMip});
     this.used+=bytes;
     if(baseMip>0)this.mipReductions++;
     // Original AssetOwner still owns ImageBitmap lifetime: a character may
     // legitimately share this image across multiple primitives. Never close it here.
   }catch(e){gl.deleteTexture(tex);this.rejectedUploads++;throw e;}
 }
 stats(){return {residentMB:this.used/1048576,textureCount:this.data.size,
   mipReductions:this.mipReductions,evictions:this.evictions,
   rejectedUploads:this.rejectedUploads};}
 dispose(){
   for(const entry of this.data.values())this.gl.deleteTexture(entry.handle);
   this.data.clear();this.used=0;
 }
}
