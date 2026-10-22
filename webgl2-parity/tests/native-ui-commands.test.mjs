import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const source=readFileSync(new URL("../src/native-ui-commands.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.ESNext}}).outputText;
const {compileNativeUi}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const rect=[2,4,10,20];
function quad(props={}){return {rect,clip:[0,0,400,400],uv:[0,0,1,1],
  color:[1,1,1,1],texture:"original-silkroad-ui",...props};}
function scene(quads=[quad()]){return {revision:1,width:400,height:400,quads};}

test("renders original CIF quads with original colors and UVs, no CSS reimplementation",()=>{
  const [c]=compileNativeUi(scene());
  assert.equal(c.texture,"original-silkroad-ui");
  assert.equal(c.vertexData.length,48);
  assert.deepEqual([...c.vertexData.subarray(0,8)],[2,4,0,0,1,1,1,1]);
  assert.deepEqual([...c.vertexData.subarray(8,16)],[12,4,1,0,1,1,1,1]);
});
test("preserves glyph-run paint order and atlas texture identity",()=>{
  const run={glyphs:[{x:0,y:1,width:5,height:6,uv:[0,.2,.2,.3]},
    {x:9,y:2,width:6,height:7,uv:[.2,.3,.2,.4]}]};
  const draws=compileNativeUi(scene([quad({run,rect:[20,30,50,20]})]));
  assert.equal(draws.length,2);
  assert.deepEqual([...draws[0].vertexData.subarray(0,4)],[20,31,0,Math.fround(.2)]);
  assert.equal(draws[1].vertexData[0],29);
});
test("unported inventory dolls and scene-anchored labels fail closed, never disappear silently",()=>{
  for(const x of [
    {doll:{gid:100,yaw:0}},
    {worldAnchor:{x:0,y:0,z:0,regionId:0}},
    {portraitGid:1},{occlusion:"scene"}
  ])assert.throws(()=>compileNativeUi(scene([quad(x)])),/missing 3D\/occlusion\/mask/);
});
test("bad geometry and pathological UI records fail before rendering",()=>{
  assert.throws(()=>compileNativeUi({revision:1,width:0,height:200,quads:[]}),/dimensions/);
  assert.throws(()=>compileNativeUi(scene([quad({rect:[0,NaN,20,30]})])),/invalid geometry/);
  assert.throws(()=>compileNativeUi(scene(Array.from({length:8193},()=>quad()))),/record budget/);
});
test("rotation and left/right tint remain authored native geometry",()=>{
  const [c]=compileNativeUi(scene([quad({rightColor:[.5,.25,.75,1],
    rect:[0,0,20,10],rotation:Math.PI})]));
  assert.ok(Math.abs(c.vertexData[0]-20)<1e-4);
  assert.ok(Math.abs(c.vertexData[1]-10)<1e-4);
  assert.equal(c.vertexData[8+4],.5);
});

test("retail CIF alpha-mask remains a distinct texture with original screen-space rectangle",()=>{
 const rect=[10,15,20,25],mask={texture:"original-mask",rect:[5,6,28,40]};
 const [cmd]=compileNativeUi(scene([quad({rect,mask})]));
 assert.equal(cmd.maskTexture,"original-mask");
 assert.deepEqual(cmd.maskRect,mask.rect);
 assert.equal(cmd.texture,"original-silkroad-ui");
 assert.deepEqual([...cmd.vertexData.slice(0,2)],[10,15]);
 assert.equal(compileNativeUi(scene())[0].maskTexture,null);
 assert.throws(()=>compileNativeUi(scene([quad({mask:{texture:"",rect:[0,0,1,1]}})])),/mask invalid/);
 assert.throws(()=>compileNativeUi(scene([quad({mask:{texture:"m",rect:[0,0,0,1]}})])),/mask invalid/);
});


test("all original OpenSRO WGSL uvTurn values use the EXACT retail corner winding",()=>{
  // Pinned createUiResources() WGSL maps c -> (c.y,1-c.x) for turn=1
  // and c -> (1-c.y,c.x) for turn=3, not the reverse.
  const layouts=[
    [[0,0],[1,0],[1,1],[0,1]],
    [[0,1],[0,0],[1,0],[1,1]],
    [[1,1],[0,1],[0,0],[1,0]],
    [[1,0],[1,1],[0,1],[0,0]]
  ];
  for(let turn=0;turn<4;turn++){
    const [cmd]=compileNativeUi(scene([quad({uvTurn:turn})]));
    const vertices=cmd.vertexData;
    assert.deepEqual([0,1,2,5].map(index=>[
      vertices[index*8+2],vertices[index*8+3]
    ]),layouts[turn],"Original UI RGBA atlas winding for uvTurn "+turn);
  }
});
