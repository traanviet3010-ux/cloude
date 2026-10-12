import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readText, textDataDir, toGameRelative, publicRoot } from "../scripts/build/shared/resourceIo.mjs";
import { splitTextDataRecords } from "../scripts/build/shared/textResources.mjs";

const outputRoot = path.resolve(process.argv[2] || "/out/i18n");
const VI_COLUMN = 9; // SRO language index 5 (Vietnamese); English is column 8.
const EN_COLUMN = 8;

// Silkroad v1.150 Vietnamese resources use the legacy TCVN3/ABC character map.
// Convert only strings that actually came from the Vietnamese column; English
// fallback rows are already Unicode/ASCII and must not be touched.
const UNICODE = [
  "À","Á","Â","Ã","È","É","Ê","Ì","Í","Ò","Ó","Ô","Õ","Ù","Ú","Ý",
  "à","á","â","ã","è","é","ê","ì","í","ò","ó","ô","õ","ù","ú","ý",
  "Ă","ă","Đ","đ","Ĩ","ĩ","Ũ","ũ","Ơ","ơ","Ư","ư","Ạ","ạ","Ả","ả",
  "Ấ","ấ","Ầ","ầ","Ẩ","ẩ","Ẫ","ẫ","Ậ","ậ","Ắ","ắ","Ằ","ằ","Ẳ","ẳ",
  "Ẵ","ẵ","Ặ","ặ","Ẹ","ẹ","Ẻ","ẻ","Ẽ","ẽ","Ế","ế","Ề","ề","Ể","ể",
  "Ễ","ễ","Ệ","ệ","Ỉ","ỉ","Ị","ị","Ọ","ọ","Ỏ","ỏ","Ố","ố","Ồ","ồ",
  "Ổ","ổ","Ỗ","ỗ","Ộ","ộ","Ớ","ớ","Ờ","ờ","Ở","ở","Ỡ","ỡ","Ợ","ợ",
  "Ụ","ụ","Ủ","ủ","Ứ","ứ","Ừ","ừ","Ử","ử","Ữ","ữ","Ự","ự","Ỳ","ỳ",
  "Ỵ","ỵ","Ỷ","ỷ","Ỹ","ỹ"
];
const TCVN3 = [
  "Aµ","A¸","¢","A·","EÌ","EÐ","£","I×","IÝ","Oß","Oã","¤","Oâ","Uï","Uó","Yý",
  "µ","¸","©","·","Ì","Ð","ª","×","Ý","ß","ã","«","â","ï","ó","ý",
  "¡","¨","§","®","IÜ","Ü","Uò","ò","¥","¬","¦","­","A¹","¹","A¶","¶",
  "¢Ê","Ê","¢Ç","Ç","¢È","È","¢É","É","¢Ë","Ë","¡¾","¾","¡»","»","¡¼","¼",
  "¡½","½","¡Æ","Æ","EÑ","Ñ","EÎ","Î","EÏ","Ï","£Õ","Õ","£Ò","Ò","£Ó","Ó",
  "£Ô","Ô","£Ö","Ö","IØ","Ø","IÞ","Þ","Oä","ä","Oá","á","¤è","è","¤å","å",
  "¤æ","æ","¤ç","ç","¤é","é","¥í","í","¥ê","ê","¥ë","ë","¥ì","ì","¥î","î",
  "Uô","ô","Uñ","ñ","¦ø","ø","¦õ","õ","¦ö","ö","¦÷","÷","¦ù","ù","Yú","ú",
  "Yþ","þ","Yû","û","Yü","ü"
];
if (UNICODE.length !== TCVN3.length) throw new Error("TCVN3 map length mismatch");
const TCVN3_ONE = new Map();
const TCVN3_TWO = new Map();
for (let i = 0; i < TCVN3.length; i++) {
  (TCVN3[i].length === 2 ? TCVN3_TWO : TCVN3_ONE).set(TCVN3[i], UNICODE[i]);
}
function tcvn3ToUnicode(value) {
  let out = "";
  for (let i = 0; i < value.length;) {
    const pair = i + 1 < value.length ? value.slice(i, i + 2) : "";
    if (pair && TCVN3_TWO.has(pair)) {
      out += TCVN3_TWO.get(pair);
      i += 2;
      continue;
    }
    const one = value[i];
    out += TCVN3_ONE.get(one) ?? one;
    i += 1;
  }
  return out.normalize("NFC");
}

function usable(value) {
  const text = String(value ?? "").trim();
  return text && text !== "0" ? text : "";
}

async function catalog(stem) {
  const sourcePath = path.join(textDataDir, `${stem}.txt`);
  const raw = await readText(sourcePath);
  const entries = {};
  let vietnamese = 0;
  let englishFallback = 0;

  for (const record of splitTextDataRecords(raw)) {
    if (!record.trim() || record.trim().startsWith("//")) continue;
    const columns = record.split("\t");
    const key = columns[1]?.trim();
    if (!key || key.startsWith("//")) continue;

    const viRaw = usable(columns[VI_COLUMN]);
    const en = usable(columns[EN_COLUMN]);
    const value = (viRaw ? tcvn3ToUnicode(viRaw) : en).replaceAll("\\n", "\n");
    entries[key] = value;
    if (viRaw) vietnamese++;
    else if (en) englishFallback++;
  }

  return {
    data: {
      sourcePath: toGameRelative(sourcePath),
      language: "vi",
      fallbackLanguage: "en",
      entries
    },
    stats: { vietnamese, englishFallback, total: Object.keys(entries).length }
  };
}

function localizeMessageTips(value, helpEntries) {
  const localizeRow = row => {
    if (!row || typeof row !== "object" || typeof row.textKey !== "string") return;
    const vi = helpEntries[row.textKey];
    if (typeof vi === "string" && vi) row.text = vi;
  };
  for (const row of value.rows ?? []) localizeRow(row);
  for (const row of Object.values(value.rowsById ?? {})) localizeRow(row);
  for (const row of Object.values(value.rowsByTextKey ?? {})) localizeRow(row);
  value.language = "vi";
  value.fallbackLanguage = "en";
  return value;
}

await mkdir(outputRoot, { recursive: true });
const stems = ["textuisystem", "textzonename", "textdataname", "texthelp"];
const built = new Map();
for (const stem of stems) {
  const result = await catalog(stem);
  built.set(stem, result.data);
  await writeFile(
    path.join(outputRoot, `${stem}.vi.json`),
    JSON.stringify(result.data) + "\n",
    "utf8"
  );
  console.log(`HieuSRO i18n ${stem}: vi=${result.stats.vietnamese}, en-fallback=${result.stats.englishFallback}, total=${result.stats.total}`);
}

try {
  const source = path.join(publicRoot, "assets", "text", "messagetips.en.json");
  const tips = JSON.parse(await readFile(source, "utf8"));
  const localized = localizeMessageTips(tips, built.get("texthelp").entries);
  await writeFile(path.join(outputRoot, "messagetips.vi.json"), JSON.stringify(localized) + "\n", "utf8");
  console.log(`HieuSRO i18n messagetips: ${localized.rows?.length ?? 0} rows`);
} catch (error) {
  console.warn(`HieuSRO i18n messagetips skipped: ${error.message}`);
}

// Preserve the exact localization symbol on every item reference sent to the
// browser. OpenSRO already keeps ItemRef.NameStrID internally, but RefItemRow
// previously dropped it and forced the browser to keep the server's English
// presentation name. HieuSRO needs the symbol so both public and login-only
// item rows can resolve through the selected textdataname catalogue.
const enterworldRoot = path.resolve("apps/server/internal/game/enterworld");
{
  const file = path.join(enterworldRoot, "response.go");
  let source = await readFile(file, "utf8");
  const before = '\tCodename                   string       `json:"codename"`\n\tKind                       string       `json:"kind"`\n\tName                       string       `json:"name"`\n';
  const after = '\tCodename                   string       `json:"codename"`\n\tNameStrID                  string       `json:"nameStrId,omitempty"`\n\tKind                       string       `json:"kind"`\n\tName                       string       `json:"name"`\n';
  if (!source.includes(before)) throw new Error("RefItemRow shape changed upstream");
  source = source.replace(before, after);
  await writeFile(file, source, "utf8");
}
{
  const file = path.join(enterworldRoot, "bootstrap.go");
  let source = await readFile(file, "utf8");
  const before = '\t\tCodename:     row.Codename,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n';
  const after = '\t\tCodename:     row.Codename,\n\t\tNameStrID:    row.NameStrID,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n';
  if (!source.includes(before)) throw new Error("refItemCollector projection changed upstream");
  source = source.replace(before, after);
  await writeFile(file, source, "utf8");
}
console.log("HieuSRO i18n: exact item nameStrId projection installed");
