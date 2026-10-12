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