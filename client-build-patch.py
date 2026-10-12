from pathlib import Path

ROOT = Path('/work/upstream')

# ---------------------------------------------------------------------------
# Font atlas: English and Vietnamese are built separately. English uses the
# user's .VnArial face with the retail Latin coverage. Vietnamese uses the
# Unicode-capable .VnTahoma face and the complete Vietnamese/combining ranges.
# ---------------------------------------------------------------------------
p = ROOT / 'scripts/build/native_ui_font_atlas.py'
s = p.read_text(encoding='utf-8')
old = 'LATIN_CODEPOINTS = range(0xA0, 0x180)'
new = '''LATIN_CODEPOINTS = (\n\ttuple(range(0xA0, 0x250)) + tuple(range(0x300, 0x370)) + tuple(range(0x1E00, 0x1F00))\n\tif os.environ.get("HIEUSRO_FONT_COVERAGE") == "vi" else range(0xA0, 0x180)\n)'''
if old not in s:
    raise SystemExit('native atlas coverage declaration changed upstream')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

# ---------------------------------------------------------------------------
# Assets: localized text and language-selected font atlas live outside the
# immutable pack. The edge chooses the language using the same-origin cookie.
# English text still falls back to the verified original pack on loose 404.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/runtime/assets/worker/loader.ts'
s = p.read_text(encoding='utf-8')
anchor = 'const DOWNLOAD_NO_PROGRESS_MS = 15000;\n'
insert = anchor + 'const HIEUSRO_LOOSE_ASSET = /^(?:\\/assets\\/text\\/(?:textuisystem|textzonename|textdataname|texthelp|messagetips)\\.en\\.json|\\/assets\\/fonts\\/native-ui-font-atlas\\.(?:json|png))$/;\n'
if anchor not in s:
    raise SystemExit('asset loader timing anchor changed upstream')
s = s.replace(anchor, insert, 1)
old_credentials = 'credentials: "omit",'
if old_credentials not in s:
    raise SystemExit('asset loader credentials declaration changed upstream')
s = s.replace(old_credentials, 'credentials: "same-origin",', 1)
packs_anchor = '\tconst packs = createPacks( download, activity );\n'
helper = packs_anchor + '''\tasync function hieusroLooseBytes( url: URL, limit: number, signal: AbortSignal ) {\n\t\ttry {\n\t\t\treturn await download( url.href, limit, signal );\n\t\t} catch ( error ) {\n\t\t\tif ( error instanceof Error && "status" in error && Number( error.status ) === 404 ) {\n\t\t\t\treturn await packs.read( url, limit, signal );\n\t\t\t}\n\t\t\tthrow error;\n\t\t}\n\t}\n'''
if packs_anchor not in s:
    raise SystemExit('asset loader packs anchor changed upstream')
s = s.replace(packs_anchor, helper, 1)
old_read = '''\t\t\t\turl.pathname.startsWith( "/assets/" ) ?\n\t\t\t\tawait packs.read( url, request.limit, controller.signal ) :\n\t\t\t\tawait download( url.href, request.limit, controller.signal );'''
new_read = '''\t\t\t\turl.pathname.startsWith( "/assets/" ) ?\n\t\t\t\t\t(HIEUSRO_LOOSE_ASSET.test( url.pathname ) ?\n\t\t\t\t\t\tawait hieusroLooseBytes( url, request.limit, controller.signal ) :\n\t\t\t\t\t\tawait packs.read( url, request.limit, controller.signal )) :\n\t\t\t\tawait download( url.href, request.limit, controller.signal );'''
if old_read not in s:
    raise SystemExit('asset loader pack dispatch changed upstream')
s = s.replace(old_read, new_read, 1)
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Static world references: resolve display names from textdataname after the
# immutable reference bytes have passed digest verification. Keep the exact
# catalogue around long enough for world.ts to localize login-only rows too.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/runtime/simulation/worker/session/http/http.ts'
s = p.read_text(encoding='utf-8')
const_anchor = 'const REFERENCE_ROWS_LIMIT = 65536;\n'
helpers = const_anchor + r'''
const HIEUSRO_NAMES_BYTES = 8 * 1024 * 1024;

async function hieusroLocalizedNames( signal: AbortSignal ): Promise<Readonly<Record<string, string>>> {
	try {
		const response = await fetch( "/assets/text/textdataname.en.json", {
			signal,
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error"
		} );
		if ( !response.ok || !response.body ) return {};
		const bytes = await readBytes( response.body, HIEUSRO_NAMES_BYTES );
		const value = JSON.parse( new TextDecoder( "utf-8", { fatal: true } ).decode( bytes ) ) as unknown;
		if ( !value || typeof value !== "object" || Array.isArray( value ) ) return {};
		const entries = (value as { entries?: unknown; }).entries;
		if ( !entries || typeof entries !== "object" || Array.isArray( entries ) ) return {};
		return Object.fromEntries(
			Object.entries( entries as Record<string, unknown> )
				.filter( ( row ): row is [ string, string ] => typeof row[1] === "string" )
		);
	} catch {
		return {};
	}
}

function hieusroReferenceSymbol( record: Record<string, unknown>, item: boolean ) {
	if ( typeof record.nameStrId === "string" && record.nameStrId.trim() ) return record.nameStrId.trim();
	if ( item && typeof record.codename === "string" && record.codename.trim() ) {
		return "SN_" + record.codename.trim();
	}
	return "";
}

function hieusroLocalizedReferences(
	rows: unknown[],
	names: Readonly<Record<string, string>>,
	item: boolean
): unknown[] {
	return rows.map( row => {
		if ( !row || typeof row !== "object" || Array.isArray( row ) ) return row;
		const record = row as Record<string, unknown>;
		const symbol = hieusroReferenceSymbol( record, item );
		const name = symbol ? names[symbol] : undefined;
		return name ? { ...record, name } : row;
	} );
}
'''
if const_anchor not in s:
    raise SystemExit('session HTTP constants changed upstream')
s = s.replace(const_anchor, helpers, 1)
return_type_old = '''\treverseMapPoints?: unknown[];\n}> {'''
return_type_new = '''\treverseMapPoints?: unknown[];\n\thieusroNames?: Readonly<Record<string, string>>;\n}> {'''
if return_type_old not in s:
    raise SystemExit('world reference return type changed upstream')
s = s.replace(return_type_old, return_type_new, 1)
return_anchor = '''\tconst reverseMapPoints = decodeReverseMapPoints( parsed.reverseMapPoints );\n\treturn {\n\t\trefSkillSnapshot: parsed.refSkillSnapshot,\n\t\trefItemSnapshot: parsed.refItemSnapshot,\n\t\trefObjSnapshot: parsed.refObjSnapshot,'''
return_replacement = '''\tconst hieusroNames = await hieusroLocalizedNames( signal );\n\tconst refItemSnapshot = hieusroLocalizedReferences( parsed.refItemSnapshot, hieusroNames, true );\n\tconst refObjSnapshot = hieusroLocalizedReferences( parsed.refObjSnapshot, hieusroNames, false );\n\tconst reverseMapPoints = decodeReverseMapPoints( parsed.reverseMapPoints );\n\treturn {\n\t\trefSkillSnapshot: parsed.refSkillSnapshot,\n\t\trefItemSnapshot,\n\t\trefObjSnapshot,\n\t\thieusroNames,'''
if return_anchor not in s:
    raise SystemExit('world references return block changed upstream')
s = s.replace(return_anchor, return_replacement, 1)
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Login-only references: the server deliberately omits published static rows
# from EnterWorld, but character-owned/peer rows are appended by world.ts.
# Localize those rows with the same exact catalogue before entities bootstrap.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/runtime/simulation/worker/session/world/world.ts'
s = p.read_text(encoding='utf-8')
const_anchor = 'const MAX_CHARACTER_NAME_LENGTH = 64;\n'
helper = const_anchor + r'''
function hieusroLocalizeReferenceRows(
	rows: unknown[],
	names: Readonly<Record<string, string>>,
	item: boolean
): unknown[] {
	return rows.map( row => {
		if ( !row || typeof row !== "object" || Array.isArray( row ) ) return row;
		const record = row as Record<string, unknown>;
		const symbol = typeof record.nameStrId === "string" && record.nameStrId.trim() ?
			record.nameStrId.trim() :
			item && typeof record.codename === "string" && record.codename.trim() ? "SN_" + record.codename.trim() : "";
		const name = symbol ? names[symbol] : undefined;
		return name ? { ...record, name } : row;
	} );
}
'''
if const_anchor not in s:
    raise SystemExit('world constants changed upstream')
s = s.replace(const_anchor, helper, 1)
sig_old = '''\t) => Promise<{ refSkillSnapshot: unknown[]; refItemSnapshot: unknown[]; refObjSnapshot: unknown[]; }>,'''
sig_new = '''\t) => Promise<{\n\t\trefSkillSnapshot: unknown[];\n\t\trefItemSnapshot: unknown[];\n\t\trefObjSnapshot: unknown[];\n\t\thieusroNames?: Readonly<Record<string, string>>;\n\t}> ,'''
if sig_old not in s:
    raise SystemExit('createWorldSession reference loader signature changed upstream')
s = s.replace(sig_old, sig_new, 1)
merge_old = '''\t\t\t\t\t\tconst own = bootstrap as { refItemSnapshot?: unknown[]; refObjSnapshot?: unknown[]; };\n\t\t\t\t\t\treferences = {\n\t\t\t\t\t\t\tkind: "ready",\n\t\t\t\t\t\t\treceivedAtMs,\n\t\t\t\t\t\t\tbootstrap: {\n\t\t\t\t\t\t\t\t...bootstrap,\n\t\t\t\t\t\t\t\t...refs,\n\t\t\t\t\t\t\t\trefItemSnapshot: [ ...refs.refItemSnapshot, ...(own.refItemSnapshot ?? []) ],\n\t\t\t\t\t\t\t\trefObjSnapshot: [ ...refs.refObjSnapshot, ...(own.refObjSnapshot ?? []) ]\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t};'''
merge_new = '''\t\t\t\t\t\tconst own = bootstrap as { refItemSnapshot?: unknown[]; refObjSnapshot?: unknown[]; };\n\t\t\t\t\t\tconst names = refs.hieusroNames ?? {};\n\t\t\t\t\t\tconst publicRefs = Object.fromEntries( Object.entries( refs ).filter( ([ key ]) => key !== "hieusroNames" ) );\n\t\t\t\t\t\tconst ownItems = hieusroLocalizeReferenceRows( own.refItemSnapshot ?? [], names, true );\n\t\t\t\t\t\tconst ownObjects = hieusroLocalizeReferenceRows( own.refObjSnapshot ?? [], names, false );\n\t\t\t\t\t\treferences = {\n\t\t\t\t\t\t\tkind: "ready",\n\t\t\t\t\t\t\treceivedAtMs,\n\t\t\t\t\t\t\tbootstrap: {\n\t\t\t\t\t\t\t\t...bootstrap,\n\t\t\t\t\t\t\t\t...publicRefs,\n\t\t\t\t\t\t\t\trefItemSnapshot: [ ...refs.refItemSnapshot, ...ownItems ],\n\t\t\t\t\t\t\t\trefObjSnapshot: [ ...refs.refObjSnapshot, ...ownObjects ]\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t};'''
if merge_old not in s:
    raise SystemExit('world reference merge block changed upstream')
s = s.replace(merge_old, merge_new, 1)
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Monster/NPC create packets carry the server's authored English display name
# in mask bit 0. Prefer the already-localized reference name for static actors;
# keep dynamic COS/player names untouched.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/runtime/simulation/worker/session/world/entities/entities.ts'
s = p.read_text(encoding='utf-8')
old = '''\t\tconst entity = decodeCharacterSpawn( p, ref.kind, ref.tidWord, frame.opcode === 0x30d7, skillRefs );\n\t\treturn { kind: "spawn", entity: { ...ref, ...entity, name: entity.name || ref.name || "" } };'''
new = '''\t\tconst entity = decodeCharacterSpawn( p, ref.kind, ref.tidWord, frame.opcode === 0x30d7, skillRefs );\n\t\tconst referenceName = (ref.kind === "monster" || ref.kind === "npc") && ref.name ? ref.name : "";\n\t\treturn { kind: "spawn", entity: { ...ref, ...entity, name: referenceName || entity.name || ref.name || "" } };'''
if old not in s:
    raise SystemExit('character spawn reference-name merge changed upstream')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

print('HieuSRO client localization/font patches installed')
