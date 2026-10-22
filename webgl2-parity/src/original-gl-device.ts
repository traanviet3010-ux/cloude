/**
 * WebGL2 native GPU ownership foundation for the ORIGINAL Silkroad runtime.
 * This is the low-level graphics translation, not a replacement game client.
 * All resources are tracked, GPU memory is bounded, no orphan context survives
 * disposal, and context loss never yields a fake successful frame.
 */
export type GlResourceKind="buffer"|"texture"|"framebuffer"|"renderbuffer"|"vertexArray"|"program"|"shader";
type GlResource=WebGLBuffer|WebGLTexture|WebGLFramebuffer|WebGLRenderbuffer|WebGLVertexArrayObject|WebGLProgram|WebGLShader;
type RecordEntry={readonly kind:GlResourceKind;readonly object:GlResource;readonly bytes:number};
export interface OriginalGlDeviceOptions {
 readonly maxResidentMB?:number;
 readonly mobile?:boolean;
 readonly context?:WebGL2RenderingContext;
}
export function createOriginalGlDevice(canvas:HTMLCanvasElement,options:OriginalGlDeviceOptions={}){
 const context=options.context??canvas.getContext("webgl2",{
   alpha:false,antialias:false,depth:true,stencil:false,
   preserveDrawingBuffer:false,powerPreference:"low-power"
 });
 if(!context)throw Error("Original Silkroad requires a WebGL2 context");
 // TS does not preserve nullable-canvas checks through nested closures.
 // Retain the exact validated instance, never open a second GL context.
 const gl:WebGL2RenderingContext=context;
 if(gl.canvas!==canvas)throw Error("Original WebGL2 context belongs to another canvas");
 const mobile=options.mobile??/iPhone|iPad|Android/.test(navigator.userAgent);
 const budget=options.maxResidentMB??(mobile?320:768);
 if(!Number.isFinite(budget)||budget<16||budget>4096)
   throw Error("Invalid native WebGL2 memory budget");
 const limit=Math.floor(budget*1048576);
 const live=new Map<GlResource,RecordEntry>();
 const retired=new Set<GlResource>();
 let bytes=0,frame=0,inFrame=false,disposed=false,lost=false;
 const onLost=(event:Event)=>{event.preventDefault();lost=true;};
 // WebGL objects are invalid after restoration. A new native renderer
 // generation must re-upload retained original assets; never use old handles.
 const onRestored=()=>{lost=true;};
 canvas.addEventListener("webglcontextlost",onLost,false);
 canvas.addEventListener("webglcontextrestored",onRestored,false);
 const assert=()=>{if(disposed)throw Error("Original GL device disposed");
   if(lost||gl.isContextLost())throw Error("Original GL device context lost: recreate renderer generation");};
 function destroy(entry:RecordEntry){
   switch(entry.kind){
     case "buffer":gl.deleteBuffer(entry.object as WebGLBuffer);break;
     case "texture":gl.deleteTexture(entry.object as WebGLTexture);break;
     case "framebuffer":gl.deleteFramebuffer(entry.object as WebGLFramebuffer);break;
     case "renderbuffer":gl.deleteRenderbuffer(entry.object as WebGLRenderbuffer);break;
     case "vertexArray":gl.deleteVertexArray(entry.object as WebGLVertexArrayObject);break;
     case "program":gl.deleteProgram(entry.object as WebGLProgram);break;
     case "shader":gl.deleteShader(entry.object as WebGLShader);break;
   }
 }
// Retired resources remain counted until flush. Entries are removed from
 // public ownership immediately and stored separately for deferred destroy.
 const retiredEntries=new Map<GlResource,RecordEntry>();
 function release(resource:GlResource){
   const entry=live.get(resource);
   if(!entry)return;
   live.delete(resource);
   if(inFrame){retired.add(resource);retiredEntries.set(resource,entry);}
   else{bytes-=entry.bytes;destroy(entry);}
 }
 function flush(){
   for(const resource of retired){
     const entry=retiredEntries.get(resource);
     if(entry){bytes-=entry.bytes;destroy(entry);}
   }
   retired.clear();retiredEntries.clear();
 }
 function own<T extends GlResource>(kind:GlResourceKind,resource:T|null,byteSize=0):T{
   assert();
   if(!resource)throw Error("Original WebGL2 allocation failed: "+kind);
   if(!Number.isSafeInteger(byteSize)||byteSize<0||byteSize>limit)
     throw Error("Invalid WebGL2 GPU allocation size: "+kind);
   if(bytes+byteSize>limit){
     destroy({kind,object:resource,bytes:byteSize});
     throw Error("Original WebGL2 GPU memory budget exceeded; no eviction of active Silkroad scene");
   }
   if(live.has(resource)||retired.has(resource))throw Error("Duplicate native WebGL2 resource");
   live.set(resource,{kind,object:resource,bytes:byteSize});
   bytes+=byteSize;
   return resource;
 }
 function allocateBuffer(data:BufferSource,target:number,usage=gl.STATIC_DRAW){
   assert();
   const byteSize=data instanceof ArrayBuffer?data.byteLength:data.byteLength;
   if(bytes+byteSize>limit)throw Error("Native WebGL2 buffer budget exceeded");
   const b=gl.createBuffer();if(!b)throw Error("Cannot allocate original WebGL2 buffer");
   try{
     gl.bindBuffer(target,b);gl.bufferData(target,data,usage);
     if(gl.getError()!==gl.NO_ERROR)throw Error("Original buffer upload failed");
     return own("buffer",b,byteSize);
   }catch(error){gl.deleteBuffer(b);throw error;}
 }
 function allocateTexture2D(width:number,height:number,rgba?:Uint8Array){
   assert();
   const max=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
      width<1||height<1||width>max||height>max||
      width*height>Math.floor(limit/4))
     throw Error("Invalid native WebGL2 texture dimensions");
   const cost=width*height*4;
   if(rgba&&rgba.length!==cost)throw Error("Original texture RGBA length mismatch");
   if(bytes+cost>limit)throw Error("Original WebGL2 texture budget exceeded");
   const t=gl.createTexture();if(!t)throw Error("Cannot allocate original GL texture");
   try{
     gl.bindTexture(gl.TEXTURE_2D,t);
     gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,
       gl.RGBA,gl.UNSIGNED_BYTE,rgba??null);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
     if(gl.getError()!==gl.NO_ERROR)throw Error("Original GL texture allocation failed");
     return own("texture",t,cost);
   }catch(error){gl.deleteTexture(t);throw error;}
 }
 function beginFrame(){
   assert();if(inFrame)throw Error("Original GL nested frame");
   frame++;inFrame=true;return frame;
 }
 function endFrame(){
   if(!inFrame)throw Error("Original GL frame not open");
   inFrame=false;flush();assert();
 }
 function dispose(){
   if(disposed)return;
   disposed=true;inFrame=false;
   canvas.removeEventListener("webglcontextlost",onLost,false);
   canvas.removeEventListener("webglcontextrestored",onRestored,false);
   flush();
   for(const entry of live.values())destroy(entry);
   live.clear();bytes=0;
 }
 return {
   gl,assert,own,allocateBuffer,allocateTexture2D,release,beginFrame,endFrame,dispose,
   stats:()=>({bytes,megabytes:bytes/1048576,resources:live.size+retired.size,
     budgetMB:budget,frame,open:inFrame,lost,disposed})
 };
}
export type OriginalGlDevice=ReturnType<typeof createOriginalGlDevice>;
