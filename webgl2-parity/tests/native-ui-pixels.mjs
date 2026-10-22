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
    // Original WebGPU UI intentionally skips only missing CIF art, not the
    // entire login scene while other real textures are downloading.
    owner.draw({revision:3,width:64,height:64,quads:[
      {rect:[0,0,16,32],clip:[0,0,64,64],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"missing-native-CIF-art"},
      {rect:[32,0,16,32],clip:[0,0,64,64],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-raster"},
      {rect:[16,0,16,32],clip:[0,0,64,64],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-raster",
       mask:{texture:"not-yet-resident-mask",rect:[16,0,16,32]}}
    ]});
    state.missingOriginalArt=read(8,50);
    state.missingOriginalMask=read(24,50);
    state.loadedOriginalArt=read(40,50);
    state.loadingStats=owner.stats();
    // A failed original CIF replacement must keep the last completed GPU
    // artwork visible, rather than blank the character/title screen.
    try{
      owner.setTexture("original-raster",{
        kind:"native-texture",format:"bgra8unorm",
        width:2,height:2,levels:[new Uint8Array(1)]
      });
      state.corruptReplacementRejected=false;
    }catch(err){
      state.corruptReplacementRejected=/truncated/.test(String(err));
    }
    owner.draw({revision:4,width:64,height:64,quads:[{
      rect:[0,0,64,64],clip:[0,0,64,64],uv:[0,0,1,1],
      color:[1,1,1,1],texture:"original-raster"
    }]});
    state.originalArtAfterRejection=read(12,12);
    state.atomicStats=owner.stats();
    owner.setTexture("original-raster",new ImageData(
      new Uint8ClampedArray([0,255,0,255]),1,1));
    owner.draw({revision:5,width:64,height:64,quads:[{
      rect:[0,0,64,64],clip:[0,0,64,64],uv:[0,0,1,1],
      color:[1,1,1,1],texture:"original-raster"
    }]});
    state.newArtAfterCommit=read(12,12);
    owner.dispose();

    // The two genuine UI images are needed by the SAME native frame.
    // Safari pressure must refuse a third image instead of releasing either
    // protected inventory/skill-bar image before a successful upload.
    const budgetCanvas=document.createElement("canvas");
    budgetCanvas.width=8;budgetCanvas.height=8;
    document.body.appendChild(budgetCanvas);
    const budgetOwner=new NativeUiWebgl2Renderer(budgetCanvas,8);
    // Simulate ORIGINAL createUi publishing new CIF quads before async
    // texture arrivals. Residency pins must be installed before the first draw.
    budgetOwner.protectUiScene({revision:1,width:8,height:8,quads:[
      {rect:[0,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-a"},
      {rect:[4,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-b"}
    ]});
    const pixel=new Uint8ClampedArray(1024*1024*4);
    pixel.fill(255);
    budgetOwner.setTexture("original-hud-a",
      new ImageData(pixel,1024,1024));
    budgetOwner.setTexture("original-hud-b",
      new ImageData(pixel,1024,1024));
    try{
      budgetOwner.setTexture("pre-draw-overflow",
        new ImageData(new Uint8ClampedArray([1,2,3,255]),1,1));
      state.predrawScenePinned=false;
    }catch(err){state.predrawScenePinned=/protected textures/.test(String(err));}
    budgetOwner.draw({revision:1,width:8,height:8,quads:[
      {rect:[0,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-a"},
      {rect:[4,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-b"}
    ]});
    try{
      budgetOwner.setTexture("third-texture",
        new ImageData(new Uint8ClampedArray([255,0,0,255]),1,1));
      state.protectedBudgetRejected=false;
    }catch(err){
      state.protectedBudgetRejected=/protected textures/.test(String(err));
    }
    state.protectedBudgetStats=budgetOwner.stats();
    budgetOwner.draw({revision:2,width:8,height:8,quads:[
      {rect:[0,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-a"},
      {rect:[4,0,4,8],clip:[0,0,8,8],uv:[0,0,1,1],
       color:[1,1,1,1],texture:"original-hud-b"}
    ]});
    state.budgetStillDrawn=budgetOwner.stats().drawCalls;
    budgetOwner.dispose();

    // Validate the ORIGINAL pinned WGSL atlas uvTurn convention in real
    // WebGL2 pixels, including its non-symmetric 90-degree rotations.
    const turnCanvas=document.createElement("canvas");
    turnCanvas.width=32;turnCanvas.height=32;
    document.body.appendChild(turnCanvas);
    const turnOwner=new NativeUiWebgl2Renderer(turnCanvas,8);
    // Four distinct authored texels: TL red, TR green, BL blue, BR yellow.
    turnOwner.setTexture("original-CIF-rotated-atlas",new ImageData(
      new Uint8ClampedArray([
        255,0,0,255, 0,255,0,255,
        0,0,255,255, 255,255,0,255
      ]),2,2));
    const gt=turnCanvas.getContext("webgl2");
    state.uvTurns=[];
    for(let turn=0;turn<4;turn++){
      turnOwner.draw({revision:turn+1,width:32,height:32,quads:[{
        rect:[0,0,32,32],clip:[0,0,32,32],uv:[0,0,1,1],
        color:[1,1,1,1],sampling:"nearest",
        texture:"original-CIF-rotated-atlas",uvTurn:turn
      }]});
      const p=new Uint8Array(4);
      gt.readPixels(8,24,1,1,gt.RGBA,gt.UNSIGNED_BYTE,p);
      state.uvTurns.push([...p]);
    }
    turnOwner.dispose();
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
  assert.equal(state.missingOriginalArt[3],0,"Missing original CIF asset must not render fake art");
  assert.equal(state.missingOriginalMask[3],0,"Missing original CIF alpha mask must hide only its quad");
  assert.ok(state.loadedOriginalArt[0]>220&&state.loadedOriginalArt[3]>220,
    "Already loaded genuine CIF asset must still render during pending asset requests");
  assert.equal(state.loadingStats.missingQuads,2);
  assert.equal(state.loadingStats.drawCalls,1);
  assert.equal(state.corruptReplacementRejected,true);
  assert.ok(state.originalArtAfterRejection[0]>220 &&
    state.originalArtAfterRejection[1]<20,
    "The existing original CIF art must remain red after corrupt GPU upload");
  assert.equal(state.atomicStats.textureCount,2,
    "Refused updates must not remove other native UI images");
  assert.ok(state.atomicStats.failedUploads>=1);
  assert.ok(state.newArtAfterCommit[1]>220 &&
    state.newArtAfterCommit[0]<20,
    "An accepted replacement must atomically publish the new green native art");
  assert.equal(state.predrawScenePinned,true,
    "Do not evict a required original CIF image before the first HUD draw");
  assert.equal(state.protectedBudgetRejected,true,
    "Do not evict the two images referenced by the original current frame");
  assert.equal(state.protectedBudgetStats.textureCount,2);
  assert.ok(state.protectedBudgetStats.failedUploads>=1);
  assert.equal(state.protectedBudgetStats.residentMB,8);
  assert.equal(state.budgetStillDrawn,2);
  const expectedOriginalUvTurns=[
    [255,0,0,255], [0,0,255,255],
    [255,255,0,255], [0,255,0,255]
  ];
  assert.deepEqual(state.uvTurns,expectedOriginalUvTurns,
    "All retail CIF 90-degree atlas rotations must match pinned OpenSRO WGSL in GL pixels");

  console.log("OPEN_SRO_UI_WEBGL2_GL_PIXEL_TEST_PASS",JSON.stringify(state));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
