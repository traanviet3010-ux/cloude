/*
 * The original HieuSRO UI (CIF, title, HUD, inventory, F10) supplies UiScene.
 * This WebGL2 draw layer consumes exactly that published scene.
 * It draws NO substitute panels, and never changes UI input or GameWorld state.
 */
import type { UiScene } from "@/engine/contracts/ui";
import type { NativeTexture } from "@/engine/contracts/texture";
import {nativeLevelBytes,unpackNativeTexture} from "./native-texture";
import { compileNativeUi } from "./native-ui-commands";
type Image = ImageBitmap | ImageData | NativeTexture;
interface Resident { texture:WebGLTexture;width:number;height:number;bytes:number;lastFrame:number; }
export type UiGpuStats={residentMB:number;textureCount:number;drawCalls:number;frame:number;missingQuads:number;evictions:number;failedUploads:number};
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aColor;
uniform vec2 uResolution;
out vec2 vUv;
out vec4 vColor;
out vec2 vPoint;
void main(){
  vec2 p=aPosition/uResolution;
  gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);
  vUv=aUv; vColor=aColor;vPoint=aPosition;
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vColor;
in vec2 vPoint;
uniform sampler2D uSampler;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform float uAlphaCutoff;
out vec4 fragColor;
void main(){
  vec4 c=texture(uSampler,vUv)*vColor;
  if(c.a<uAlphaCutoff)discard;
  vec2 maskUv=(vPoint-uMaskRect.xy)/uMaskRect.zw;
  fragColor=vec4(c.rgb,c.a*texture(uMask,maskUv).a);
}`;
function compile(gl:WebGL2RenderingContext,type:number,source:string):WebGLShader{
  const shader=gl.createShader(type);
  if(!shader)throw Error("WebGL2 cannot allocate UI shader");
  gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const err=gl.getShaderInfoLog(shader);gl.deleteShader(shader);
    throw Error("Native UI shader compilation failed: "+err);
  }
  return shader;
}
export class NativeUiWebgl2Renderer {
  private readonly gl:WebGL2RenderingContext;
  private readonly program:WebGLProgram;
  private readonly vao:WebGLVertexArrayObject;
  private readonly buffer:WebGLBuffer;
  private readonly placeholder:WebGLTexture;
  private readonly textures=new Map<string,Resident>();
  private used=0;
  private pinned=new Set<string>();
  private nextSceneTextures=new Set<string>();
  private frameNo=0;
  private calls=0;
  private missingQuads=0;
  private evictions=0;
  private failedUploads=0;
  private closed=false;
  private readonly budgetBytes:number;
  private readonly onLost=(event:Event)=>{event.preventDefault();this.lost=true;};
  private readonly onRestored=()=>{this.lost=true;};
  private lost=false;
  constructor(private readonly canvas:HTMLCanvasElement, budgetMB?:number, sharedGl?:WebGL2RenderingContext) {
    const gl=sharedGl??canvas.getContext("webgl2",{alpha:true,antialias:false,stencil:false,
      depth:false,preserveDrawingBuffer:false,premultipliedAlpha:false});
    if(!gl)throw Error("Original HieuSRO UI requires WebGL2");
    this.gl=gl;
    this.budgetBytes=Math.floor((budgetMB??(/iPhone|iPad/.test(navigator.userAgent)?96:256))*1024*1024);
    if(this.budgetBytes<4*1024*1024)throw Error("Native UI GPU memory budget too small");
    const vs=compile(gl,gl.VERTEX_SHADER,VERTEX),fs=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
    const program=gl.createProgram();
    if(!program){gl.deleteShader(vs);gl.deleteShader(fs);throw Error("WebGL2 UI program allocation failed");}
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
      const reason=gl.getProgramInfoLog(program);gl.deleteProgram(program);
      throw Error("Original UI WebGL2 shader link failed: "+reason);
    }
    const vao=gl.createVertexArray(),buffer=gl.createBuffer();
    if(!vao||!buffer){gl.deleteProgram(program);throw Error("WebGL2 UI vertex allocation failed");}
    this.program=program;this.vao=vao;this.buffer=buffer;
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,48*4,gl.DYNAMIC_DRAW); // 6 * (2+2+4) floats
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,32,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,32,8);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,16);
    gl.bindVertexArray(null);
    const white=gl.createTexture();
    if(!white)throw Error("WebGL2 UI placeholder allocation failed");
    this.placeholder=white;
    gl.bindTexture(gl.TEXTURE_2D,white);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    canvas.addEventListener("webglcontextlost",this.onLost,false);
    canvas.addEventListener("webglcontextrestored",this.onRestored);
  }
  /** Pin authentic images as soon as ORIGINAL createUi() publishes a scene,
   * BEFORE asynchronous native texture uploads have finished. The current
   * last-drawn frame remains pinned independently until it is replaced.
   * Read-only walk: avoid compiling thousands of glyph vertices twice/frame.
   */
  protectUiScene(scene:UiScene|null){
    if(this.closed||this.lost)throw Error("Native UI WebGL2 renderer is closed/lost");
    const required=new Set<string>();
    if(scene)for(const quad of scene.quads){
      if(quad.rect[2]<=0||quad.rect[3]<=0||
         quad.clip[2]<=0||quad.clip[3]<=0)continue;
      if(quad.texture)required.add(quad.texture);
      if(quad.mask?.texture)required.add(quad.mask.texture);
    }
    this.nextSceneTextures=required;
  }
  /** UI/CIF artwork comes only from the original OpenSRO asset owner.
   * Publish new GPU texels atomically, like the native world texture pool.
   * An OOM, corrupt original mip or protected-HUD budget failure must not
   * destroy the old visible Silkroad login/skill/inventory artwork.
   */
  setTexture(id:string,image:Image|null){
    if(this.closed||this.lost)throw Error("Native UI WebGL2 renderer is closed/lost");
    if(!id)throw Error("Native UI texture key missing");
    const gl=this.gl;
    const prior=this.textures.get(id);
    if(!image){
      if(prior){gl.deleteTexture(prior.texture);this.used-=prior.bytes;this.textures.delete(id);}
      return;
    }
    const width=image.width,height=image.height;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||
       width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE)){
      this.failedUploads++;
      throw Error("Native UI texture dimensions unsupported");
    }
    const native="kind" in image&&image.kind==="native-texture";
    const rawLevel=native?image.levels[0]:undefined;
    const expected=native?nativeLevelBytes(image.format,width,height):0;
    if(native&&(!rawLevel||rawLevel.byteLength!==expected)){
      this.failedUploads++;
      throw Error("Original native UI mip is truncated");
    }
    const s3tc=native&&image.format!=="bgra8unorm"?
      gl.getExtension("WEBGL_compressed_texture_s3tc"):null;
    const compressed=!!s3tc;
    const bytes=compressed?expected:width*height*4;
    if(bytes>this.budgetBytes){
      this.failedUploads++;
      throw Error("Native UI single texture exceeds GPU budget");
    }
    // Plan the final-state residency, counting a replacement only once.
    // Never evict current-frame CIF masks or quads *before* GL success.
    let projected=this.used-(prior?.bytes??0)+bytes;
    const victims:Array<readonly [string,Resident]>=[];
    for(const [key,slot] of [...this.textures].sort((a,b)=>a[1].lastFrame-b[1].lastFrame)){
      if(projected<=this.budgetBytes)break;
      if(key===id||this.pinned.has(key)||this.nextSceneTextures.has(key))continue;
      projected-=slot.bytes;victims.push([key,slot]);
    }
    if(projected>this.budgetBytes){
      this.failedUploads++;
      throw Error("Native UI memory pressure: cannot evict currently protected textures");
    }
    const tex=gl.createTexture();
    if(!tex){
      this.failedUploads++;
      throw Error("GPU has no memory for native UI texture");
    }
    try{
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      if(native){
        if(compressed&&s3tc){
          const format=image.format==="bc1-rgba-unorm"?
            s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT:
            image.format==="bc2-rgba-unorm"?s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT:
              s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT;
          gl.compressedTexImage2D(gl.TEXTURE_2D,0,format,width,height,0,rawLevel!);
        }else{
          const rgba=unpackNativeTexture(image);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,
            gl.RGBA,gl.UNSIGNED_BYTE,rgba.pixels);
        }
      }else if(image instanceof ImageBitmap || image instanceof ImageData){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      }else throw Error("Unknown native Silkroad UI texture type");
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      if(gl.getError()!==gl.NO_ERROR)throw Error("Native UI texture upload failed");
      // This is the ONLY destructive section; all prior GPU state remains
      // intact if a real Safari/WebGL2 allocation failed.
      for(const [key,slot] of victims){
        gl.deleteTexture(slot.texture);this.textures.delete(key);
        this.used-=slot.bytes;this.evictions++;
      }
      if(prior){gl.deleteTexture(prior.texture);this.textures.delete(id);this.used-=prior.bytes;}
      this.textures.set(id,{texture:tex,width,height,bytes,lastFrame:this.frameNo});
      this.used+=bytes;
    }catch(error){gl.deleteTexture(tex);this.failedUploads++;throw error;}
  }
  draw(scene:UiScene, clearBackground=true){
    if(this.closed||this.lost)throw Error("Native UI renderer unavailable; must be rebuilt after context loss");
    // Validate whole frame *before* changing GPU state: no partial/misleading UI frame.
    const commands=compileNativeUi(scene);
    // The pinned GPU renderer's device/ui.ts skips only quads whose
    // original texture/mask hasn't arrived yet. It NEVER paints substitute
    // white art and NEVER blanks the whole title screen during asset loading.
    const resident=commands.filter(c=>
      (!c.texture||this.textures.has(c.texture))&&
      (!c.maskTexture||this.textures.has(c.maskTexture)));
    const required=new Set(resident.flatMap(c=>
      [c.texture,...(c.maskTexture?[c.maskTexture]:[])].filter(Boolean)));
    this.missingQuads=commands.length-resident.length;
    this.frameNo++;this.calls=0;this.pinned=required;
    for(const id of required)this.textures.get(id)!.lastFrame=this.frameNo;
    const gl=this.gl;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
    // Pinned original OpenSRO device/ui.ts uses different RGBA blend
    // factors: color=(SRC_ALPHA,ONE_MINUS_SRC_ALPHA), alpha=(ONE,
    // ONE_MINUS_SRC_ALPHA). Using blendFunc for both channels would square
    // semi-transparent inventory/tooltips alpha and flatten original CIF.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program,"uResolution"),scene.width,scene.height);
    gl.uniform1i(gl.getUniformLocation(this.program,"uSampler"),0);
    gl.uniform1i(gl.getUniformLocation(this.program,"uMask"),1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    if(clearBackground){
      gl.scissor(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const sx=this.canvas.width/scene.width,sy=this.canvas.height/scene.height;
    for(const cmd of resident){
      const [x,y,w,h]=cmd.clip;
      const left=Math.max(0,Math.floor(x*sx)),bottom=Math.max(0,Math.floor(this.canvas.height-(y+h)*sy));
      const right=Math.min(this.canvas.width,Math.ceil((x+w)*sx)),
        top=Math.min(this.canvas.height,Math.ceil(this.canvas.height-y*sy));
      if(right<=left||top<=bottom)continue;
      gl.scissor(left,bottom,right-left,top-bottom);
      const t=cmd.texture?this.textures.get(cmd.texture)!.texture:this.placeholder;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,t);
      const min=cmd.sampling==="nearest"?gl.NEAREST:gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,min);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,min);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D,cmd.maskTexture?
        this.textures.get(cmd.maskTexture)!.texture:this.placeholder);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,min);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,min);
      gl.uniform4fv(gl.getUniformLocation(this.program,"uMaskRect"),cmd.maskRect);
      gl.uniform1f(gl.getUniformLocation(this.program,"uAlphaCutoff"),cmd.alphaCutoff);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,cmd.vertexData);
      gl.drawArrays(gl.TRIANGLES,0,6);this.calls++;
    }
    gl.bindVertexArray(null);gl.disable(gl.SCISSOR_TEST);
    if(gl.getError()!==gl.NO_ERROR)throw Error("OpenSRO WebGL2 native UI frame failed");
  }
  stats():UiGpuStats{return {residentMB:this.used/1048576,textureCount:this.textures.size,
    drawCalls:this.calls,frame:this.frameNo,missingQuads:this.missingQuads,
    evictions:this.evictions,failedUploads:this.failedUploads};}
  dispose(){
    if(this.closed)return;
    this.closed=true;this.canvas.removeEventListener("webglcontextlost",this.onLost);
    this.canvas.removeEventListener("webglcontextrestored",this.onRestored);
    const gl=this.gl;
    for(const entry of this.textures.values())gl.deleteTexture(entry.texture);
    this.textures.clear();this.pinned.clear();this.nextSceneTextures.clear();this.used=0;
    gl.deleteTexture(this.placeholder);gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);
  }
}
