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

const ONE = new Map();
const TWO = new Map();
for (let i = 0; i < TCVN3.length; i++) {
  (TCVN3[i].length === 2 ? TWO : ONE).set(TCVN3[i], UNICODE[i]);
}

// Characters that are a strong signal for old ABC/TCVN3 text but are very
// uncommon in normal Unicode Vietnamese prose. We score a whole catalogue so
// a legitimate ©/® in one English fallback row cannot trigger conversion.
const STRONG = /[µ¶¹¨¾»¼½Æ©®×ß«¤¥¦Þþ]/g;

export function tcvn3ToUnicode(value) {
  const text = String(value ?? "");
  let out = "";
  for (let i = 0; i < text.length;) {
    const pair = i + 1 < text.length ? text.slice(i, i + 2) : "";
    if (pair && TWO.has(pair)) {
      out += TWO.get(pair);
      i += 2;
      continue;
    }
    const one = text[i];
    out += ONE.get(one) ?? one;
    i += 1;
  }
  return out.normalize("NFC");
}

export function catalogueLooksTcvn3(entries) {
  if (!entries || typeof entries !== "object") return false;
  let score = 0;
  let sampled = 0;
  for (const value of Object.values(entries)) {
    if (typeof value !== "string") continue;
    sampled++;
    score += (value.match(STRONG) || []).length;
    if (score >= 6) return true;
    if (sampled >= 600) break;
  }
  return false;
}

export function normalizeVietnameseCatalogue(document) {
  if (!document?.entries || !catalogueLooksTcvn3(document.entries)) return document;
  return {
    ...document,
    encoding: "unicode-nfc",
    entries: Object.fromEntries(
      Object.entries(document.entries).map(([key, value]) => [
        key,
        typeof value === "string" ? tcvn3ToUnicode(value) : value
      ])
    )
  };
}
