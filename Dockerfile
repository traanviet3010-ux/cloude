FROM node:24-bookworm AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pil fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /work
ARG OPENSRO_REF=4f6919d6900d169b89e75647e56c99ca8ebd5cfb
RUN git clone https://github.com/opensro-dev/opensro.git upstream \
 && cd upstream \
 && git checkout "$OPENSRO_REF" \
 && corepack pnpm install --frozen-lockfile

# Keep full Vietnamese Unicode coverage, but do not synthesize extra stroke width.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/work/upstream/scripts/build/native_ui_font_atlas.py')
s = p.read_text(encoding='utf-8')
old = 'LATIN_CODEPOINTS = range(0xA0, 0x180)'
new = 'LATIN_CODEPOINTS = tuple(range(0xA0, 0x250)) + tuple(range(0x300, 0x370)) + tuple(range(0x1E00, 0x1F00))'
if old not in s:
    raise SystemExit('native atlas coverage declaration changed upstream')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
PY

# Localized text and the expanded font atlas are same-origin loose resources.
# English text falls back to the original verified pack when no loose file exists.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/work/upstream/apps/client-next/src/engine/runtime/assets/worker/loader.ts')
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
p.write_text(s.replace(old_read, new_read, 1), encoding='utf-8')
PY

# Game references contain English display names. Replace only their presentation
# names after the signed/static reference bytes pass digest verification, using
# the currently selected textdataname catalogue. Switching language therefore
# keeps both monster/NPC and item/equipment names in sync without touching IDs.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/work/upstream/apps/client-next/src/engine/runtime/simulation/worker/session/http/http.ts')
s = p.read_text(encoding='utf-8')
const_anchor = 'const REFERENCE_ROWS_LIMIT = 65536;\n'
helpers = const_anchor + r'''
const HIEUSRO_NAMES_BYTES = 8 * 1024 * 1024;

async function hieusroLocalizedNames( signal: AbortSignal ): Promise<ReadonlyMap<string, string>> {
	try {
		const response = await fetch( "/assets/text/textdataname.en.json", {
			signal,
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error"
		} );
		if ( !response.ok || !response.body ) return new Map();
		const bytes = await readBytes( response.body, HIEUSRO_NAMES_BYTES );
		const value = JSON.parse( new TextDecoder( "utf-8", { fatal: true } ).decode( bytes ) ) as unknown;
		if ( !value || typeof value !== "object" || Array.isArray( value ) ) return new Map();
		const entries = (value as { entries?: unknown; }).entries;
		if ( !entries || typeof entries !== "object" || Array.isArray( entries ) ) return new Map();
		return new Map(
			Object.entries( entries as Record<string, unknown> )
				.filter( ( row ): row is [ string, string ] => typeof row[1] === "string" )
		);
	} catch {
		return new Map();
	}
}

function hieusroLocalizedReferences(
	rows: unknown[],
	names: ReadonlyMap<string, string>,
	item: boolean
): unknown[] {
	return rows.map( row => {
		if ( !row || typeof row !== "object" || Array.isArray( row ) ) return row;
		const record = row as Record<string, unknown>;
		const symbol = typeof record.nameStrId === "string" ?
			record.nameStrId :
			item && typeof record.codename === "string" ? "SN_" + record.codename : "";
		const name = symbol ? names.get( symbol ) : undefined;
		return name ? { ...record, name } : row;
	} );
}
'''
if const_anchor not in s:
    raise SystemExit('session HTTP constants changed upstream')
s = s.replace(const_anchor, helpers, 1)
return_anchor = '''\tconst reverseMapPoints = decodeReverseMapPoints( parsed.reverseMapPoints );\n\treturn {\n\t\trefSkillSnapshot: parsed.refSkillSnapshot,\n\t\trefItemSnapshot: parsed.refItemSnapshot,\n\t\trefObjSnapshot: parsed.refObjSnapshot,'''
return_replacement = '''\tconst localizedNames = await hieusroLocalizedNames( signal );\n\tconst refItemSnapshot = hieusroLocalizedReferences( parsed.refItemSnapshot, localizedNames, true );\n\tconst refObjSnapshot = hieusroLocalizedReferences( parsed.refObjSnapshot, localizedNames, false );\n\tconst reverseMapPoints = decodeReverseMapPoints( parsed.reverseMapPoints );\n\treturn {\n\t\trefSkillSnapshot: parsed.refSkillSnapshot,\n\t\trefItemSnapshot,\n\t\trefObjSnapshot,'''
if return_anchor not in s:
    raise SystemExit('world references return block changed upstream')
p.write_text(s.replace(return_anchor, return_replacement, 1), encoding='utf-8')
PY

RUN cd /work/upstream \
 && corepack pnpm --filter @sro/client-next build \
 && mkdir -p apps/client-next/temp/artifacts/dist/assets/fonts \
 && SRO_FONT_ARIAL=/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf \
    SRO_FONT_ARIAL_BOLD=/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf \
    python3 scripts/build/native_ui_font_atlas.py \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.json \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.png

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY edge.mjs /app/edge.mjs
COPY tcvn3.mjs /app/tcvn3.mjs
COPY --from=build /work/upstream/apps/client-next/temp/artifacts/dist /app/public
COPY hieusro-language.js /app/public/hieusro-language.js
RUN grep -q '</body>' /app/public/index.html \
 && sed -i 's#</body>#<script src="/hieusro-language.js"></script></body>#' /app/public/index.html \
 && grep -q 'hieusro-language.js' /app/public/index.html
EXPOSE 10000
CMD ["node", "/app/edge.mjs"]