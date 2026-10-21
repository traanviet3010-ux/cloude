/*
 * Inspect existing isolated HieuSRO v1.150 SROPACK2 CDN without loading
 * multi-GB packs or copying licensed art to GitHub. Verify real title and
 * character dock references, not invented placeholders.
 */
const base=process.env.HIEUSRO_TEST_PACK_CDN;
if(!base||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(base))
  throw Error("Specify the existing isolated HTTPS TEST asset CDN");
const rsp=await fetch(base+"/assets/packs/manifest.json",
  {signal:AbortSignal.timeout(30000),headers:{Accept:"application/json"}});
if(!rsp.ok)throw Error("Existing SROPACK2 TEST manifest HTTP "+rsp.status);
const text=await rsp.text();
if(text.length>28*1024*1024)throw Error("TEST pack manifest over safe audit limit");
const j=JSON.parse(text);
if(j.version!==2||!Array.isArray(j.assets)||!Array.isArray(j.groups))
  throw Error("Invalid HieuSRO TEST SROPACK2 catalog");
const paths=new Set(j.assets.map(x=>String(x.path).toLowerCase()));
const names=[
 "/assets/title/constantinople/manifest.json",
 "/assets/character-select/world-manifest.json",
 "/assets/character-select/create-world-europe-manifest.json",
 "/assets/character-select/create-world-china-manifest.json"
];
const rows=names.map(path=>({path,
  present:paths.has(path)||paths.has(path+".gz")}));
for(const row of rows)console.log("AUTHENTIC_TEST_SROPACK2_ASSET",JSON.stringify(row));
const metadata={
  groups:j.groups.length,
  packs:j.groups.reduce((n,g)=>n+(g.packs?.length??0),0),
  assets:j.assets.length,
  nativeTitleAssets:j.assets.filter(x=>String(x.path).startsWith("/assets/title/")).length,
  nativeCreateAssets:j.assets.filter(x=>String(x.path).startsWith("/assets/character-select/")).length,
  all4Present:rows.every(x=>x.present)
};
console.log("HIEUSRO_TEST_SROPACK2_CATALOG",JSON.stringify(metadata));
if(!metadata.all4Present){
 console.error("TEST_PACK_TITLE_CHARACTER_MANIFESTS_INCOMPLETE; rebuild from licensed v1.150 PK2 before expecting original retail screens");
 process.exitCode=1;
}
