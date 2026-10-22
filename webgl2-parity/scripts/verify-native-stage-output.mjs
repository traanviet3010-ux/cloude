/*
 * Verify real OpenSRO-generated v1.150 intro, dock, and both creation scenes.
 * Fails closed on missing/empty/out-of-tree resources. Never writes assets.
 */
import {readFile,stat,realpath} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {createHash} from "node:crypto";
const base=process.argv[2];
if(!base||!resolve(base).includes("test"))
  throw Error("Only isolated TEST generated client-public paths are accepted");
const root=await realpath(base);
const list=[
 "title/constantinople/manifest.json",
 "character-select/world-manifest.json",
 "character-select/create-world-europe-manifest.json",
 "character-select/create-world-china-manifest.json"
];
async function readAsset(asset){
  if(!/^\/assets\/[A-Za-z0-9/_.-]+$/.test(asset)||asset.includes(".."))
    throw Error("Untrusted generated native asset path: "+asset);
  const candidate=join(root,asset.slice(1));
  const file=await realpath(candidate);
  if(!file.startsWith(root+sep))
    throw Error("Native asset resolves outside isolated TEST root: "+asset);
  const info=await stat(file);
  if(!info.isFile()||info.size<=0||info.size>250*1024*1024)
    throw Error("Missing/corrupt native stage output: "+asset);
  return {bytes:info.size,path:file};
}
const results=[];
for(const name of list){
  const manifest=await readAsset("/assets/"+name);
  const data=await readFile(manifest.path);
  const body=JSON.parse(data.toString("utf8"));
  if(!Array.isArray(body.camera)||!body.camera.length||
    !body.camera.every(c=>Number.isFinite(c.timeSeconds))||
    typeof body.regionBundlePublicPath!=="string")
      throw Error("Generated stage has no authentic camera/bundle: "+name);
  const bundle=await readAsset(body.regionBundlePublicPath);
  const entry={stage:name,cameraKeyframes:body.camera.length,
    manifestBytes:manifest.bytes,bundleBytes:bundle.bytes,
    manifestSHA256:createHash("sha256").update(data).digest("hex"),
    bundlePath:body.regionBundlePublicPath};
  results.push(entry);
  console.log("AUTHENTIC_SILKROAD_V150_STAGE_VERIFIED",JSON.stringify(entry));
}
console.log("AUTHENTIC_SILKROAD_V150_ALL_FOUR_STAGE_MANIFESTS_VERIFIED=1");
console.log("This proves only local scene resource generation; full WebGL2 gameplay still requires renderer and GameWorld testing.");
