/*
 * Original SRO Geometry -> WebGL2 static mesh path.
 * Same Geometry, WorldMaterial and camera contracts as the GPU client.
 * No fake geometry, no substitute world coordinates, no client gameplay.
 * Advanced Silkroad material stages / bones intentionally fail closed.
 */
import type { Geometry } from "@/engine/contracts/geometry";
import {admitOriginalGeometry,type GlNativeGeometry} from "./native-geometry";
import {originalCameraToWebgl2} from "./clip-space";
interface Slot { vao:WebGLVertexArrayObject;vbo:WebGLBuffer;ebo:WebGLBuffer;
  count:number;transform:Float32Array;color:Float32Array;alphaCutoff:number;bytes:number;last:number; }
const VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aColor;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec4 vColor;
void main(){gl_Position=uViewProjection*uModel*vec4(aPos,1.0);vColor=aColor;}`;
const FS=`#version 300 es
precision mediump float;
in vec4 vColor;
uniform vec4 uMaterialColor;
uniform float uCutoff;
out vec4 fragColor;
void main(){vec4 c=vColor*uMaterialColor;if(c.a<=uCutoff)discard;fragColor=c;}`;
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
   canvas.addEventListener("webglcontextlost",this.lostHandler,false);
   canvas.addEventListener("webglcontextrestored",()=>{this.lost=true;},{once:true});
 }
 private validate(){
   if(this.disposed||this.lost)throw Error("Original SRO WebGL2 scene no longer available");
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
       bytes:row.byteSize,last:this.frame});
     this.used+=row.byteSize;
   }catch(e){gl.deleteVertexArray(vao);gl.deleteBuffer(vbo);gl.deleteBuffer(ebo);throw e;}
 }
 render(cameraMatrix:Float32Array,sceneIds:readonly string[]){
   this.validate();
   // Prevalidate entire frame; never silently draw a partial world.
   for(const id of sceneIds)if(!this.entries.has(id))throw Error("Original world group not resident: "+id);
   const camera=originalCameraToWebgl2(cameraMatrix);
   this.frame++;this.visible=new Set(sceneIds);
   const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);
   gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
   gl.clearColor(0,0,0,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.useProgram(this.program);
   gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uViewProjection"),false,camera);
   let triangles=0;
   for(const id of sceneIds){
     const s=this.entries.get(id)!;s.last=this.frame;
     gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uModel"),false,s.transform);
     gl.uniform4fv(gl.getUniformLocation(this.program,"uMaterialColor"),s.color);
     gl.uniform1f(gl.getUniformLocation(this.program,"uCutoff"),s.alphaCutoff);
     gl.bindVertexArray(s.vao);
     gl.drawElements(gl.TRIANGLES,s.count,gl.UNSIGNED_INT,0);
     triangles+=s.count/3;
   }
   gl.bindVertexArray(null);
   if(gl.getError()!==gl.NO_ERROR)throw Error("Original World WebGL2 draw failed");
   return {triangleCount:triangles,geometryCount:sceneIds.length,residentMB:this.used/1048576};
 }
 glContext():WebGL2RenderingContext {this.validate();return this.gl;}
 dispose(){
   if(this.disposed)return;
   this.disposed=true;this.canvas.removeEventListener("webglcontextlost",this.lostHandler);
   for(const id of [...this.entries.keys()])this.retire(id);
   this.gl.deleteProgram(this.program);
 }
}
