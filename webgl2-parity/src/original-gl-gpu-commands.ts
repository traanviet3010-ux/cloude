/**
 * The original OpenSRO FrameOwner submits explicit ordered GPU operations.
 * This WebGL2 native command owner translates the portable subset of those
 * operations, rather than constructing a fake GPURenderPassEncoder / GPUDevice.
 *
 * Generation ownership: an encoded command list is one-use, validates its
 * full draw sequence before changing GL state, and refuses stale GL context.
 * Compute, WebGPU pipeline reflection and unsupported render-bundle semantics
 * deliberately fail closed until corresponding real native paths are ported.
 */
import type {OriginalGlDevice} from "./original-gl-device";

export interface OriginalGlDraw {
  readonly program:WebGLProgram;
  readonly vertexArray:WebGLVertexArrayObject;
  readonly count:number;
  readonly instances:number;
  readonly firstIndex?:number;
  readonly depthTest?:boolean;
  readonly depthWrite?:boolean;
  readonly cull?:boolean;
  readonly blend?:{
    readonly source:number;
    readonly destination:number;
    readonly constant?:readonly [number,number,number,number];
  };
}
export interface OriginalGlRenderBundle {
 readonly draws:readonly OriginalGlDraw[];
}
export interface OriginalGlPass {
  readonly framebuffer?:WebGLFramebuffer|null;
  readonly width:number;
  readonly height:number;
  readonly clearColor?:readonly [number,number,number,number];
  readonly clearDepth?:number;
  readonly colorLoad?:"clear"|"load";
  readonly depthLoad?:"clear"|"load";
}
type Op=
  |{type:"pass";options:OriginalGlPass}
  |{type:"draw";draw:OriginalGlDraw}
  |{type:"scissor";rect:readonly [number,number,number,number]|null}
  |{type:"end"};

function finite(v:readonly number[]){return v.every(Number.isFinite);}
function snapshotDraw(draw:OriginalGlDraw):OriginalGlDraw{
 return Object.freeze({...draw,blend:draw.blend?
   Object.freeze({...draw.blend,constant:draw.blend.constant?
     Object.freeze([...draw.blend.constant] as [number,number,number,number]):undefined}):undefined});
}
function snapshotPass(pass:OriginalGlPass):OriginalGlPass{
 return Object.freeze({...pass,clearColor:pass.clearColor?
   Object.freeze([...pass.clearColor] as [number,number,number,number]):undefined});
}
export function createOriginalGlGpuCommands(device:OriginalGlDevice){
 const {gl}=device;
 let disposed=false,commandIndex=0,submissions=0,drawCalls=0;
 const assert=()=>{device.assert();if(disposed)throw Error("Original GL command owner disposed");};
 const maximum=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
 function createRenderBundleEncoder(){
   assert();
   let closed=false;
   const draws:OriginalGlDraw[]=[];
   return {
     drawIndexed(draw:OriginalGlDraw){
       assert();
       if(closed)throw Error("Original GPU render bundle already finished");
       if(!Number.isSafeInteger(draw.count)||draw.count<0||
         !Number.isSafeInteger(draw.instances)||draw.instances<0)
         throw Error("Original GPU render bundle contains invalid draw");
       draws.push(snapshotDraw(draw));
     },
     finish():OriginalGlRenderBundle{
       assert();
       if(closed)throw Error("Original GPU render bundle already finished");
       closed=true;
       return Object.freeze({draws:Object.freeze(draws.slice())});
     }
   };
 }
 function encoder(){
   assert();
   const generation=++commandIndex,ops:Op[]=[];
   let recording=true,pass=false,done=false;
   const active=()=>{assert();if(!recording)throw Error("Original GPU command encoder closed");};
   return {
     beginRenderPass(options:OriginalGlPass){
       active();
       if(pass)throw Error("Original GPU nested render pass not supported");
       if(!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||
         options.width<1||options.height<1||options.width>maximum||options.height>maximum||
         options.colorLoad && options.colorLoad!=="clear"&&options.colorLoad!=="load"||
         options.depthLoad && options.depthLoad!=="clear"&&options.depthLoad!=="load"||
         options.clearColor && (!finite(options.clearColor)||options.clearColor.some(v=>v<0||v>1))||
         options.clearDepth!==undefined&&(!Number.isFinite(options.clearDepth)||
           options.clearDepth<0||options.clearDepth>1))
          throw Error("Original GPU render pass descriptor invalid");
       pass=true;
       ops.push({type:"pass",options:snapshotPass(options)});
       return {
         drawIndexed(draw:OriginalGlDraw){
           active();if(!pass)throw Error("Native GPU pass not active");
           if(!gl.isProgram(draw.program)||!gl.isVertexArray(draw.vertexArray)||
             !Number.isSafeInteger(draw.count)||draw.count<0||
             !Number.isSafeInteger(draw.instances)||draw.instances<0||
             !Number.isSafeInteger(draw.firstIndex??0)||(draw.firstIndex??0)<0||
             draw.blend && (
               ![gl.ZERO,gl.ONE,gl.SRC_COLOR,gl.ONE_MINUS_SRC_COLOR,
                 gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.DST_ALPHA,
                 gl.ONE_MINUS_DST_ALPHA,gl.DST_COLOR,gl.ONE_MINUS_DST_COLOR,
                 gl.SRC_ALPHA_SATURATE,gl.CONSTANT_COLOR,
                 gl.ONE_MINUS_CONSTANT_COLOR,gl.CONSTANT_ALPHA,
                 gl.ONE_MINUS_CONSTANT_ALPHA].includes(draw.blend.source)||
               ![gl.ZERO,gl.ONE,gl.SRC_COLOR,gl.ONE_MINUS_SRC_COLOR,
                 gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.DST_ALPHA,
                 gl.ONE_MINUS_DST_ALPHA,gl.DST_COLOR,gl.ONE_MINUS_DST_COLOR,
                 gl.CONSTANT_COLOR,gl.ONE_MINUS_CONSTANT_COLOR,
                 gl.CONSTANT_ALPHA,gl.ONE_MINUS_CONSTANT_ALPHA].includes(draw.blend.destination)||
               draw.blend.constant && (
                 draw.blend.constant.length!==4||!finite(draw.blend.constant)||
                 draw.blend.constant.some(v=>v<0||v>1)
               )
             ))
             throw Error("Invalid native WebGL2 indexed draw submission");
           ops.push({type:"draw",draw:snapshotDraw(draw)});
         },
         executeBundles(bundles:readonly OriginalGlRenderBundle[]){
           active();if(!pass)throw Error("Original GPU pass not active");
           for(const bundle of bundles){
             if(!bundle||!Array.isArray(bundle.draws)||!Object.isFrozen(bundle.draws))
               throw Error("Original GPU render bundle is invalid/uncommitted");
             for(const draw of bundle.draws)this.drawIndexed(draw);
           }
         },
         scissor(rect:readonly [number,number,number,number]|null){
           active();if(!pass)throw Error("Native GPU pass not active");
           if(rect && (rect.length!==4||!rect.every(Number.isSafeInteger)||
             rect.some(v=>v<0)||rect[2]===0||rect[3]===0))
             throw Error("Original GL scissor invalid");
           ops.push({type:"scissor",rect:rect?
             Object.freeze([...rect] as [number,number,number,number]):null});
         },
         end(){active();if(!pass)throw Error("Original GPU render pass already ended");
           pass=false;ops.push({type:"end"});}
       };
     },
     beginComputePass():never{
       active();
       throw Error("Original WebGPU compute pass requires a real WebGL2 GPU/CPU algorithm port");
     },
     finish(){
       active();
       if(pass)throw Error("Original GPU render pass not ended");
       recording=false;
       const commands=ops.slice();
       return {
         generation,
         submit(){
           assert();
           if(done)throw Error("Original GL command buffer submitted twice");
           done=true;
           // All draw handles and framebuffer handles are checked before
           // issuing any commands. No partial frame if source ownership died.
           for(const op of commands){
             if(op.type==="draw"&&(!gl.isProgram(op.draw.program)||
                 !gl.isVertexArray(op.draw.vertexArray)))
               throw Error("Native GPU command refers to retired draw resource");
             if(op.type==="pass"&&op.options.framebuffer &&
                 !gl.isFramebuffer(op.options.framebuffer))
               throw Error("Original GPU pass references a retired framebuffer");
           }
           let current:OriginalGlPass|null=null,localDraws=0;
           try{
             for(const op of commands){
               if(op.type==="pass"){
                 current=op.options;
                 gl.bindFramebuffer(gl.FRAMEBUFFER,current.framebuffer??null);
                 gl.viewport(0,0,current.width,current.height);
                 gl.disable(gl.SCISSOR_TEST);
                 gl.depthMask(true);
                 let mask=0;
                 if(current.colorLoad==="clear"){
                   const c=current.clearColor??[0,0,0,1];
                   gl.clearColor(c[0],c[1],c[2],c[3]);mask|=gl.COLOR_BUFFER_BIT;
                 }
                 if(current.depthLoad==="clear"){
                   gl.clearDepth(current.clearDepth??1);mask|=gl.DEPTH_BUFFER_BIT;
                 }
                 if(mask)gl.clear(mask);
               }else if(op.type==="draw"){
                 const d=op.draw;
                 gl.useProgram(d.program);gl.bindVertexArray(d.vertexArray);
                 if(d.depthTest===false)gl.disable(gl.DEPTH_TEST);
                 else gl.enable(gl.DEPTH_TEST);
                 gl.depthFunc(gl.LEQUAL);
                 gl.depthMask(d.depthWrite!==false);
                 if(d.cull===false)gl.disable(gl.CULL_FACE);
                 else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}
                 if(d.blend){
                   gl.enable(gl.BLEND);
                   if(d.blend.constant)
                     gl.blendColor(...d.blend.constant);
                   gl.blendFunc(d.blend.source,d.blend.destination);
                 }else gl.disable(gl.BLEND);
                 if(d.count&&d.instances){
                   gl.drawElementsInstanced(gl.TRIANGLES,d.count,
                     gl.UNSIGNED_INT,(d.firstIndex??0)*4,d.instances);
                   localDraws++;
                 }
               }else if(op.type==="scissor"){
                 if(op.rect){
                   gl.enable(gl.SCISSOR_TEST);
                   gl.scissor(...op.rect);
                 }else gl.disable(gl.SCISSOR_TEST);
               }else if(op.type==="end"){
                 current=null;gl.bindVertexArray(null);
                 gl.disable(gl.SCISSOR_TEST);
               }
             }
             if(gl.getError()!==gl.NO_ERROR)
               throw Error("Original Silkroad WebGL2 command submission failed");
             drawCalls+=localDraws;submissions++;
             return {drawCalls:localDraws,submissions};
           }finally{
             gl.bindVertexArray(null);
             gl.disable(gl.SCISSOR_TEST);
             gl.depthMask(true);
             gl.bindFramebuffer(gl.FRAMEBUFFER,null);
           }
         }
       };
     }
   };
 }
 return {
   encoder,createRenderBundleEncoder,
   stats:()=>({submissions,drawCalls,commandIndex,disposed}),
   dispose(){disposed=true;}
 };
}
export type OriginalGlGpuCommands=ReturnType<typeof createOriginalGlGpuCommands>;
