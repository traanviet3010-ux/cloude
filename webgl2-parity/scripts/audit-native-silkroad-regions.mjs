/*
 * Inspect the ORIGINAL prebuilt Silkroad regions, not a substitute scene.
 * Reads immutable v1.150 SROPACK2 TEST data with SHA-256 verification.
 * It does NOT render or rewrite objects, characters, animations or materials.
 */
import { createOriginalPackReader } from "../server/native-pack-reader.mjs";
const cdnBase = process.env.HIEUSRO_TEST_PACK_CDN;
const reader = createOriginalPackReader({cdnBase,cacheBudgetBytes:0});
const paths=[
 "/assets/world/constantinople/region-694e.json",
 "/assets/world/constantinople/region-6951.json",
 "/assets/world/constantinople/region-694f.json",
 "/assets/world/china/region-62a8.json"
];
let failures=0;
for(const path of paths){
 try{
   const region=await reader.json(path);
   if(region.format!=="sro-world-region-bundle"||region.version!==5||
      !region.source?.sectorId||!region.terrain?.sectors||
      !region.objects?.placements||!region.navmesh)
     throw Error("Invalid native OpenSRO region-bundle format");
   const report={
     path, format:region.format, version:region.version,
     sector:region.source.sectorId,
     terrainSectors:region.terrain.sectors.length,
     terrainBlocks:region.terrain.blockCount,
     objectPlacements:region.objects.placements.length,
     objectDefinitions:region.objects.uniqueObjectCount,
     hasNavmesh:!!region.navmesh,
     hasSky:!!region.sky||!!region.sharedRenderResourcesPublicPath,
     hasWater:!!region.water||!!region.sharedRenderResourcesPublicPath
   };
   console.log("ORIGINAL_SILKROAD_V150_REGION_CONTENT_VERIFIED",JSON.stringify(report));
 }catch(error){
   failures++;
   console.error("ORIGINAL_SILKROAD_REGION_BLOCKER",JSON.stringify({path,error:String(error)}));
 }
}
console.log("ORIGINAL_SCENE_BUNDLE_AUDIT",JSON.stringify({
 checked:paths.length,failed:failures,
 note:"Genuine prebuilt scene data only. No native WebGL2 visual/gameplay parity is implied.",
 transfer:reader.stats()
}));
if(failures)process.exitCode=1;
