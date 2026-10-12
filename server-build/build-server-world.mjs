// Build only the authoritative world inputs required by server.srogz.
// This intentionally does not compile browser-only NPC/cosmetic GLBs.
import {
  buildAuthoredWorldRegionResources,
  buildWorldRegionCatalog,
  loadOutdoorWorldRegionResourceGroup
} from "/src/opensro/scripts/build/world/index.mjs";

const authored = await buildAuthoredWorldRegionResources();
const outdoor = await loadOutdoorWorldRegionResourceGroup({ allowDevOnDemand: false });
if (!outdoor) throw new Error("Outdoor world resource group is missing");
if ((outdoor.incompleteBundleCount ?? 0) !== 0) {
  throw new Error(`Outdoor world has ${outdoor.incompleteBundleCount} missing bundle(s)`);
}
const catalog = await buildWorldRegionCatalog([authored, outdoor]);
console.log("[server-world] authoritative world catalogue built", {
  authored: authored.regionCount,
  outdoor: outdoor.regionCount,
  catalogRegions: catalog.regionCount,
  catalogEntries: catalog.entryCount
});
