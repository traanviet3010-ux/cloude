import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const original=process.env.SRO_SOURCE_ROOT;
if(!original)throw Error("Pinned OpenSRO checkout required for sky groups");
const dir=dirname(fileURLToPath(import.meta.url)),bundle=join(dir,"native-original-sky-bundle.js");
await build({entryPoints:[join(dir,"native-sky-source-bridge.ts")],
 bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:bundle,
 alias:{"@":original+"/apps/client-next/src"}});
const server=http.createServer((req,res)=>{
 if(req.url==="/sky.js"){res.writeHead(200,{"Content-Type":"text/javascript"});res.end(readFileSync(bundle));}
 else{res.writeHead(200,{"Content-Type":"text/html"});res.end("<!doctype html><title>OpenSRO sky polygons WebGL2 test</title>");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"
]});
try {
 const page=await browser.newPage({viewport:{width:160,height:160}});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
   const {skyGroups,worldEnvironment,OriginalWorldWebgl2}=await import("/sky.js");
   const genuine=skyGroups({});
   if(genuine.length!==2||genuine[0].material.sky!==1||genuine[1].material.sky!==6)
     throw Error("Pinned original skyGroups() no longer yields retail dome/horizon");
   const canvas=document.createElement("canvas");
   canvas.width=96;canvas.height=96;document.body.appendChild(canvas);
   const world=new OriginalWorldWebgl2(canvas,48);
   const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const camera={eye:[0,0,0],target:[0,0,1],fov:Math.PI/2,near:.1,far:100000};
   const packed=worldEnvironment(undefined,camera,1,0);
   // Fixed sky colors are TEST vectors in native packed field positions.
   // Geometry itself comes ONLY from the pinned OpenSRO skyGroups() source.
   packed.set([0,1,0,1],0); // zenith
   packed.set([0.3,0.1,0,0],4); // horizon
   packed.set([0.05,0.15,0.9,0],28); // fog / lower horizon
   packed.set([0,0,0,1],44); // scatter
   packed[48]=.5;
   packed.set([1,1,1,1],52); // sun
   for(const g of genuine)world.set(g.id,{...g.geometry,material:g.material});
   world.setOriginalLighting(packed,false,false);
   const gl=canvas.getContext("webgl2");
   const sample=(x,y)=>{const pixel=new Uint8Array(4);
     gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     return [...pixel];};
   const pre=world.render(I,["sky:1"]);
   const domeTop=sample(48,79),domeBottom=sample(48,12);
   const combined=world.render(I,["sky:1","sky:6"]);
   const upper=sample(48,79),lower=sample(48,12);
   const stats={geometryCount:combined.geometryCount,residentMB:combined.residentMB};
   world.dispose();
   return {kinds:genuine.map(x=>x.material.sky),count:genuine.map(x=>x.geometry.indices.length),
     domeTop,domeBottom,upper,lower,preTriangles:pre.triangleCount,
     triangles:combined.triangleCount,stats};
 });
 assert.deepEqual(result.kinds,[1,6]);
 assert.ok(result.count[0]>0&&result.count[1]>0,
   "Actual pinned sky dome and lower-horizon meshes must be nonempty");
 assert.ok(result.preTriangles>0&&result.triangles>result.preTriangles,
   "Both original sky groups must use real native GPU triangles");
 assert.ok(result.upper[1]>result.upper[2]&&result.upper[1]>result.upper[0],
   "Pinned original sky:1 dome must blend native zenith over upper horizon");
 assert.ok(result.lower[2]>result.lower[1]&&result.lower[2]>result.lower[0],
   "Pinned original sky:6 lower-horizon fog must use packed fog color");
 assert.ok(result.lower[2]>result.domeBottom[2],
   "Lower sky group must actually draw beyond sky:1 silhouette");
 console.log("ORIGINAL_OPEN_SRO_SKY_DOME_HORIZON_GPU_PIXELS_PASS",JSON.stringify(result));
} finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
