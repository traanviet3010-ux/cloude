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
import {readOriginalGlLighting,type OriginalGlLighting} from "./original-lighting";
import {originalBlendPair} from "./original-blend-webgl2";
import {createOriginalAtmosphereWebgl2} from "./original-atmosphere-webgl2";
import type {BlendPair} from "@/engine/foundation/rendering/blend-state";
interface Slot { vao:WebGLVertexArrayObject;vbo:WebGLBuffer;ebo:WebGLBuffer;instanceVbo:WebGLBuffer;opacityVbo:WebGLBuffer;instances:number;capacity:number;sourceByteSize:number;
  count:number;vertexCount:number;indexCapacity:number;transform:Float32Array;color:Float32Array;alphaCutoff:number;alphaCompare:number;bytes:number;last:number;texture:string;blend:boolean;blendPair?:BlendPair;doubleSided:boolean;depthWrite:boolean;lightmap:boolean;sky:number;fogDisabled:boolean;localFog:readonly [number,number,number,number,number]|null;stageFactor:number;objectFade:boolean;fadeAlphaOnly:boolean;surfaceAlpha:boolean;lit:boolean;ambient:Float32Array;ambientScale:number;objectVertexLighting:boolean; }
const VS=`#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aColor;
layout(location=4) in mat4 aInstanceModel;
layout(location=8) in float aInstanceOpacity;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec4 vColor;
out vec2 vUv;
out vec3 vNormal;
out vec3 vVertexLighting;
out vec3 vSkyColor;
out float vViewZ;
flat out float vInstanceOpacity;
uniform vec3 uDiffuse;
uniform vec3 uAmbient;
uniform vec3 uAmbientFactor;
uniform vec3 uLightDirection;
uniform vec3 uMaterialDiffuse;
uniform float uAmbientScale;
uniform int uSkyKind;
uniform vec3 uSkyForward;
uniform vec3 uSkyRight;
uniform vec3 uSkyUp;
uniform vec4 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec4 uSkyScatter;
uniform vec4 uSkySun;
uniform vec3 uSkyFog;
uniform float uSkyTime;
uniform float uSkyCloudScroll;
void main(){
 mat4 instance=uModel*aInstanceModel;
 gl_Position=uViewProjection*instance*vec4(aPos,1.0);
 vViewZ=gl_Position.w;
 vColor=aColor;vUv=aUv;vInstanceOpacity=aInstanceOpacity;
 vSkyColor=vec3(0.0);
 if(uSkyKind==1||uSkyKind==3||uSkyKind==5||uSkyKind==6){
   // OpenSRO sky geometry has observer-relative world coordinates.
   vec3 skyPosition=aPos;
   float angle=(uSkyTime-0.25)*6.28318530718;
   if(uSkyKind==3){
     vec3 center=vec3(cos(angle),sin(angle),0.0)*20000.0;
     skyPosition=center+vec3(-aPos.y*sin(angle),
       aPos.y*cos(angle),aPos.z)*666.666687;
   }
   float z=dot(skyPosition,uSkyForward);
   gl_Position=vec4(dot(skyPosition,uSkyRight)/dot(uSkyRight,uSkyRight),
     dot(skyPosition,uSkyUp)/dot(uSkyUp,uSkyUp),z,z);
   vViewZ=z;
   if(uSkyKind==5)vUv=aUv+vec2(uSkyCloudScroll);
   if(uSkyKind==1){
     vec3 sunPosition=vec3(cos(angle),sin(angle),0.0)*20000.0;
     vec3 base=mix(uSkyHorizon,uSkyZenith.rgb,
       clamp(aPos.y/5000.0*uSkySun.w,0.0,1.0));
     vSkyColor=mix(uSkyScatter.rgb,base,
       min(1.0,distance(aPos,sunPosition)/max(0.00001,uSkyScatter.w)));
   }else vSkyColor=uSkyFog;
 }
 // Matches OpenSRO's inverse-transpose world normal and retained vertex
 // object-light calculation, not a new lighting preset.
 vNormal=transpose(inverse(mat3(instance)))*aNormal;
 vVertexLighting=clamp(uMaterialDiffuse*uDiffuse*
   max(0.0,dot(vNormal,uLightDirection))+
   uAmbient*uAmbientFactor*uAmbientScale,0.0,1.0);
}`;
const FS=`#version 300 es
precision highp float;
precision highp int;
in vec4 vColor;
in vec2 vUv;
in vec3 vNormal;
in vec3 vVertexLighting;
in vec3 vSkyColor;
in float vViewZ;
flat in float vInstanceOpacity;
uniform vec4 uMaterialColor;
uniform vec3 uDiffuse;
uniform vec3 uAmbient;
uniform vec3 uAmbientFactor;
uniform vec3 uLightDirection;
uniform float uAmbientScale;
uniform int uLit;
uniform int uObjectVertexLighting;
uniform sampler2D uTexture;
uniform int uUseTexture;
uniform float uCutoff;
uniform int uAlphaCompare;
uniform int uObjectFade;
uniform int uFadeAlphaOnly;
uniform int uSurfaceAlpha;
uniform float uStageFactor;
uniform int uLightmap;
uniform int uSkyKind;
uniform vec4 uSkySun;
uniform vec3 uSkyFog;
uniform vec4 uSkyScatter;
uniform float uSkyTime;
uniform float uSkyCloudAlpha;
uniform vec3 uLightmapShadow;
uniform int uLightmapFogEnabled;
uniform vec3 uLightmapFogColor;
uniform float uLightmapFogStart;
uniform float uLightmapFogEnd;
uniform int uWorldFogEnabled;
uniform vec3 uWorldFogColor;
uniform float uWorldFogStart;
uniform float uWorldFogEnd;
out vec4 fragColor;
bool originalAlphaAccept(float pixelAlpha,float reference){
 // Exact pinned GPU shader D3D9 HAL quantization: truncate alpha to
 // 12 fractional bits and nearest UNORM8 with half-way ties DOWN.
 // Material reference is D3DRS_ALPHAREF rounded to an 8-bit integer.
 // 1 NEVER, 2 LESS, 3 EQUAL, 4 LESSEQUAL, 5 GREATER,
 // 6 NOTEQUAL, 7 GREATEREQUAL (retail default), 8 ALWAYS.
 int a=int(ceil(floor(clamp(pixelAlpha,0.0,1.0)*4096.0)*
   (255.0/4096.0)-0.5));
 int b=int(round(clamp(reference,0.0,1.0)*255.0));
 if(uAlphaCompare==1)return false;
 if(uAlphaCompare==2)return a<b;
 if(uAlphaCompare==3)return a==b;
 if(uAlphaCompare==4)return a<=b;
 if(uAlphaCompare==5)return a>b;
 if(uAlphaCompare==6)return a!=b;
 if(uAlphaCompare==7)return a>=b;
 return true;
}
void main(){
 if(uSkyKind==1){fragColor=vec4(vSkyColor,1.0);return;}
 if(uSkyKind==6){fragColor=vec4(vSkyColor,vColor.a);return;}
 if(uSkyKind==3){
   vec4 sunTexel=texture(uTexture,vUv);
   bool daytime=uSkyTime>=0.25&&uSkyTime<=0.875;
   fragColor=vec4(clamp(uSkySun.rgb,0.0,1.0),sunTexel.a*(daytime?1.0:0.0));
   return;
 }
 if(uSkyKind==5){
   vec4 cloudTexel=texture(uTexture,vUv);
   vec3 cloudColor=mix(clamp(uSkyScatter.rgb,0.0,1.0)*cloudTexel.rgb,
     uSkyFog,clamp((vViewZ-90000.0)/110000.0,0.0,1.0));
   fragColor=vec4(cloudColor,cloudTexel.a*clamp(uSkyCloudAlpha,0.0,1.0));
   return;
 }
 vec4 texel=uUseTexture==1?texture(uTexture,vUv):vec4(1.0);
 // Pinned OpenSRO geometry shader: baked lightmap branch produces
 // clamp(light.rgb + env.shadow.rgb). The pipeline then multiplies the
 // already drawn terrain using D3DBLEND ZERO/SRCCOLOR.
 // Its separate fog and cascade passes are not enabled in this GL path.
 if(uLightmap==1){
   vec3 baked=clamp(texel.rgb+uLightmapShadow,0.0,1.0);
   // Original OpenSRO D3DFOG_LINEAR for lightmap groups:
   // fogStart=env.fog.w, fogEnd=env.settings.x,
   // target=env.terrainFog.rgb. Experimental height fog/sun shadows
   // remain separately gated until their native passes are ported.
   float fog=uLightmapFogEnabled==1?
     clamp((vViewZ-uLightmapFogStart)/max(0.001,uLightmapFogEnd-uLightmapFogStart),0.0,1.0):0.0;
   fragColor=vec4(mix(baked,uLightmapFogColor,fog),1.0);
   return;
 }
 vec4 c;
 if(uLit==1){
   vec3 lit=uObjectVertexLighting==1?vVertexLighting:
     clamp(uMaterialColor.rgb*uDiffuse*
       max(0.0,dot(normalize(vNormal),uLightDirection))+
       uAmbient*uAmbientFactor*uAmbientScale,0.0,1.0);
   // Native stage-off lit mode multiplies texel and vertex color by
   // saturated world illumination; material diffuse is inside lit.
   c=vec4(texel.rgb*vColor.rgb*lit,
     texel.a*vColor.a*uMaterialColor.a);
 }else c=texel*vColor*uMaterialColor;
 bool fading=(uObjectFade==1 && vInstanceOpacity<1.0);
 // The original 2007 retail fade is a per-placement opacity, not a
 // replacement texture. Use pinned GPU pipeline's cutoff contraction.
 float fadeAlpha=(uFadeAlphaOnly==1?1.0:texel.a)*vInstanceOpacity;
 float alphaRef=fading?floor(uCutoff*255.0*round(vInstanceOpacity*255.0)/256.0)/255.0:uCutoff;
 if(!originalAlphaAccept(fading?fadeAlpha:c.a,alphaRef))discard;
 float outAlpha=uObjectFade==1?
   (fading?fadeAlpha:(uSurfaceAlpha==1?c.a:1.0)):c.a;
 vec3 shaded=clamp(c.rgb*uStageFactor,vec3(0.0),vec3(1.0));
 if(uWorldFogEnabled==1){
   float f=clamp((vViewZ-uWorldFogStart)/
     max(0.001,uWorldFogEnd-uWorldFogStart),0.0,1.0);
   shaded=mix(shaded,uWorldFogColor,f);
 }
 fragColor=vec4(shaded,outAlpha);
}`;
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
 private lighting:OriginalGlLighting|null=null;
 private atmosphere:ReturnType<typeof createOriginalAtmosphereWebgl2>;
 private skyPacked:Float32Array|null=null;
 private environmentPacked:Float32Array|null=null;
 private readonly budget:number;
 private used=0;
 private frame=0;
 private visible=new Set<string>();
 private pendingTextures=new Set<string>();
 private readonly protectedStageGroups=new Set<string>();
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
   this.atmosphere=createOriginalAtmosphereWebgl2(gl);
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
   // A frustum-culled old stage mesh still needs its authored material
   // texture until the authentic next scene has fully committed.
   for(const id of this.protectedStageGroups){
     const texture=this.entries.get(id)?.texture;
     if(texture)used.add(texture);
   }
   for(const key of this.pendingTextures)used.add(key);
   this.worldTextures.put(path,image,used);
 }
 /** Pin ALL native assets of an admitting title/character stage, or fail
     explicitly instead of evicting the first texture while loading the last. */
 protectPendingTextures(paths:readonly string[]){
   this.validate();
   this.pendingTextures=new Set(paths);
 }
 /** Preserve the genuine scene's GPU buffers even when temporarily culled.
  * A staged admission must fail, not silently evict a still-owned old scene.
  */
 protectStageGroups(ids:readonly string[]){
   this.validate();
   this.protectedStageGroups.clear();
   for(const id of ids)this.protectedStageGroups.add(id);
 }
 protectStageGroup(id:string){
   this.validate();
   if(!this.entries.has(id))throw Error("Cannot protect an unadmitted native group: "+id);
   this.protectedStageGroups.add(id);
 }
 hasTexture(path:string){this.validate();return this.worldTextures.has(path);}
 /** The ORIGINAL worldEnvironment() packed Float32Array; never sample fabricated palette. */
 setOriginalLighting(packed:Float32Array,useNativeSun=false,drawAtmosphere=false){
   this.validate();
   this.lighting=readOriginalGlLighting(packed,useNativeSun);
   this.environmentPacked=packed.slice();
   // Atmosphere uses the actual retail packed zenith/horizon/camera basis.
   // No fake cloud/stars are injected, and empty scenes remain black.
   this.skyPacked=drawAtmosphere?packed.slice():null;
 }
 /**
  * Update native CPU-skinned vertices in the existing VBO. No reallocation
  * of VAO or GPU buffers on each original animation frame.
  */
 updateAnimatedGeometry(id:string,geometry:Geometry){
   this.validate();
   const slot=this.entries.get(id);
   if(!slot)throw Error("Native animated geometry not admitted: "+id);
   const source=admitOriginalGeometry(geometry);
   if(source.indices.length!==slot.count||source.instanceCount!==slot.capacity||
     source.byteSize!==slot.sourceByteSize)
     throw Error("Original animated mesh topology changed");
   if((geometry.material?.texture??"")!==slot.texture)
     throw Error("Original character material texture changed during animation");
   const gl=this.gl;
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.vbo);
   gl.bufferSubData(gl.ARRAY_BUFFER,0,source.vertices);
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.instanceVbo);
   gl.bufferSubData(gl.ARRAY_BUFFER,0,source.instances);
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.opacityVbo);
   gl.bufferSubData(gl.ARRAY_BUFFER,0,new Float32Array(slot.capacity).fill(1));
   slot.instances=slot.capacity;
   if(gl.getError()!==gl.NO_ERROR)throw Error("Original animated Silkroad vertex update failed");
   slot.transform.set(source.transform);
   slot.last=this.frame;
 }
 /**
  * Update the original GPU renderer's resident placement matrices/opacity
  * without replacing any authored mesh, texture, or GL allocation.
  * The data comes directly from native residentSlots/ObjectFades.
  */
 updateOriginalInstances(id:string,matrices:Float32Array,opacity:Float32Array){
   this.validate();
   const slot=this.entries.get(id);
   if(!slot)throw Error("Unknown original native instance group: "+id);
   const count=matrices.length/16;
   if(!Number.isInteger(count)||count>slot.capacity||
     opacity.length!==count||!matrices.every(Number.isFinite)||
     !opacity.every(v=>Number.isFinite(v)&&v>=0&&v<=1))
     throw Error("Original SRO selected instances/opacity invalid");
   const gl=this.gl;
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.instanceVbo);
   if(matrices.length)gl.bufferSubData(gl.ARRAY_BUFFER,0,matrices);
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.opacityVbo);
   if(opacity.length)gl.bufferSubData(gl.ARRAY_BUFFER,0,opacity);
   if(gl.getError()!==gl.NO_ERROR)
     throw Error("Original selected instance upload failed");
   slot.instances=count;
   slot.last=this.frame;
 }
 /** Update original terrain LOD without recreating the VAO or authored mesh.
  * Selects indices/heights from original Geometry and WorldGroup.ranges.
  * Unselected terrain cells draw zero indices, never substitute terrain.
  */
 updateOriginalTerrain(id:string,geometry:Geometry){
   this.validate();
   const slot=this.entries.get(id);
   if(!slot)throw Error("Original terrain GPU mesh not admitted: "+id);
   if(!geometry.material?.terrain)
     throw Error("Cannot update native terrain from nonterrain material");
   if(geometry.indices.length===0){slot.count=0;return;}
   const row=admitOriginalGeometry(geometry);
   if(row.vertexCount!==slot.vertexCount||row.instanceCount!==slot.capacity)
     throw Error("Original Silkroad terrain topology/instances changed");
   if((geometry.material.texture??"")!==slot.texture)
     throw Error("Original Silkroad terrain texture changed during LOD");
   const gl=this.gl;
   gl.bindBuffer(gl.ARRAY_BUFFER,slot.vbo);
   gl.bufferSubData(gl.ARRAY_BUFFER,0,row.vertices);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,slot.ebo);
   if(row.indices.length>slot.indexCapacity){
     const additional=(row.indices.length-slot.indexCapacity)*4;
     if(this.used+additional>this.budget)
       throw Error("Original terrain LOD needs more GPU index memory");
     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,row.indices,gl.DYNAMIC_DRAW);
     if(gl.getError()!==gl.NO_ERROR)
       throw Error("Original terrain GPU index resize failed");
     slot.indexCapacity=row.indices.length;slot.bytes+=additional;
     this.used+=additional;
   }else{
     gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER,0,row.indices);
   }
   if(gl.getError()!==gl.NO_ERROR)
     throw Error("Original terrain GPU LOD upload failed");
   slot.count=row.indices.length;
   slot.last=this.frame;
 }
 private retire(id:string){
   const s=this.entries.get(id);if(!s)return;
   this.gl.deleteBuffer(s.vbo);this.gl.deleteBuffer(s.ebo);
   this.gl.deleteBuffer(s.instanceVbo);this.gl.deleteBuffer(s.opacityVbo);
   this.gl.deleteVertexArray(s.vao);this.used-=s.bytes;this.entries.delete(id);
 }
 set(id:string,geometry:Geometry|null){
   this.validate();
   if(!id||id.length>512)throw Error("Invalid original SRO geometry id");
   if(this.entries.has(id))this.retire(id);
   if(!geometry)return;
   const material=geometry.material;
   const lit=material?.unlit===false;
   if(lit){
     if(!geometry.normals||geometry.normals.length!==geometry.positions.length)
       throw Error("Original lit Silkroad geometry missing normals");
     if(material?.objectLight!==undefined &&
       (!Number.isFinite(material.objectLight)||material.objectLight<0))
       throw Error("Original object-light ambient scalar invalid");
     const mat=geometry.transform;
     const a0=mat[0]!,a1=mat[1]!,a2=mat[2]!,
       b0=mat[4]!,b1=mat[5]!,b2=mat[6]!,
       c0=mat[8]!,c1=mat[9]!,c2=mat[10]!;
     const det=a0*(b1*c2-b2*c1)-b0*(a1*c2-a2*c1)+c0*(a1*b2-a2*b1);
     if(!Number.isFinite(det)||Math.abs(det)<1e-8)
       throw Error("Original lit Silkroad normal transform singular");
   }
   if(material?.ambient &&
       (material.ambient.length!==3||material.ambient.some(v=>!Number.isFinite(v)||v<0||v>1)))
     throw Error("Invalid native ambient material color");
   const row:GlNativeGeometry=admitOriginalGeometry(geometry);
   const accounted=row.byteSize+row.instanceCount*4;
   if(accounted>this.budget)throw Error("One original mesh exceeds GPU residency limit");
   for(const [key] of [...this.entries].sort((a,b)=>a[1].last-b[1].last)){
     if(this.used+accounted<=this.budget)break;
     if(!this.visible.has(key)&&!this.protectedStageGroups.has(key))this.retire(key);
   }
   if(this.used+accounted>this.budget)throw Error("Original visible meshes exceed GPU residency limit");
   const gl=this.gl;
   const vao=gl.createVertexArray(),vbo=gl.createBuffer(),ebo=gl.createBuffer(),
     instanceVbo=gl.createBuffer(),opacityVbo=gl.createBuffer();
   if(!vao||!vbo||!ebo||!instanceVbo||!opacityVbo){
     if(vao)gl.deleteVertexArray(vao);
     if(vbo)gl.deleteBuffer(vbo);
     if(ebo)gl.deleteBuffer(ebo);
     if(instanceVbo)gl.deleteBuffer(instanceVbo);
     if(opacityVbo)gl.deleteBuffer(opacityVbo);
     throw Error("Original WebGL2 mesh buffer allocation failed");
   }
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
     // Native OpenSRO world decoder owns a column-major per-instance
     // mapPlacement matrix. GLSL ES 3.00 mat4 occupies four vec4 lanes;
     // divisor=1 changes exactly once per original scenery placement.
     gl.bindBuffer(gl.ARRAY_BUFFER,instanceVbo);
     gl.bufferData(gl.ARRAY_BUFFER,row.instances,gl.STATIC_DRAW);
     for(let column=0;column<4;column++){
       const loc=4+column;
       gl.enableVertexAttribArray(loc);
       gl.vertexAttribPointer(loc,4,gl.FLOAT,false,64,column*16);
       gl.vertexAttribDivisor(loc,1);
     }
     gl.bindBuffer(gl.ARRAY_BUFFER,opacityVbo);
     gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(row.instanceCount).fill(1),gl.DYNAMIC_DRAW);
     gl.enableVertexAttribArray(8);
     gl.vertexAttribPointer(8,1,gl.FLOAT,false,4,0);
     gl.vertexAttribDivisor(8,1);
     gl.bindVertexArray(null);
     if(gl.getError()!==gl.NO_ERROR)throw Error("WebGL2 native mesh buffer upload failed");
     this.entries.set(id,{vao,vbo,ebo,instanceVbo,opacityVbo,instances:row.instanceCount,
       capacity:row.instanceCount,sourceByteSize:row.byteSize,
       count:row.indices.length,vertexCount:row.vertexCount,indexCapacity:row.indices.length,transform:row.transform,
       color:new Float32Array(geometry.material?.color??[1,1,1,1]),alphaCutoff:geometry.material?.alphaCutoff??0,alphaCompare:geometry.material?.alphaCompare??7,
       bytes:accounted,last:this.frame,
       texture:geometry.material?.texture??"",
       blend:(geometry.material?.blend??false)||(material?.objectFade??false)||!!material?.lightmap,
       blendPair:material?.lightmap?{source:1,destination:3}:material?.blendPair,
       doubleSided:geometry.material?.doubleSided??false,
       depthWrite:material?.sky?false:material?.lightmap?false:
         (geometry.material?.depthWrite??(!geometry.material?.blend||!!material?.objectFade)),
       lightmap:!!material?.lightmap,sky:material?.sky??0,
       fogDisabled:!!material?.fogDisabled,
       localFog:material?.fog?[
         ((material.fog.color>>>16)&255)/255,
         ((material.fog.color>>>8)&255)/255,
         (material.fog.color&255)/255,
         material.fog.nearPlane,material.fog.farPlane
       ]:null,
       stageFactor:material?.stageFactor??1,
       objectFade:!!material?.objectFade,fadeAlphaOnly:!!material?.fadeAlphaOnly,
       surfaceAlpha:!!material?.surfaceAlpha,
       lit,ambient:new Float32Array(material?.ambient??[1,1,1]),
       ambientScale:material?.objectLight??1,
       objectVertexLighting:material?.objectLight!==undefined});
     this.used+=accounted;
   }catch(e){gl.deleteVertexArray(vao);gl.deleteBuffer(vbo);gl.deleteBuffer(ebo);
     gl.deleteBuffer(instanceVbo);gl.deleteBuffer(opacityVbo);throw e;}
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
   if(sceneIds.some(id=>this.entries.get(id)!.sky)&&!this.environmentPacked)
     throw Error("Original sky geometry requires packed native WorldEnvironment");
   if(sceneIds.some(id=>this.entries.get(id)!.lit)&&!this.lighting)
     throw Error("Original lit Silkroad world requires native packed environment");
   const camera=originalCameraToWebgl2(cameraMatrix);
   this.frame++;this.visible=new Set(sceneIds);this.worldTextures.frame();
   const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);
   // Retail UI uses scissor rectangles. GL state is shared between passes:
   // never let the previous HUD clip the next original sky/world clear.
   gl.disable(gl.SCISSOR_TEST);
   gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
   gl.clearColor(0,0,0,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   if(this.skyPacked)this.atmosphere.draw(this.skyPacked);
   gl.useProgram(this.program);
   gl.uniform1i(gl.getUniformLocation(this.program,"uTexture"),0);
   const sky=this.environmentPacked;
   if(sky){
     gl.uniform3fv(gl.getUniformLocation(this.program,"uSkyForward"),sky.subarray(16,19));
     gl.uniform3fv(gl.getUniformLocation(this.program,"uSkyRight"),sky.subarray(20,23));
     gl.uniform3fv(gl.getUniformLocation(this.program,"uSkyUp"),sky.subarray(24,27));
     gl.uniform4fv(gl.getUniformLocation(this.program,"uSkyZenith"),sky.subarray(0,4));
     gl.uniform3fv(gl.getUniformLocation(this.program,"uSkyHorizon"),sky.subarray(4,7));
     gl.uniform4fv(gl.getUniformLocation(this.program,"uSkyScatter"),sky.subarray(44,48));
     gl.uniform4fv(gl.getUniformLocation(this.program,"uSkySun"),sky.subarray(52,56));
     gl.uniform3fv(gl.getUniformLocation(this.program,"uSkyFog"),sky.subarray(28,31));
     gl.uniform1f(gl.getUniformLocation(this.program,"uSkyTime"),sky[48]!);
     gl.uniform1f(gl.getUniformLocation(this.program,"uSkyCloudScroll"),sky[49]!);
     gl.uniform1f(gl.getUniformLocation(this.program,"uSkyCloudAlpha"),sky[50]!);
   }
   gl.activeTexture(gl.TEXTURE0);
   gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uViewProjection"),false,camera);
   const environment=this.lighting;
   gl.uniform3fv(gl.getUniformLocation(this.program,"uDiffuse"),
     environment?.diffuse??new Float32Array([1,1,1]));
   gl.uniform3fv(gl.getUniformLocation(this.program,"uAmbient"),
     environment?.ambient??new Float32Array([0,0,0]));
   gl.uniform3fv(gl.getUniformLocation(this.program,"uLightDirection"),
     environment?.direction??new Float32Array([Math.SQRT1_2,Math.SQRT1_2,0]));
   let triangles=0;
   for(const id of sceneIds){
     const s=this.entries.get(id)!;s.last=this.frame;
     gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"uModel"),false,s.transform);
     gl.uniform4fv(gl.getUniformLocation(this.program,"uMaterialColor"),s.color);
     gl.uniform1f(gl.getUniformLocation(this.program,"uCutoff"),s.alphaCutoff);
     gl.uniform1i(gl.getUniformLocation(this.program,"uAlphaCompare"),s.alphaCompare);
     gl.uniform1i(gl.getUniformLocation(this.program,"uObjectFade"),s.objectFade?1:0);
     gl.uniform1i(gl.getUniformLocation(this.program,"uFadeAlphaOnly"),s.fadeAlphaOnly?1:0);
     gl.uniform1i(gl.getUniformLocation(this.program,"uSurfaceAlpha"),s.surfaceAlpha?1:0);
     gl.uniform1f(gl.getUniformLocation(this.program,"uStageFactor"),s.stageFactor);
      gl.uniform1i(gl.getUniformLocation(this.program,"uSkyKind"),s.sky);
      const localFog=s.localFog;
      const envFog=this.environmentPacked;
      const hasFog=!s.fogDisabled&&!s.sky&&!s.lightmap&&
        (!!localFog||!!envFog&&envFog[33]!>0.5);
      gl.uniform1i(gl.getUniformLocation(this.program,"uWorldFogEnabled"),hasFog?1:0);
      gl.uniform3fv(gl.getUniformLocation(this.program,"uWorldFogColor"),
        localFog?new Float32Array(localFog.slice(0,3)):
        envFog?.subarray(28,31)??new Float32Array([0,0,0]));
      gl.uniform1f(gl.getUniformLocation(this.program,"uWorldFogStart"),
        localFog?.[3]??envFog?.[31]??0);
      gl.uniform1f(gl.getUniformLocation(this.program,"uWorldFogEnd"),
        localFog?.[4]??envFog?.[32]??0);
      gl.uniform1i(gl.getUniformLocation(this.program,"uLightmap"),s.lightmap?1:0);
      gl.uniform3fv(gl.getUniformLocation(this.program,"uLightmapShadow"),
        this.environmentPacked?.subarray(40,43)??new Float32Array([0,0,0]));
      gl.uniform1i(gl.getUniformLocation(this.program,"uLightmapFogEnabled"),
        this.environmentPacked?.[33]!>0.5?1:0);
      gl.uniform3fv(gl.getUniformLocation(this.program,"uLightmapFogColor"),
        this.environmentPacked?.subarray(72,75)??new Float32Array([0,0,0]));
      gl.uniform1f(gl.getUniformLocation(this.program,"uLightmapFogStart"),
        this.environmentPacked?.[31]??0);
      gl.uniform1f(gl.getUniformLocation(this.program,"uLightmapFogEnd"),
        this.environmentPacked?.[32]??0);
     gl.uniform1i(gl.getUniformLocation(this.program,"uLit"),s.lit?1:0);
     gl.uniform1i(gl.getUniformLocation(this.program,"uObjectVertexLighting"),
       s.objectVertexLighting?1:0);
     gl.uniform3fv(gl.getUniformLocation(this.program,"uMaterialDiffuse"),
       new Float32Array(s.color.subarray(0,3)));
     gl.uniform3fv(gl.getUniformLocation(this.program,"uAmbientFactor"),s.ambient);
     gl.uniform1f(gl.getUniformLocation(this.program,"uAmbientScale"),s.ambientScale);
     gl.uniform1i(gl.getUniformLocation(this.program,"uUseTexture"),s.texture?1:0);
     gl.bindTexture(gl.TEXTURE_2D,s.texture?this.worldTextures.get(s.texture):this.white);
      // The original lightmap sampler clamps; ordinary world materials
      // repeat. Texture objects may be shared, so set this on every draw.
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,
        s.lightmap?gl.CLAMP_TO_EDGE:gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,
        s.lightmap?gl.CLAMP_TO_EDGE:gl.REPEAT);
     if(s.doubleSided)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}
      if(s.sky)gl.disable(gl.DEPTH_TEST);
      else gl.enable(gl.DEPTH_TEST);
     originalBlendPair(gl,s.blend,s.blendPair);
     gl.depthMask(s.depthWrite);
     gl.bindVertexArray(s.vao);
     gl.drawElementsInstanced(gl.TRIANGLES,s.count,gl.UNSIGNED_INT,0,s.instances);
     triangles+=s.count/3*s.instances;
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
   this.lighting=null;this.skyPacked=null;this.environmentPacked=null;
   this.atmosphere.dispose();
   this.protectedStageGroups.clear();
   this.gl.deleteProgram(this.program);
 }
}
