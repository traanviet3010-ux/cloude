import assert from "node:assert/strict";
import http from "node:http";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";

const cwd=dirname(fileURLToPath(import.meta.url));
const output=join(cwd,"pixel-bundle.js");
await build({entryPoints:[join(cwd,"../src/native-ui-webgl2.ts")],bundle:true,
  format:"esm",platform:"browser",target:"es2022",outfile:output});
const server=http.createServer((req,res)=>{
  if(req.url==="/pixel-bundle.js"){res.writeHead(200,{"Content-Type":"text/javascript"});
    res.end(readFileSync(output));return;}
  res.writeHead(200,{"Content-Type":"text/html"});
  res.end('<!doctype html><meta charset="utf-8"><title>Original UiScene WebGL2 shader verification</title>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const port=server.address().port;
const browser=await chromium.launch({headless:true,args:[
  "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"]});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true});
  await page.goto("http://127.0.0.1:"+port+"/");
  const state=await page.evaluate(async()=>{
    const {NativeUiWebgl2Renderer}=await import("/pixel-bundle.js");
    const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;
    document.body.appendChild(canvas);
    const owner=new NativeUiWebgl2Renderer(canvas,8);
    const image=new ImageData(new Uint8ClampedArray([255,0,0,255]),1,1);
    owner.setTexture("original-raster",image);
    owner.draw({revision:1,width:64,height:64,quads:[{
      rect:[0,0,32,32],clip:[0,0,16,64],uv:[0,0,1,1],
      color:[1,1,1,1],texture:"original-raster"
    }]});
    const gl=canvas.getContext("webgl2");
    const read=(x,y)=>{const b=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b];};
    const state={inside:read(8,50),clipped:read(24,50),outside:read(50,50),stats:owner.stats()};
    const mask=new ImageData(new Uint8ClampedArray([
      255,255,255,255, 255,255,255,0
    ]),2,1);
    owner.setTexture("original-CIF-alpha-mask",mask);
    owner.draw({revision:2,width:64,height:64,quads:[{
      rect:[0,0,32,32],clip:[0,0,64,64],uv:[0,0,1,1],
      color:[1,1,1,1],sampling:"nearest",texture:"original-raster",
      mask:{texture:"original-CIF-alpha-mask",rect:[0,0,32,32]}
    }]});
    state.maskInside=read(4,48);
    state.maskOutside=read(28,48);
    state.maskTextureCount=owner.stats().textureCount;
    owner.dispose();
    return state;
  });
  assert.ok(state.inside[0]>=240&&state.inside[1]<20&&state.inside[2]<20,
    "Real red UI asset texel must appear in the original-ui WebGL2 fragment shader");
  assert.equal(state.clipped[3],0,"Native clip scissor must prevent rendering past right bound");
  assert.equal(state.outside[3],0,"Transparent canvas must stay transparent away from original UI");
  assert.equal(state.stats.drawCalls,1);
  assert.equal(state.stats.textureCount,1);
  assert.ok(state.maskInside[0]>220&&state.maskInside[3]>220,
    "Original CIF mask must preserve full opacity in its first half");
  assert.equal(state.maskOutside[3],0,
    "Original CIF mask must remove alpha from its second half");
  assert.equal(state.maskTextureCount,2);

  console.log("OPEN_SRO_UI_WEBGL2_GL_PIXEL_TEST_PASS",JSON.stringify(state));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
