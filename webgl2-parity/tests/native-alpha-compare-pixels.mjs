import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

const dir=dirname(fileURLToPath(import.meta.url)),output=join(dir,"alpha-compare-bundle.js");
await build({entryPoints:[join(dir,"../src/native-world-webgl2.ts")],
  bundle:true,format:"esm",platform:"browser",target:"es2022",outfile:output});
const server=http.createServer((req,res)=>{
 if(req.url==="/alpha-compare-bundle.js"){
   res.writeHead(200,{"Content-Type":"text/javascript"});res.end(readFileSync(output));return;
 }
 res.writeHead(200,{"Content-Type":"text/html"});
 res.end("<!doctype html><title>Native Silkroad D3D alpha comparison pixel parity</title>");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,args:[
 "--use-gl=angle","--use-angle=swiftshader","--enable-webgl","--enable-unsafe-swiftshader"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 await page.goto("http://127.0.0.1:"+server.address().port+"/");
 const result=await page.evaluate(async()=>{
   const {OriginalWorldWebgl2}=await import("/alpha-compare-bundle.js");
   const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;document.body.appendChild(canvas);
   const own=new OriginalWorldWebgl2(canvas,16),gl=canvas.getContext("webgl2");
   const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const data=[];
   for(let compare=1;compare<=8;compare++){
     own.set("native-alpha-compare",{
       positions:new Float32Array([-.9,-.9,.5,.9,-.9,.5,0,.9,.5]),
       indices:new Uint32Array([0,1,2]),transform:I,
       material:{color:[1,0,0,.5],unlit:true,doubleSided:true,
         alphaCutoff:.5,alphaCompare:compare,blend:false}
     });
     own.render(I,["native-alpha-compare"]);
     const pixel=new Uint8Array(4);
     gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     data.push({compare,red:pixel[0]});
   }
   own.dispose();
   return data;
 });
 const expected=[false,false,true,true,false,false,true,true];
 for(let i=0;i<8;i++){
   assert.equal(result[i].red>220,expected[i],
    "Original Silkroad D3D comparison "+(i+1)+" does not match native equality semantics");
 }
 console.log("ORIGINAL_SILKROAD_D3DCMPFUNC_1_8_WEBGL2_PIXEL_PASS",JSON.stringify(result));
}finally{
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
