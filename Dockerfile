FROM node:24-bookworm AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl python3 python3-pil python3-pip fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m pip install --break-system-packages --no-cache-dir gdown
RUN corepack enable
WORKDIR /work
ARG OPENSRO_REF=4f6919d6900d169b89e75647e56c99ca8ebd5cfb
RUN git clone https://github.com/opensro-dev/opensro.git upstream \
 && cd upstream \
 && git checkout "$OPENSRO_REF" \
 && corepack pnpm install --frozen-lockfile

COPY client-build-patch.py /work/client-build-patch.py
COPY client-font-hybrid-patch.py /work/client-font-hybrid-patch.py
RUN python3 /work/client-build-patch.py \
 && python3 /work/client-font-hybrid-patch.py

# User-supplied Silkroad fonts. English uses VNARIAL; Vietnamese uses the
# Unicode-capable VNTAHOMA for the whole atlas. No synthetic embolden pass.
RUN mkdir -p /work/fonts \
 && python3 -m gdown 1SBqo5JNUSVocPrJrdr3gmhLYM-NT5U0i -O /work/fonts/VNARIAL.ttf \
 && python3 -m gdown 19F_QwaiCm80TF-qJJ8j9uRnTIQvxFYBP -O /work/fonts/VNTAHOMA.TTF \
 && test "$(stat -c%s /work/fonts/VNARIAL.ttf)" = "52108" \
 && test "$(stat -c%s /work/fonts/VNTAHOMA.TTF)" = "316388"

RUN cd /work/upstream \
 && corepack pnpm --filter @sro/client-next build \
 && mkdir -p apps/client-next/temp/artifacts/dist/assets/fonts \
 && HIEUSRO_FONT_COVERAGE=en \
    SRO_FONT_ARIAL=/work/fonts/VNARIAL.ttf \
    SRO_FONT_ARIAL_BOLD=/work/fonts/VNARIAL.ttf \
    python3 scripts/build/native_ui_font_atlas.py \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.en.json \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.en.png \
 && HIEUSRO_FONT_COVERAGE=vi \
    SRO_FONT_ARIAL=/work/fonts/VNTAHOMA.TTF \
    SRO_FONT_ARIAL_BOLD=/work/fonts/VNTAHOMA.TTF \
    HIEUSRO_VIET_FONT=/work/fonts/VNTAHOMA.TTF \
    HIEUSRO_VIET_FONT_BOLD=/work/fonts/VNTAHOMA.TTF \
    python3 scripts/build/native_ui_font_atlas.py \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.vi.json \
      apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.vi.png \
 && test -s apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.en.json \
 && test -s apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.vi.json

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY edge.mjs /app/edge.mjs
COPY tcvn3.mjs /app/tcvn3.mjs
COPY --from=build /work/upstream/apps/client-next/temp/artifacts/dist /app/public
COPY hieusro-language.js /app/public/hieusro-language.js
RUN grep -q '</body>' /app/public/index.html \
 && sed -i 's#</body>#<script src="/hieusro-language.js"></script></body>#' /app/public/index.html \
 && grep -q 'hieusro-language.js' /app/public/index.html \
 && test -s /app/public/assets/fonts/native-ui-font-atlas.en.png \
 && test -s /app/public/assets/fonts/native-ui-font-atlas.vi.png
EXPOSE 10000
CMD ["node", "/app/edge.mjs"]
