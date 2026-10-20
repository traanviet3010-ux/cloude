import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../src/native-title.ts",import.meta.url),"utf8");
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {resolveTitleImage,TITLE_ART}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

test("original OpenSRO v150 CIF contract, never a fabricated external login image",()=>{
  const layout={controlsByName:{GDR_STA_LOGO:{
    name:"GDR_STA_LOGO",ddj:{publicPath:"/assets/images/Media_extracted/interface/outer/logo.png"},
    rect:{x:0,y:0,width:508,height:172}
  }}};
  assert.equal(resolveTitleImage(layout,"GDR_STA_LOGO"),"/assets/images/Media_extracted/interface/outer/logo.png");
  assert.equal(resolveTitleImage(layout,"GDR_STA_LOGINWINDOW"),null);
  for(const x of ["https://bad.example/a.png","//bad.example/a.png","/assets/images/../../secret.png","/api/title/login","/assets/images/logo.svg"]){
    layout.controlsByName.GDR_STA_LOGO.ddj.publicPath=x;
    assert.equal(resolveTitleImage(layout,"GDR_STA_LOGO"),null,x);
  }
});
test("CIF art list includes actual original login-window, logo, native OK button",()=>{
  assert.equal(TITLE_ART.GDR_STA_LOGO,"native-logo");
  assert.equal(TITLE_ART.GDR_STA_LOGINWINDOW,"native-login-window");
  assert.equal(TITLE_ART.GDR_BTN_OK,"login");
});
test("the title screen is separate from world terrain until manually entered",()=>{
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(html,/id="app" data-screen="login"/);
  assert.match(html,/id="native-logo"/);
  assert.match(html,/id="native-login-window"/);
  assert.match(main,/void titleArt\.load\(/);
  assert.doesNotMatch(main,/void servers\(\);void catalog\(\);/);
  assert.match(main,/data/);
});
