import ts from "typescript";
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
const original=process.env.SRO_SOURCE_ROOT;
if(!original||!resolve(original).includes("opensro-original"))
  throw Error("Pinned original OpenSRO checkout required");
const parse=(path)=>{const source=readFileSync(path,"utf8");
  return ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);};
const typeTree=parse(join(original,"apps/client-next/src/engine/contracts/runtime.ts"));
const contract=typeTree.statements.find(s=>ts.isInterfaceDeclaration(s)&&s.name.text==="Renderer");
if(!contract)throw Error("Pinned original Renderer contract absent");
const required=new Set(contract.members.filter(m=>!m.questionToken).map(m=>m.name?.getText(typeTree)).filter(Boolean));
required.add("dispose");
const candidateTree=parse(new URL("../src/original-webgl2-compositor.ts",import.meta.url).pathname);
const owner=candidateTree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==="createOriginalSilkroadWebgl2");
if(!owner)throw Error("WebGL2 original compositor source absent");
const returns=owner.body?.statements.filter(ts.isReturnStatement)??[];
if(returns.length!==1||!ts.isObjectLiteralExpression(returns[0].expression))
 throw Error("No unique native WebGL2 renderer object implementation");
const names=new Set(returns[0].expression.properties.map(p=>p.name?.getText(candidateTree)).filter(Boolean));
const missing=[...required].filter(k=>!names.has(k)).sort();
const present=[...required].filter(k=>names.has(k)).sort();
const report={originalRendererRequiredMethods:required.size,
 currentWebgl2SameNameMethods:present.length,missingMethods:missing,
 complete:false, // even same-named methods still require semantic and signature parity
 note:"Method-name audit is an upper bound. Actual TypeScript Renderer type and GameWorld integration must pass before release."};
console.log("HIEUSRO_ORIGINAL_RENDERER_BINDING_AUDIT",JSON.stringify(report));
if(missing.length && process.env.HIEUSRO_REQUIRE_PLAYABLE==="1"){
 console.error("BLOCKED: WebGL2 owner does not implement the original game Renderer. Never publish a playable URL.");
 process.exitCode=1;
}
