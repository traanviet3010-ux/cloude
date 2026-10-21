import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const src=readFileSync(new URL("../src/original-ui-runtime-bridge.ts",import.meta.url),"utf8");
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createOriginalUiBridge}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
test("original renderer callbacks preserve authentic UiScene identity and native texture bytes",()=>{
 const uploaded=[],frames=[];
 const gpu={residentMB:2,textureCount:1,drawCalls:1,frame:3};
 const bridge=createOriginalUiBridge({
    setTexture:(id,image)=>uploaded.push({id,image}),
    draw:(scene,clear)=>frames.push({scene,clear}),
    stats:()=>gpu
 });
 const scene=Object.freeze({revision:4,width:800,height:600,quads:Object.freeze([
  Object.freeze({rect:[0,0,400,100],uv:[0,0,1,1],color:[1,1,1,1],
  texture:"/assets/images/Media_extracted/interface/outer/logo-big.png",clip:[0,0,800,600]})
 ])});
 const image={kind:"native-texture",width:1,height:1,format:"bgra8unorm",levels:[new Uint8Array([0,0,255,255])]};
 assert.equal(bridge.draw(),false);
 bridge.setUi(scene);
 bridge.setUiTexture(scene.quads[0].texture,image);
 assert.equal(bridge.draw(),true);
 assert.equal(frames[0].scene,scene,"Do not rewrite original retail UI geometry");
 assert.equal(frames[0].clear,false,"Do not clear original 3D intro scene");
 assert.equal(uploaded[0].image,image,"Do not copy/recompress native asset metadata or bytes");
 assert.equal(bridge.stats().sceneRevision,4);
 assert.equal(bridge.stats().gpu,gpu);
 assert.equal(bridge.stats().textureChanges,1);
 bridge.setUi(null);
 assert.equal(bridge.draw(),false);
 bridge.setUiTexture(scene.quads[0].texture,null);
 assert.equal(uploaded[1].image,null,"Retirement goes to GPU owner without changing original asset logic");
 bridge.dispose();
 assert.throws(()=>bridge.draw(),/disposed/);
 assert.throws(()=>bridge.setUi(scene),/disposed/);
 assert.throws(()=>bridge.setUiTexture("a",image),/disposed/);
});
test("broken source UI publication rejected before GPU submission",()=>{
 const bridge=createOriginalUiBridge({setTexture(){},draw(){throw Error("must not draw");},
 stats:()=>({residentMB:0,textureCount:0,drawCalls:0,frame:0})});
 assert.throws(()=>bridge.setUi({revision:NaN,width:600,height:400,quads:[]}),/invalid/);
 assert.throws(()=>bridge.setUi({revision:1,width:Infinity,height:400,quads:[]}),/invalid/);
 bridge.dispose();
});
