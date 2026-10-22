/*
 * Proof that the genuine TEST SROPACK2 index contains readable native
 * StageManifest JSON and its referenced scene bundle for all four scenes.
 * Integrity-checks original member SHA256 from the CDN's exact HTTP ranges.
 */
import {createOriginalPackReader} from "../server/native-pack-reader.mjs";
const reader=createOriginalPackReader({
 cdnBase:process.env.HIEUSRO_TEST_PACK_CDN,
 cacheBudgetBytes:64*1024*1024
});
const names=[
 "/assets/title/constantinople/manifest.json",
 "/assets/character-select/world-manifest.json",
 "/assets/character-select/create-world-europe-manifest.json",
 "/assets/character-select/create-world-china-manifest.json"
];
const catalog=await reader.catalog();
for(const path of names){
 const manifest=await reader.json(path);
 if(typeof manifest.regionBundlePublicPath!=="string"||
   !Array.isArray(manifest.camera)||!manifest.camera.length||
   !manifest.camera.every(k=>Number.isFinite(k.timeSeconds)))
   throw Error("Native v1.150 StageManifest invalid: "+path);
 const exists=await reader.has(manifest.regionBundlePublicPath);
 console.log("NATIVE_SILKROAD_TEST_SCENE_VERIFIED",JSON.stringify({
   path,cameraKeyframes:manifest.camera.length,
   nativeBundle:manifest.regionBundlePublicPath,
   bundlePresent:exists
 }));
 if(!exists)throw Error("Native bundle missing from SROPACK2: "+manifest.regionBundlePublicPath);
}
console.log("AUTHENTIC_TEST_SROPACK2_STAGE_MANIFESTS_AND_BUNDLES_OK",
 JSON.stringify({...catalog,reader:reader.stats()}));
