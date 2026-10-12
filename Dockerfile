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

# The upstream atlas covers Western/central European Latin only. Extend it with
# Latin Extended-B and Latin Extended Additional so Vietnamese precomposed
# characters (ơ, ư, ấ, ộ, ễ, ỳ...) render instead of missing-glyph boxes.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/work/upstream/scripts/build/native_ui_font_atlas.py')
s = p.read_text(encoding='utf-8')
old = 'LATIN_CODEPOINTS = range(0xA0, 0x180)'
new = 'LATIN_CODEPOINTS = tuple(range(0xA0, 0x250)) + tuple(range(0x1E00, 0x1F00))'
if old not in s:
    raise SystemExit('native atlas coverage declaration changed upstream')
p.write_text(s.replace(old, new), encoding='utf-8')
PY

# HieuSRO localization: Vietnamese catalogs are served as same-origin loose
# resources by our edge. English remains native OpenSRO data inside verified
# packs. The worker first tries the loose route and, on a 404 (English), falls
# back to the original pack reader. This keeps both languages switchable.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/work/upstream/apps/client-next/src/engine/runtime/assets/worker/loader.ts')
s = p.read_text(encoding='utf-8')
anchor = 'const DOWNLOAD_NO_PROGRESS_MS = 15000;\n'
insert = anchor + 'const HIEUSRO_LOOSE_LOCALIZED_TEXT = /^\\/assets\\/text\\/(?:textuisystem|textzonename|textdataname|texthelp|messagetips)\\.en\\.json$/;\n'
if anchor not in s:
    raise SystemExit('asset loader timing anchor changed upstream')
s = s.replace(anchor, insert, 1)
old_credentials = 'credentials: "omit",'
if old_credentials not in s:
    raise SystemExit('asset loader credentials declaration changed upstream')
s = s.replace(old_credentials, 'credentials: "same-origin",', 1)

packs_anchor = '\tconst packs = createPacks( download, activity );\n'
helper = packs_anchor + '''\tasync function hieusroLocalizedBytes( url: URL, limit: number, signal: AbortSignal ) {\n\t\ttry {\n\t\t\treturn await download( url.href, limit, signal );\n\t\t} catch ( error ) {\n\t\t\tif ( error instanceof Error && "status" in error && Number( error.status ) === 404 ) {\n\t\t\t\treturn await packs.read( url, limit, signal );\n\t\t\t}\n\t\t\tthrow error;\n\t\t}\n\t}\n'''
if packs_anchor not in s:
    raise SystemExit('asset loader packs anchor changed upstream')
s = s.replace(packs_anchor, helper, 1)

old_read = '''\t\t\t\turl.pathname.startsWith( "/assets/" ) ?\n\t\t\t\tawait packs.read( url, request.limit, controller.signal ) :\n\t\t\t\tawait download( url.href, request.limit, controller.signal );'''
new_read = '''\t\t\t\turl.pathname.startsWith( "/assets/" ) ?\n\t\t\t\t\t(HIEUSRO_LOOSE_LOCALIZED_TEXT.test( url.pathname ) ?\n\t\t\t\t\t\tawait hieusroLocalizedBytes( url, request.limit, controller.signal ) :\n\t\t\t\t\t\tawait packs.read( url, request.limit, controller.signal )) :\n\t\t\t\tawait download( url.href, request.limit, controller.signal );'''
if old_read not in s:
    raise SystemExit('asset loader pack dispatch changed upstream')
s = s.replace(old_read, new_read, 1)
p.write_text(s, encoding='utf-8')
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
COPY --from=build /work/upstream/apps/client-next/temp/artifacts/dist /app/public
COPY hieusro-language.js /app/public/hieusro-language.js
RUN grep -q '</body>' /app/public/index.html \
 && sed -i 's#</body>#<script src="/hieusro-language.js"></script></body>#' /app/public/index.html \
 && grep -q 'hieusro-language.js' /app/public/index.html
EXPOSE 10000
CMD ["node", "/app/edge.mjs"]