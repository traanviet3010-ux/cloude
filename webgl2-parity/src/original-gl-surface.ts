/**
 * Native Silkroad WebGL2 scene target / browser surface.
 * WebGL2 owns the framebuffer; original world and UI owners supply all
 * artwork and draw commands. No bitmap placeholders are created.
 */
import type {OriginalGlDevice} from "./original-gl-device";

export function createOriginalGlSurface(device:OriginalGlDevice){
 const {gl}=device;
 let width=0,height=0,disposed=false,active=false;
 let color:WebGLTexture|null=null,depth:WebGLRenderbuffer|null=null;
 let framebuffer:WebGLFramebuffer|null=null;
 const assert=()=>{device.assert();if(disposed)throw Error("Original GL surface disposed");};
 function releaseAttachments(){
   if(color)device.release(color);
   if(depth)device.release(depth);
   if(framebuffer)device.release(framebuffer);
   color=null;depth=null;framebuffer=null;
 }
 function resize(nextWidth:number,nextHeight:number){
   assert();
   const max=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
   if(!Number.isSafeInteger(nextWidth)||!Number.isSafeInteger(nextHeight)||
      nextWidth<1||nextHeight<1||nextWidth>max||nextHeight>max)
     throw Error("Native Silkroad surface dimensions invalid");
   if(width===nextWidth&&height===nextHeight&&framebuffer)return;
   if(active)throw Error("Cannot resize Silkroad GL surface during frame");
   releaseAttachments();
   width=nextWidth;height=nextHeight;
   // Identical viewport for world and retail HUD. Optional render-scale
   // reductions are a later backend feature; UI must remain pixel-aligned.
   if(gl.canvas instanceof HTMLCanvasElement){
     gl.canvas.width=width;gl.canvas.height=height;
   }
   try{
     color=device.allocateTexture2D(width,height);
     depth=device.own("renderbuffer",gl.createRenderbuffer(),width*height*4);
     gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
     gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);
     framebuffer=device.own("framebuffer",gl.createFramebuffer());
     gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
     gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,
       gl.TEXTURE_2D,color,0);
     gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,
       gl.RENDERBUFFER,depth);
     if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)
       throw Error("Original Silkroad WebGL2 scene framebuffer incomplete");
     if(gl.getError()!==gl.NO_ERROR)
       throw Error("Original Silkroad WebGL2 target allocation failed");
   }catch(error){
     releaseAttachments();width=height=0;throw error;
   }finally{
     gl.bindFramebuffer(gl.FRAMEBUFFER,null);
     gl.bindRenderbuffer(gl.RENDERBUFFER,null);
   }
 }
 function beginScene(){
   assert();
   if(active)throw Error("Original GL scene frame already active");
   if(!framebuffer)throw Error("Original Silkroad GL surface not allocated");
   active=true;
   gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
   gl.viewport(0,0,width,height);
   gl.enable(gl.DEPTH_TEST);
   gl.depthMask(true);
   gl.disable(gl.SCISSOR_TEST);
 }
 function presentScene(){
   assert();
   if(!active||!framebuffer)throw Error("Original GL scene frame not active");
   // Resolve the original world first, then draw original UiScene at full
   // canvas resolution. No WebGPU swapchain is created.
   gl.disable(gl.SCISSOR_TEST);
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
   gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
   gl.blitFramebuffer(0,0,width,height,0,0,width,height,
     gl.COLOR_BUFFER_BIT,gl.NEAREST);
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);
   gl.viewport(0,0,width,height);
   active=false;
   if(gl.getError()!==gl.NO_ERROR)throw Error("Original GL surface present failed");
 }
 function abortScene(){
   if(disposed)return;
   active=false;
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 }
 function dispose(){
   if(disposed)return;
   active=false;
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);
   releaseAttachments();disposed=true;width=height=0;
 }
 return {resize,beginScene,presentScene,abortScene,dispose,
   stats:()=>({width,height,allocated:!!framebuffer,active,disposed})};
}
export type OriginalGlSurface=ReturnType<typeof createOriginalGlSurface>;
