import assert from "node:assert/strict";
import http from "node:http";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";

const directory=dirname(fileURLToPath(import.meta.url));
if(!process.env.SRO_SOURCE_ROOT)throw Error("Pinned original OpenSRO checkout required");
const output=join(directory,"native-terrain-test-bundle.js");
await build({
  entryPoints:[join(directory,"../src/original-webgl2-compositor.ts")],
  bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:output,
  alias:{"@":process.env.SRO_SOURCE_ROOT+"/apps/client-next/src"}
});
const server=http.createServer((req,res)=>{
  if(req.url==="/game.js"){
    res.writeHead(200,{"Content-Type":"text/javascript"});
    res.end(readFileSync(output));return;
  }
  res.writeHead(200,{"Content-Type":"text/html"});
  res.end("<!doctype html><title>Original OpenSRO terrain LOD pixel regression</title>");
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
  "--use-gl=angle","--use-angle=swiftshader","--enable-webgl",
  "--enable-unsafe-swiftshader"
]});
try{
  const page=await browser.newPage({viewport:{width:400,height:240}});
  await page.goto("http://127.0.0.1:"+server.address().port+"/");
  const result=await page.evaluate(async()=>{
    const {createOriginalSilkroadWebgl2}=await import("/game.js");
    const canvas=document.createElement("canvas");
    canvas.width=64;canvas.height=64;document.body.appendChild(canvas);
    const game=createOriginalSilkroadWebgl2(canvas);
    const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const heights=new Array(289).fill(0);
    const group={
      id:"retail-terrain-authored-group",
      center:[0,0,1],radius:320,
      material:{color:[1,0,0,1],unlit:true,terrain:true,doubleSided:true,
        alphaCutoff:0,blend:false},
      geometry:{
        positions:new Float32Array([-.8,-.8,1,.8,-.8,1,0,.8,1]),
        indices:new Uint32Array([0,1,2,0,2,1]),
        uvs:new Float32Array([0,0,1,0,.5,1]),
        transform:I
      },
      ranges:[
        {cell:[0,0],lod:0,indexStart:0,indexCount:3,
         vertexStart:0,vertexCount:3,center:[0,0,1],radius:320,heights},
        {cell:[6,0],lod:1,indexStart:3,indexCount:3,
         vertexStart:0,vertexCount:3,center:[1920,0,1],radius:320,heights}
      ]
    };
    const inputIndices=Array.from(group.geometry.indices);
    game.adoptWorld({
      sceneId:"native-SRO-terrain-scene",
      takeWorld:()=>({scene:{
        id:"native-SRO-terrain-scene",originRegion:0,groups:[group],
        warnings:[],terrainDetail:"distance"
      },bytes:2048,starBytes:0})
    },"distance");
    game.setWorldCamera({eye:[0,0,0],target:[0,0,1],fov:Math.PI/2,
      near:.1,far:10});
    game.setUi({revision:1,width:64,height:64,quads:[]});
    const first=game.originalFrontendFrame(2,0);
    const gl=canvas.getContext("webgl2");
    const pix=new Uint8Array(4);
    gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pix);
    const mid=[...pix];
    const again=game.originalFrontendFrame(2,.016);
    game.setWorldCamera({eye:[4480,0,0],target:[4480,0,1],
      fov:Math.PI/2,near:.1,far:10});
    const away=game.originalFrontendFrame(2,.032);
    const original=Array.from(group.geometry.indices);
    game.dispose();

    // A real GameWorld can publish its existing WorldScene directly; it must
    // pass through the same original GPU admission without fabricating a map.
    const directCanvas=document.createElement("canvas");
    directCanvas.width=64;directCanvas.height=64;
    document.body.appendChild(directCanvas);
    const directGame=createOriginalSilkroadWebgl2(directCanvas);
    directGame.setWorld({
      id:"original-gameworld-direct-scene",originRegion:0,
      groups:[group],warnings:[],terrainDetail:"distance"
    });
    directGame.setWorldCamera({eye:[0,0,0],target:[0,0,1],
      fov:Math.PI/2,near:.1,far:10});
    directGame.setUi({revision:1,width:64,height:64,quads:[]});
    const direct=directGame.originalFrontendFrame(2,.05);
    const dp=new Uint8Array(4);
    const directGl=directCanvas.getContext("webgl2");
    directGl.readPixels(32,32,1,1,directGl.RGBA,directGl.UNSIGNED_BYTE,dp);
    directGame.dispose();
    return {first,again,away,mid,inputIndices,original,direct,directPixel:[...dp]};
  });
  assert.equal(result.first.stage.sceneId,"native-SRO-terrain-scene");
  assert.equal(result.first.stage.residentGroups,1);
  assert.equal(result.first.triangleCount,2,
    "Original distance LOD must select only the authored cell ranges");
  assert.ok(result.mid[0]>230&&result.mid[1]<25,
    "Original authored terrain material must reach the GL framebuffer");
  assert.equal(result.again.triangleCount,2,
    "Unchanged eye-cell must retain the same GPU geometry and index count");
  assert.equal(result.away.triangleCount,0,
    "Nonresident terrain is culled rather than inventing landscape");
  assert.equal(result.away.stage.residentGroups,1,
    "Moving native camera must not recreate the original GPU model");
  assert.deepEqual(result.original,result.inputIndices,
    "Never mutate the asset worker's authored terrain index stream");
  assert.equal(result.direct.stage.sceneId,"original-gameworld-direct-scene",
    "The original GameWorld direct WorldScene must be accepted");
  assert.equal(result.direct.triangleCount,2);
  assert.ok(result.directPixel[0]>230,
    "Native GameWorld direct terrain must reach the GL framebuffer");
  console.log("ORIGINAL_OPEN_SRO_WEBGL2_TERRAIN_LOD_PIXEL_PASS",JSON.stringify({
    trianglesFirst:result.first.triangleCount,
    trianglesAway:result.away.triangleCount,
    residentGroups:result.away.stage.residentGroups,
    center:result.mid
  }));
}finally{
  await browser.close();await new Promise(r=>server.close(r));
}
