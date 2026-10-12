import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readText, textDataDir, toGameRelative, publicRoot } from "../scripts/build/shared/resourceIo.mjs";
import { splitTextDataRecords } from "../scripts/build/shared/textResources.mjs";

const outputRoot = path.resolve(process.argv[2] || "/out/i18n");
const VI_COLUMN = 9; // SRO language index 5 (Vietnamese); English is column 8.
const EN_COLUMN = 8;

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

    const vi = usable(columns[VI_COLUMN]);
    const en = usable(columns[EN_COLUMN]);
    const value = (vi || en).replaceAll("\\n", "\n");
    entries[key] = value;
    if (vi) vietnamese++;
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
