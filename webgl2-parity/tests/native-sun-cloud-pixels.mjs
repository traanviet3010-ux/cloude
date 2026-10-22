import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const original=process.env.SRO_SOURCE_ROOT;
if(!original)throw Error("Exact original OpenSRO source is required");
const dir=dirname(fileURLToPath(import.meta.url)),bundle=join(dir,"native-original-sun-cloud.js");
await build({entryPoints:[join(dir,"native-sky-source-bridge.ts")],
 bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:bundle,
 alias:{"@":original+"/apps/client-next/src"}});
const server=http.createServer((req,res)=>{
 if(req.url==="/sky.js"){res.writeHead(200,{"Content-Type":"text/javascript"});res.end(readFileSync(bundle));}
 else{res.writeHead(200,{"Content-Type":"text/html"});res.end("<!doctype html><title>Pinned original SRO sun-cloud GPU pixels</title>");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try{
 const page=await browser.newPage({viewport:{width:256,height:144}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
  const {skyGroups,worldEnvironment,OriginalWorldWebgl2}=await import("/sky.js");
  const sunPath="/assets/original-sun.dds",cloudPath="/assets/original-clouds.dds";
  const sky=skyGroups({sunTexturePublicPath:sunPath,cloudTexturePublicPath:cloudPath});
  const sun=sky.find(g=>g.material.sky===3),cloud=sky.find(g=>g.material.sky===5);
  if(!sun||!cloud)throw Error("Pinned original sun and cloud authoring changed");
  const canvas=document.createElement("canvas");
  canvas.width=96;canvas.height=96;document.body.appendChild(canvas);
  const world=new OriginalWorldWebgl2(canvas,48);
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const forwardX={eye:[0,0,0],target:[1,0,0],fov:Math.PI/2,near:.1,far:100000};
  const packed=worldEnvironment(undefined,forwardX,1,0);
  const white={kind:"native-texture",width:1,height:1,format:"bgra8unorm",
    levels:[new Uint8Array([255,255,255,255])]};
  world.setTexture(sunPath,white);world.setTexture(cloudPath,white);
  world.set(sun.id,{...sun.geometry,material:sun.material});
  world.set(cloud.id,{...cloud.geometry,material:cloud.material});
  const gl=canvas.getContext("webgl2");
  const px=()=>{const v=new Uint8Array(4);gl.readPixels(48,48,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);return [...v];};
  packed[48]=.25;packed.set([1,0,0,1],52); // OpenSRO original day disc
  world.setOriginalLighting(packed,false,false);
  const day=world.render(identity,[sun.id]);
  const sunDay=px();
  packed[48]=.05;world.setOriginalLighting(packed,false,false);
  world.render(identity,[sun.id]);
  const sunNight=px();
  // True sky:5 cloud mesh; test uses a fixed source environment vector
  // so the camera views the pinned sky geometry's native Y=20000 plane.
  packed.set([0,1,0],16);
  packed.set([1,0,0],20);
  packed.set([0,0,-1],24);
  packed.set([.6,.2,.8,1],44); // sky-scatter tint
  packed.set([0,0,0],28); // fog color
  packed[49]=.125;packed[50]=1; // original UV scroll, authored opacity
  world.setOriginalLighting(packed,false,false);
  const clouds=world.render(identity,[cloud.id]),cloudPixel=px();
  packed[50]=0;world.setOriginalLighting(packed,false,false);
  world.render(identity,[cloud.id]);
  const hidden=px();
  world.dispose();
  return {sourceIndices:{sun:sun.geometry.indices.length,cloud:cloud.geometry.indices.length},
    sunDay,sunNight,cloudPixel,hidden,sunTriangles:day.triangleCount,
    cloudTriangles:clouds.triangleCount};
 });
 assert.ok(result.sunTriangles>0&&result.sourceIndices.sun===6,
   "Native sun must use original two authored triangles");
 assert.ok(result.sunDay[0]>200&&result.sunDay[1]<50&&result.sunDay[2]<50,
   "Original sky:3 sun disc must render red daytime pixels");
 assert.ok(result.sunNight[0]<20,
   "Original sky:3 night visibility mask must hide the disc");
 assert.ok(result.cloudTriangles>0&&result.sourceIndices.cloud>0,
   "Original sky:5 authored cloud grid must be rendered");
 assert.ok(result.cloudPixel[0]>110&&result.cloudPixel[2]>155,
   "Original clouds must inherit authored texture and packed scatter tint");
 assert.ok(result.hidden[0]<20&&result.hidden[2]<20,
   "Original skyTime cloud alpha must hide clouds without a fake replacement");
 console.log("ORIGINAL_SILKROAD_SKY_SUN_CLOUD_PIXELS_PASS",JSON.stringify(result));
}finally{
 await browser.close();await new Promise(r=>server.close(r));
}
