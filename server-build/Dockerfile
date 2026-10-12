# syntax=docker/dockerfile:1.7

FROM python:3.12-bookworm AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG OPEN_SRO_COMMIT=4f6919d6900d169b89e75647e56c99ca8ebd5cfb

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    SRO_GAME_ROOT=/opt/sro-v150 \
    SRO_BUILD_JOBS=2 \
    SRO_FONT_ARIAL=/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf \
    SRO_FONT_ARIAL_BOLD=/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf \
    PATH=/usr/local/go/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git ffmpeg fonts-liberation2 build-essential xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSLo /tmp/go.tgz https://go.dev/dl/go1.27.1.linux-amd64.tar.gz \
 && tar -C /usr/local -xzf /tmp/go.tgz \
 && rm /tmp/go.tgz \
 && corepack enable \
 && python -m pip install --no-cache-dir --upgrade pip gdown

WORKDIR /src
RUN git clone https://github.com/opensro-dev/opensro.git opensro \
 && cd opensro \
 && git checkout "$OPEN_SRO_COMMIT" \
 && test "$(git rev-parse HEAD)" = "$OPEN_SRO_COMMIT"

WORKDIR /src/opensro
RUN corepack pnpm --version \
 && corepack pnpm install --frozen-lockfile \
 && python -m pip install --no-cache-dir -r requirements-build.txt

# HieuSRO operator extension: flat EXP multiplier + independently adjustable
# skill/drop/gold/rare rates while preserving native defaults at x1.
COPY hieusro-growth.go /src/opensro/apps/server/internal/game/progression/growth.go

RUN set -eux; \
    mkdir -p "$SRO_GAME_ROOT/parts"; \
    python -m gdown 1a9nxRMoQTWoGK-ALioDeMKb4oHmiyhHV -O "$SRO_GAME_ROOT/parts/Data.pk2.part001"; \
    python -m gdown 1a3dCk5AXcdBMFv6cj6d28ANljV44lNEG -O "$SRO_GAME_ROOT/parts/Data.pk2.part002"; \
    python -m gdown 1v5cATpME3j0gd4Y1U0CKPJd34TJiPALE -O "$SRO_GAME_ROOT/parts/Data.pk2.part003"; \
    python -m gdown 1x-Sc0UBJyrbLe2vxFjAacH24L5squMZv -O "$SRO_GAME_ROOT/parts/Data.pk2.part004"; \
    python -m gdown 16gSz_ayYwx5rDv8ApykDzCB-2yJqCRk9 -O "$SRO_GAME_ROOT/parts/Data.pk2.part005"; \
    python -m gdown 1HmfbVLwnsnzzvy0I385Hi81PC4TazrQL -O "$SRO_GAME_ROOT/parts/Data.pk2.part006"; \
    python -m gdown 1Vw2D5furmvXlel0tbO3NlyhUma2w3SF4 -O "$SRO_GAME_ROOT/parts/Data.pk2.part007"; \
    python -m gdown 1-oxLttv6iroHl0lVlWuHYpO0s-x8nfZE -O "$SRO_GAME_ROOT/parts/Map.pk2.part001"; \
    python -m gdown 18yHbcPW7MJkO6xkAvVbvm7YpImNeX75X -O "$SRO_GAME_ROOT/parts/Map.pk2.part002"; \
    python -m gdown 1EmkjOnttSAOMDKK0TC19tBB9Aqwzl2-E -O "$SRO_GAME_ROOT/parts/Map.pk2.part003"; \
    python -m gdown 1Sjb5dGFfRsp14G8DmdVA-JcqsG6o10B9 -O "$SRO_GAME_ROOT/parts/Map.pk2.part004"; \
    cat "$SRO_GAME_ROOT"/parts/Data.pk2.part* > "$SRO_GAME_ROOT/Data.pk2"; \
    cat "$SRO_GAME_ROOT"/parts/Map.pk2.part* > "$SRO_GAME_ROOT/Map.pk2"; \
    python -m gdown 12IeBgOHIhHwQrI3xmJFcZnpGmmm8HALL -O "$SRO_GAME_ROOT/Media.pk2"; \
    python -m gdown 1GsrE_kpupG7S9KwM7BPyF0BhCO_DXtcu -O "$SRO_GAME_ROOT/Particles.pk2"; \
    python -m gdown 1qPWMF0X5Zh53SNAIwbqLjTnVxdxs4DtV -O "$SRO_GAME_ROOT/Music.pk2"; \
    python -m gdown 1rFcGDDheK1OBSVJEKS5Z5_PMqBeTN2Oy -O "$SRO_GAME_ROOT/SRO_Client.exe"; \
    python - <<'PY'
from pathlib import Path
root = Path('/opt/sro-v150')
expected = {
    'Data.pk2': 1342164992,
    'Map.pk2': 621858816,
    'Media.pk2': 289288192,
    'Particles.pk2': 68116480,
    'Music.pk2': 35569664,
    'SRO_Client.exe': 9383936,
}
for name, size in expected.items():
    actual = (root / name).stat().st_size
    print(f'{name}: {actual} bytes')
    if actual != size:
        raise SystemExit(f'{name}: expected {size}, got {actual}')
print('All licensed client input sizes match exactly.')
PY

RUN corepack pnpm assets prepare
# Keep this COPY after the expensive licensed-input and extraction layers so
# localization changes do not force multi-GB client inputs to download again.
COPY build-vietnamese-text.mjs /src/opensro/hieusro/build-vietnamese-text.mjs
RUN node hieusro/build-vietnamese-text.mjs /out/i18n
RUN corepack pnpm assets doctor
RUN corepack pnpm assets build world-outdoor

COPY build-server-world.mjs /tmp/build-server-world.mjs
RUN node /tmp/build-server-world.mjs

RUN node scripts/build/server/buildServerGameDataBundle.mjs \
 && node apps/server-observatory/tools/item-catalog.mjs

RUN set -eux; \
    mkdir -p /out; \
    SROGZ="$(find /src/opensro -type f -path '*/game-data/1.150/server.srogz' -print -quit)"; \
    test -n "$SROGZ"; \
    test -s "$SROGZ"; \
    cp "$SROGZ" /out/server.srogz; \
    sha256sum /out/server.srogz | tee /out/server.srogz.sha256; \
    printf '%s\n' "$OPEN_SRO_COMMIT" > /out/opensro-commit.txt; \
    cd /src/opensro/apps/server; \
    CGO_ENABLED=0 GOOS=linux go build -o /out/agent ./cmd/services/sro-agent; \
    CGO_ENABLED=0 GOOS=linux go build -o /out/gameworld ./cmd/services/sro-gameworld; \
    CGO_ENABLED=0 GOOS=linux go build -o /out/sro-nomad ./cmd/operations/sro-nomad; \
    CGO_ENABLED=0 GOOS=linux go build -o /out/sro-bootstrap-development ./cmd/operations/sro-bootstrap-development; \
    test -s /out/agent; \
    test -s /out/gameworld; \
    test -s /out/sro-nomad; \
    test -s /out/sro-bootstrap-development; \
    ls -lh /out/server.srogz /out/agent /out/gameworld /out/sro-nomad /out/sro-bootstrap-development

FROM python:3.12-slim-bookworm AS runtime
ARG NOMAD_VERSION=2.0.7
WORKDIR /opt/hieusro

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl nginx \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/hieusro/bin /tmp/nomad-extract \
 && curl -fsSLo /tmp/nomad.zip "https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_amd64.zip" \
 && python - <<'PY'
import zipfile
zipfile.ZipFile('/tmp/nomad.zip').extract('nomad', '/tmp/nomad-extract')
PY
RUN mv /tmp/nomad-extract/nomad /opt/hieusro/bin/nomad \
 && chmod +x /opt/hieusro/bin/nomad \
 && rm -rf /tmp/nomad.zip /tmp/nomad-extract \
 && /opt/hieusro/bin/nomad version

RUN mkdir -p /opt/hieusro/server/config /opt/hieusro/server/ops/nomad/jobs /opt/hieusro/server/ops/nomad/config

COPY --from=builder /out/server.srogz /opt/hieusro/server.srogz
COPY --from=builder /out/server.srogz.sha256 /opt/hieusro/server.srogz.sha256
COPY --from=builder /out/opensro-commit.txt /opt/hieusro/opensro-commit.txt
COPY --from=builder /out/i18n /opt/hieusro/i18n
COPY --from=builder /out/agent /opt/hieusro/server/agent
COPY --from=builder /out/gameworld /opt/hieusro/server/gameworld
COPY --from=builder /out/sro-nomad /opt/hieusro/server/sro-nomad
COPY --from=builder /out/sro-bootstrap-development /opt/hieusro/server/sro-bootstrap-development
COPY --from=builder /src/opensro/apps/server/ops/nomad/jobs/agent.nomad.hcl /opt/hieusro/server/ops/nomad/jobs/agent.nomad.hcl
COPY --from=builder /src/opensro/apps/server/ops/nomad/jobs/gameworld.nomad.hcl /opt/hieusro/server/ops/nomad/jobs/gameworld.nomad.hcl
COPY --from=builder /src/opensro/apps/server/ops/nomad/config/dev-windows.hcl /opt/hieusro/server/ops/nomad/config/dev-windows.hcl
COPY runtime-shards.json /opt/hieusro/server/config/shards.json
COPY runtime-dev-account.env /opt/hieusro/server/config/dev-account.env
COPY runtime-nginx.conf /opt/hieusro/runtime-nginx.conf
COPY runtime-start.sh /opt/hieusro/runtime-start.sh
COPY runtime-entrypoint.sh /opt/hieusro/runtime-entrypoint.sh
COPY runtime-gm.py /opt/hieusro/runtime-gm.py

RUN set -eux; \
    chmod +x \
      /opt/hieusro/server/agent \
      /opt/hieusro/server/gameworld \
      /opt/hieusro/server/sro-nomad \
      /opt/hieusro/server/sro-bootstrap-development \
      /opt/hieusro/runtime-start.sh \
      /opt/hieusro/runtime-entrypoint.sh \
      /opt/hieusro/runtime-gm.py; \
    EXPECTED="$(awk '{print $1}' /opt/hieusro/server.srogz.sha256)"; \
    ACTUAL="$(sha256sum /opt/hieusro/server.srogz | awk '{print $1}')"; \
    test "$ACTUAL" = "$EXPECTED"; \
    echo "server.srogz checksum verified: $ACTUAL"

ENV PORT=10000 \
    SRO_STATE_ROOT=/opt/hieusro/server/.state \
    SRO_ALLOWED_ORIGINS=https://opensro-mobile-test.onrender.com,https://hieusro-private-client-test.onrender.com,https://hieusro-portal.onrender.com

EXPOSE 10000
CMD ["/opt/hieusro/runtime-entrypoint.sh"]