/**
 * Real Chromium WebGL2 readPixels for the native OpenSRO GPU render-pass
 * command owner. This exercises graphics-command translation, NOT a
 * fabricated Silkroad login or a fully implemented GameWorld renderer.
 */
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const dir=dirname(fileURLToPath(import.meta.url));
const output=join(dir,"native-gpu-command-bundle.js");
await build({entryPoints:[join(dir,"../src/original-gl-gpu-commands.ts")],
  bundle:true,format:"esm",platform:"browser",target:"es2022",outfile:output});
const deviceOutput=join(dir,"native-gpu-command-device-bundle.js");
await build({entryPoints:[join(dir,"../src/original-gl-device.ts")],
  bundle:true,format:"esm",platform:"browser",target:"es2022",outfile:deviceOutput});
const server=http.createServer((req,res)=>{
  const file=req.url==="/command.js"?output:
    req.url==="/device.js"?deviceOutput:null;
  if(file){
    res.writeHead(200,{"Content-Type":"text/javascript"});
    res.end(readFileSync(file));return;
  }
  res.writeHead(200,{"Content-Type":"text/html"});
  res.end("<!doctype html><title>Original SRO GPU Command WebGL2 parity</title>");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:[
  "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
  const page=await browser.newPage({viewport:{width:128,height:128}});
  await page.goto("http://127.0.0.1:"+server.address().port+"/");
  const actual=await page.evaluate(async()=>{
    const [{createOriginalGlGpuCommands},{createOriginalGlDevice}]=
      await Promise.all([import("/command.js"),import("/device.js")]);
    const canvas=document.createElement("canvas");
    canvas.width=32;canvas.height=32;document.body.appendChild(canvas);
    const gl=canvas.getContext("webgl2",{alpha:false,antialias:false});
    const device=createOriginalGlDevice(canvas,{context:gl,maxResidentMB:32});
    const owner=createOriginalGlGpuCommands(device);
    const vs=gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs,`#version 300 es
      layout(location=0) in vec2 p;
      void main(){gl_Position=vec4(p,0.0,1.0);}`);
    gl.compileShader(vs);
    const fs=gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs,`#version 300 es
      precision mediump float;
      out vec4 outColor;
      void main(){outColor=vec4(1.0,0.0,0.0,1.0);}`);
    gl.compileShader(fs);
    const program=gl.createProgram();
    gl.attachShader(program,vs);gl.attachShader(program,fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))
      throw Error("Real GL shader program failed: "+gl.getProgramInfoLog(program));
    const vao=gl.createVertexArray(),vbo=gl.createBuffer(),ebo=gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
      -1,-1,1,-1,0,1
    ]),gl.STATIC_DRAW);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array([0,1,2]),gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const enc=owner.encoder();
    const pass=enc.beginRenderPass({
      width:32,height:32,colorLoad:"clear",depthLoad:"clear",
      clearColor:[0,0,0,1],clearDepth:1
    });
    pass.scissor([0,0,16,32]);
    pass.drawIndexed({
      program,vertexArray:vao,count:3,instances:1,
      depthTest:false,cull:false
    });
    pass.end();
    const commandBuffer=enc.finish();
    const frame=commandBuffer.submit();
    const pixel=(x,y)=>{
      const p=new Uint8Array(4);
      gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);
      return [...p];
    };
    const inScissor=pixel(8,16),outside=pixel(24,16);
    let rejectedTwice=false,rejectedCompute=false,staleRejected=false;
    try{commandBuffer.submit();}
    catch(e){rejectedTwice=/twice/.test(String(e));}
    try{owner.encoder().beginComputePass();}
    catch(e){rejectedCompute=/requires a real WebGL2/.test(String(e));}
    const before=owner.encoder();
    const p2=before.beginRenderPass({width:32,height:32});
    p2.drawIndexed({program,vertexArray:vao,count:3,instances:1});
    p2.end();
    const stale=before.finish();
    gl.deleteVertexArray(vao);
    try{stale.submit();}
    catch(e){staleRejected=/retired draw resource/.test(String(e));}
    const stats=owner.stats();
    owner.dispose();
    device.dispose();
    gl.deleteBuffer(vbo);gl.deleteBuffer(ebo);
    gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    return {inScissor,outside,frame,rejectedTwice,rejectedCompute,
      staleRejected,stats};
  });
  assert.ok(actual.inScissor[0]>=245 && actual.inScissor[1]<10 &&
    actual.inScissor[2]<10,
    "Original GL GPU command pass must draw a genuine red GPU triangle");
  assert.ok(actual.outside[0]<10 && actual.outside[1]<10,
    "Exact original scissor must prevent out-of-area draw");
  assert.equal(actual.frame.drawCalls,1);
  assert.equal(actual.rejectedTwice,true);
  assert.equal(actual.rejectedCompute,true,
    "Unsupported original WebGPU compute must fail, never fake a rendered frame");
  assert.equal(actual.staleRejected,true,
    "Retired GL VAO must invalidate a retained original GPU command buffer");
  assert.equal(actual.stats.submissions,1);
  console.log("HIEUSRO_NATIVE_GL_GPU_COMMAND_PIXEL_PASS",JSON.stringify(actual));
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
