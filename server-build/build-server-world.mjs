// Build only the authoritative world inputs required by server.srogz.
// This intentionally does not compile browser-only NPC/cosmetic GLBs.
import { readFileSync, writeFileSync } from "node:fs";
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

// HieuSRO localization contract: item references must publish the authored
// textdataname symbol exactly, just like monster references already publish
// nameStrId. The browser can then select Vietnamese/English after the immutable
// reference bytes pass digest verification instead of guessing SN_ + codename.
const responsePath = "/src/opensro/apps/server/internal/game/enterworld/response.go";
let response = readFileSync(responsePath, "utf8");
const responseOld = `\tTypeFlags                  uint16       \`json:"typeFlags"\`\n\tCodename                   string       \`json:"codename"\`\n\tKind                       string       \`json:"kind"\`\n\tName                       string       \`json:"name"\``;
const responseNew = `\tTypeFlags                  uint16       \`json:"typeFlags"\`\n\tCodename                   string       \`json:"codename"\`\n\tNameStrID                  string       \`json:"nameStrId,omitempty"\`\n\tKind                       string       \`json:"kind"\`\n\tName                       string       \`json:"name"\``;
if (!response.includes(responseOld)) {
  throw new Error("RefItemRow schema anchor changed upstream");
}
response = response.replace(responseOld, responseNew);
writeFileSync(responsePath, response, "utf8");

const bootstrapPath = "/src/opensro/apps/server/internal/game/enterworld/bootstrap.go";
let bootstrap = readFileSync(bootstrapPath, "utf8");
const bootstrapOld = `\t\tTypeFlags:    flags,\n\t\tCodename:     row.Codename,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n\t\tNativeFields: row.NativeFields,`;
const bootstrapNew = `\t\tTypeFlags:    flags,\n\t\tCodename:     row.Codename,\n\t\tNameStrID:    row.NameStrID,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n\t\tNativeFields: row.NativeFields,`;
if (!bootstrap.includes(bootstrapOld)) {
  throw new Error("RefItemRow collector anchor changed upstream");
}
bootstrap = bootstrap.replace(bootstrapOld, bootstrapNew);
writeFileSync(bootstrapPath, bootstrap, "utf8");
console.log("[hieusro-i18n] item nameStrId reference projection installed");
