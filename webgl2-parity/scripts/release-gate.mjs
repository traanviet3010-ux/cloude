import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const path=resolve(process.cwd(),"webgl2-parity/acceptance.json");
const data=JSON.parse(readFileSync(path,"utf8"));
const expected="4f6919d6900d169b89e75647e56c99ca8ebd5cfb";
if(data.upstreamCommit!==expected||data.branch!=="hieusro-original-webgl2-parity")
  throw Error("Original HieuSRO GPU baseline changed unexpectedly");
const problems=[];
for(const item of data.components){
  if(item.status!=="verified"||typeof item.evidence!=="string"||!/^https:\/\/github\.com\/traanviet3010-ux\/cloude\/actions\/runs\/[0-9]+$/.test(item.evidence)){
    problems.push(item.id+" ("+item.status+")");
  }
}
if(data.releaseEligible!==true||problems.length){
  console.error("HIEUSRO_WEBGL2_FULL_PARITY_NOT_APPROVED");
  console.error("Blocked subsystems: "+problems.join(", "));
  console.error("No Render deploy, no LIVE changes, no auto-merge.");
  process.exitCode=1;
}else console.log("HIEUSRO_WEBGL2_PARITY_MANIFEST_VERIFIED");
