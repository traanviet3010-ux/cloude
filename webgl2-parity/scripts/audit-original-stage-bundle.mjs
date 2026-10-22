/*
 * Inspect one REAL licensed SRO v1.150 Constantinople stage bundle to determine
 * which ORIGINAL renderer materials remain unsupported by WebGL2. Never emit
 * mesh vertices, art bytes or generated impostor scenes.
 */
import {createOriginalPackReader} from "../server/native-pack-reader.mjs";
const reader=createOriginalPackReader({
 cdnBase:process.env.HIEUSRO_TEST_PACK_CDN,
 cacheBudgetBytes:0
});
const path="/assets/world/constantinople/region-694e.json";
const raw=await reader.json(path);
const shape=(value)=>value&&typeof value==="object"?
  (Array.isArray(value)?"array("+value.length+")":Object.keys(value).slice(0,36)):typeof value;
const sections=Object.fromEntries(Object.entries(raw).slice(0,45)
  .map(([key,value])=>[key,shape(value)]));
const groups=Array.isArray(raw.groups)?raw.groups:
  Array.isArray(raw.scene?.groups)?raw.scene.groups:
  Array.isArray(raw.world?.groups)?raw.world.groups:null;
const counts={lit:0,unlit:0,textureStages:0,sky:0,terrain:0,lightmap:0,
  water:0,animated:0,withNormals:0,withTexture:0};
if(groups)for(const g of groups){
 const material=g.material??g.geometry?.material??{};
 if(material.unlit===false)counts.lit++;else counts.unlit++;
 if(material.textureStage)counts.textureStages++;
 if(material.sky)counts.sky++;
 if(material.terrain)counts.terrain++;
 if(material.lightmap)counts.lightmap++;
 if(material.water)counts.water++;
 if(g.animation)counts.animated++;
 if(g.geometry?.normals)counts.withNormals++;
 if(material.texture)counts.withTexture++;
}
const output={path,rootFields:sections,worldGroups:groups?.length??null,
 materialFlags:groups?counts:null,packReads:reader.stats()};
console.log("ORIGINAL_REAL_CONSTANTINOPLE_BUNDLE_AUDIT",JSON.stringify(output));
if(!raw||typeof raw!=="object")throw Error("Original real SRO stage bundle schema invalid");
