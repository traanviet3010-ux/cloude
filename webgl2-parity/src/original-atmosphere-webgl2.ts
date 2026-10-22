/**
 * Original OpenSRO atmosphere pass, translated from
 * runtime/renderer/device/pipelines.ts skyShader (pinned original revision).
 * Draws only the retail zenith/horizon environment background.
 * Star/moon/sun/cloud geometry is a SEPARATE native material pass and must
 * never be falsely marked complete by this shader.
 *
 * GPU inputs are the unchanged Float32Array from original worldEnvironment():
 * env.zenith[0..3], horizon[4..7], forward[16..18],
 * right[20..22], up[24..26].
 */
const VERTEX=`#version 300 es
precision highp float;
out vec2 vClip;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2))*2.0-1.0;
  vClip=p;
  gl_Position=vec4(p,1.0,1.0);
}`;
const FRAGMENT=`#version 300 es
precision highp float;
in vec2 vClip;
uniform vec4 uZenith;
uniform vec3 uHorizon;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
out vec4 fragColor;
void main(){
  vec3 ray=uForward+vClip.x*uRight+vClip.y*uUp;
  float sky=clamp(normalize(ray).y*uZenith.a,0.0,1.0);
  fragColor=vec4(mix(uHorizon,uZenith.rgb,sky),1.0);
}`;
function compile(gl:WebGL2RenderingContext,kind:number,src:string){
 const shader=gl.createShader(kind);
 if(!shader)throw Error("Cannot allocate original sky GLSL shader");
 gl.shaderSource(shader,src);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
   const err=gl.getShaderInfoLog(shader);
   gl.deleteShader(shader);throw Error("Original atmosphere shader compilation failed: "+err);
 }
 return shader;
}
export function createOriginalAtmosphereWebgl2(gl:WebGL2RenderingContext){
 const v=compile(gl,gl.VERTEX_SHADER,VERTEX),f=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
 const program=gl.createProgram();
 if(!program){gl.deleteShader(v);gl.deleteShader(f);throw Error("Cannot create native sky pipeline");}
 gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
 gl.deleteShader(v);gl.deleteShader(f);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
   const reason=gl.getProgramInfoLog(program);
   gl.deleteProgram(program);throw Error("Native sky pipeline linking failed: "+reason);
 }
 const vao=gl.createVertexArray();
 if(!vao){gl.deleteProgram(program);throw Error("Original sky fullscreen VAO unavailable");}
 const uniforms={
   zenith:gl.getUniformLocation(program,"uZenith"),
   horizon:gl.getUniformLocation(program,"uHorizon"),
   forward:gl.getUniformLocation(program,"uForward"),
   right:gl.getUniformLocation(program,"uRight"),
   up:gl.getUniformLocation(program,"uUp")
 };
 let disposed=false;
 return {
   draw(packed:Float32Array){
     if(disposed)throw Error("Original sky GPU renderer disposed");
     if(!(packed instanceof Float32Array)||packed.length<28||!packed.every(Number.isFinite))
       throw Error("Invalid original packed worldEnvironment sky");
     gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
     gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
     gl.useProgram(program);gl.bindVertexArray(vao);
     gl.uniform4fv(uniforms.zenith,packed.subarray(0,4));
     gl.uniform3fv(uniforms.horizon,packed.subarray(4,7));
     gl.uniform3fv(uniforms.forward,packed.subarray(16,19));
     gl.uniform3fv(uniforms.right,packed.subarray(20,23));
     gl.uniform3fv(uniforms.up,packed.subarray(24,27));
     gl.drawArrays(gl.TRIANGLES,0,3);
     gl.bindVertexArray(null);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
     if(gl.getError()!==gl.NO_ERROR)throw Error("Original WebGL2 sky atmosphere draw failed");
   },
   dispose(){
     if(disposed)return;
     disposed=true;gl.deleteVertexArray(vao);gl.deleteProgram(program);
   }
 };
}
