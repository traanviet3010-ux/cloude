/*
 * Original SRO Geometry -> WebGL2 static mesh path.
 * Same Geometry, WorldMaterial and camera contracts as the GPU client.
 * No fake geometry, no substitute world coordinates, no client gameplay.
 * Advanced Silkroad material stages / bones intentionally fail closed.
 */
import type { Geometry } from "@/engine/contracts/geometry";
import {admitOriginalGeometry,type GlNativeGeometry} from "./native-geometry";
import {originalCameraToWebgl2} from "./clip-space";
import {OriginalWorldTextures} from "./original-world-textures";
import type {WorldTexture} from "@/engine/contracts/texture";
interface Slot { vao:WebGLVertexArrayObject;vbo:WebGLBuffer;ebo:WebGLBuffer;
  count:number;transform:Float32Array;color:Float32Array;alphaCutoff:number;bytes:number;last:number;texture:string;blend:boolean;doubleSided:boolean;depthWrite:boolean; }
const VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aColor;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec4 vColor;
out vec2 vUv;
void main(){gl_Position=uViewProjection*uModel*vec4(aPos,1.0);vColor=aColor;vUv=aUv;}`;
const FS=`#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vUv;
uniform vec4 uMaterialColor;
uniform sampler2D uTexture;
uniform int uUseTexture;
uniform float uCutoff;
out vec4 fragColor;
void main(){vec4 c=vColor*uMaterialColor;
 if(uUseTexture==1)c*=texture(uTexture,vUv);
 if(c.a<=uCutoff)discard;fragColor=c;}`;
function shader(gl:WebGL2RenderingContext,kind:number,source:string){
 const sh=gl.createShader(kind);if(!sh)throw Error("Cannot allocate native GL shader");
 gl.shaderSource(sh,source);gl.compileShader(sh);
 if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){
   const msg=gl.getShaderInfoLog(sh);gl.deleteShader(sh);throw Error("Native mesh shader: "+msg);
 }
 return sh;
}
export class OriginalWorldWebgl2 {
 private readonly gl:WebGL2RenderingContext;
 private readonly program:WebGLProgram;
 private readonly entries=new Map<string,Slot>();
 private readonly worldTextures:OriginalWorldTextures;
 private readonly white:WebGLTexture;
 private readonly budget:number;
 private used=0;
 private frame=0;
 private visible=new Set<string>();
 private disposed=false;
 private lost=false;
 private readonly lostHandler=(event:Event)=>{event.preventDefault();this.lost=true;};
 constructor(private readonly canvas:HTMLCanvasElement,memoryMB=160){
   const gl=canvas.getContext("webgl2",{antialias:false,alpha:false,depth:true,stencil:false});
   if(!gl)throw Error("Cannot create original Silkroad WebGL2 graphics context");
   this.gl=gl;this.budget=memoryMB*1048576;
   const vs=shader(gl,gl.VERTEX_SHADER,VS),fs=shader(gl,gl.FRAGMENT_SHADER,FS);
   const p=gl.createProgram();if(!p)throw Error("Cannot create original mesh program");
   gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
   gl.deleteShader(vs);gl.deleteShader(fs);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
     const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error("Native scene pipeline: "+e);
   }
   this.program=p;
   this.worldTextures=new OriginalWorldTextures(gl,/iPhone|iPad/.test(navigator.userAgent)?96:256);
   const white=gl.createTexture();
   if(!white)throw Error("Cannot allocate original untextured white fallback");
   this.white=white;
   gl.bindTexture(gl.TEXTURE_2D,white);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,
     new Uint8Array([255,255,255,255]));
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   canvas.addEventListener("webglcontextlost",this.lostHandler,false);
   canvas.addEventListener("webglcontextrestored",()=>{this.lost=true;},{once:true});
 }
 private validate(){
   if(this.disposed||this.lost)throw Error("Original SRO WebGL2 scene no longer available");
 }
 setTexture(path:string,image:WorldTexture|null){
   this.validate();
   const used=new Set<string>();
   for(const id of this.visible){
     const texture=this.entries.get(id)?.texture;
     if(texture)used.add(texture);
   }
   this.worldTextures.put(path,image,used);
 }
 hasTexture(path:string){this.validate();return this.worldTextures.has(path);}
 /**
  * Update native CPU-skinned vertices in the existing VBO. No reallocation
  * of VAO or GPU buffers on each original animation frame.
  */
 updateAnimatedGeometry(id:string,geometry:Geometry){
   this.validate();
   const slot=this.entries.get(id);
   if(!slot)throw Error("Native animated geometry not admitted: "+id);
   const source=admitOriginalGeometry(geometry);
   if(source.indices.length!==slot.count||source.byteSize!==slot.bytes)
     throw Error("Original animated mesh topology changed");
   if((geometry.material?.texture??"")!==slot.texture)
     throw Error("Original character material texture changed during animation");
   const gl=this.gl;
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.vbo);
   gl.bufferSubData(gl.ARRAY_BUFFER,0,source.vertices);
   if(gl.getError()!==gl.NO_ERROR)throw Error("Original animated Silkroad vertex update failed");
   slot.transform.set(source.transform);
   slot.last=this.frame;
 }
 private retire(id:string){
   const s=this.entries.get(id);if(!s)return;
   this.gl.deleteBuffer(s.vbo);this.gl.deleteBuffer(s.ebo);
   this.gl.deleteVertexArray(s.vao);this.used-=s.bytes;this.entries.delete(id);
 }
 set(id:string,geometry:Geometry|null){
   this.validate();
   if(!id||id.length>512)throw Error("Invalid original SRO geometry id");
   if(this.entries.has(id))this.retire(id);
   if(!geometry)return;
   // Exact original materials with unported lighting/textures must not appear as flat fallback.
   if(geometry.material && !geometry.material.unlit)
     throw Error("Original SRO object lighting is not ported; cannot replace it with debug material");
   const row:GlNativeGeometry=admitOriginalGeometry(geometry);
   if(row.byteSize>this.budget)throw Error("One original mesh exceeds GPU residency limit");
   for(const [key] of [...this.entries].sort((a,b)=>a[1].last-b[1].last)){
     if(this.used+row.byteSize<=this.budget)break;
     if(!this.visible.has(key))this.retire(key);
   }
   if(this.used+row.byteSize>this.budget)throw Error("Original visible meshes exceed GPU residency limit");
   const gl=this.gl;
   const vao=gl.createVertexArray(),vbo=gl.createBuffer(),ebo=gl.createBuffer();
   if(!vao||!vbo||!ebo)throw Error("Original WebGL2 mesh buffer allocation failed");
   try{
     gl.bindVertexArray(vao);
     gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
     gl.bufferData(gl.ARRAY_BUFFER,row.vertices,gl.STATIC_DRAW);
     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);
     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,row.indices,gl.STATIC_DRAW);
     for(const [attribute,size,offset] of [[0,3,0],[1,3,12],[2,2,24],[3,4,32]]){
       gl.enableVertexAttribArray(attribute!);
       gl.vertexAttribPointer(attribute!,size!,gl.FLOAT,false,48,offset!);
     }
     gl.bindVertexArray(null);
     if(gl.getError()!==gl.NO_ERROR)throw Error("WebGL2 native mesh buffer upload failed");
     this.entries.set(id,{vao,vbo,ebo,count:row.indices.length,transform:row.transform,
       color:new Float32Array(geometry.material?.color??[1,1,1,1]),alphaCutoff:geometry.material?.alphaCutoff??0,
       bytes:row.byteSize,last:this.frame,
       texture:geometry.material?.texture??"",
       blend:geometry.material?.blend??false,
       doubleSided:geometry.material?.doubleSided??false,
       depthWrite:geometry.material?.depthWrite??!geometry.material?.blend});
     this.used+=row.byteSize;
   }catch(e){gl.deleteVertexArray(vao);gl.deleteBuffer(vbo);gl.deleteBuffer(ebo);throw e;}
 }
 render(cameraMatrix:Float32Array,sceneIds:readonly string[]){
   this.validate();
   // Prevalidate entire frame; never silently draw a partial world.
   for(const id of sceneIds){
     const s=this.entries.get(id);
     if(!s)throw Error("Original world group not resident: "+id);
     if(s.texture&&!this.worldTextures.has(s.texture))
       throw Error("Original world material texture not resident: "+s.texture);
   }
   const camera=originalCameraToWebgl2(cameraMatrix);
   this.frame++;this.visible=new Set(sceneIds);this.worldTextures.frame();
   const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);
   gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
   gl.clearColor(0,0,0,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.useProgram(this.program);
   gl.uniform1i(gl.getUniformLocation(this.program,"uTexture"),0);
   gl.activeTexture(gl.TEXTURE0);
   gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uViewProjection"),false,camera);
   let triangles=0;
   for(const id of sceneIds){
     const s=this.entries.get(id)!;s.last=this.frame;
     gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uModel"),false,s.transform);
     gl.uniform4fv(gl.getUniformLocation(this.program,"uMaterialColor"),s.color);
     gl.uniform1f(gl.getUniformLocation(this.program,"uCutoff"),s.alphaCutoff);
     gl.uniform1i(gl.getUniformLocation(this.program,"uUseTexture"),s.texture?1:0);
     gl.bindTexture(gl.TEXTURE_2D,s.texture?this.worldTextures.get(s.texture):this.white);
     if(s.doubleSided)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}
     if(s.blend){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);}
     else gl.disable(gl.BLEND);
     gl.depthMask(s.depthWrite);
     gl.bindVertexArray(s.vao);
     gl.drawElements(gl.TRIANGLES,s.count,gl.UNSIGNED_INT,0);
     triangles+=s.count/3;
   }
   gl.bindVertexArray(null);gl.depthMask(true);gl.disable(gl.BLEND);
   if(gl.getError()!==gl.NO_ERROR)throw Error("Original World WebGL2 draw failed");
   return {triangleCount:triangles,geometryCount:sceneIds.length,residentMB:this.used/1048576};
 }
 glContext():WebGL2RenderingContext {this.validate();return this.gl;}
 dispose(){
   if(this.disposed)return;
   this.disposed=true;this.canvas.removeEventListener("webglcontextlost",this.lostHandler);
   for(const id of [...this.entries.keys()])this.retire(id);
   this.worldTextures.dispose();this.gl.deleteTexture(this.white);
   this.gl.deleteProgram(this.program);
 }
}
