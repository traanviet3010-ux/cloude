#!/usr/bin/env bash
set -euo pipefail
cd /src/opensro

python - <<'PY'
from pathlib import Path
p = Path('scripts/build/native_ui_font_atlas.py')
s = p.read_text(encoding='utf-8')
old = 'LATIN_CODEPOINTS = range(0xA0, 0x180)'
new = 'LATIN_CODEPOINTS = tuple(range(0xA0, 0x250)) + tuple(range(0x300, 0x370)) + tuple(range(0x1E00, 0x1F00))'
if old not in s:
    raise SystemExit('native atlas coverage declaration changed upstream')
p.write_text(s.replace(old, new), encoding='utf-8')
PY

python - <<'PY'
from pathlib import Path
p = Path('apps/client-next/src/engine/runtime/assets/worker/loader.ts')
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
PY

python - <<'PY'
from pathlib import Path

device = Path('apps/client-next/src/engine/runtime/renderer/device/device.ts')
s = device.read_text(encoding='utf-8')
old = '''\t\t\t\tcreateEncoder: () => current().createCommandEncoder( { label: "sro-frame" } ),'''
new = '''\t\t\t\tcreateEncoder: () => {\n\t\t\t\t\ttry {\n\t\t\t\t\t\treturn current().createCommandEncoder( { label: "sro-frame" } );\n\t\t\t\t\t} catch ( error ) {\n\t\t\t\t\t\tfail( error, true );\n\t\t\t\t\t\tthrow error;\n\t\t\t\t\t}\n\t\t\t\t},'''
if old not in s:
    raise SystemExit('renderer command encoder anchor changed upstream')
device.write_text(s.replace(old, new, 1), encoding='utf-8')

renderer = Path('apps/client-next/src/engine/runtime/renderer/renderer.ts')
s = renderer.read_text(encoding='utf-8')
old = '''\t\t\t} catch ( error ) {\n\t\t\t\tfailure = String( error );\n\t\t\t} finally {\n\t\t\t\topen?.endFrame();\n\t\t\t}'''
new = '''\t\t\t} catch ( error ) {\n\t\t\t\tif ( !(device.phase() === "failed" && device.recoverable()) ) {\n\t\t\t\t\tfailure = String( error );\n\t\t\t\t}\n\t\t\t} finally {\n\t\t\t\topen?.endFrame();\n\t\t\t}'''
if old not in s:
    raise SystemExit('renderer frame failure anchor changed upstream')
renderer.write_text(s.replace(old, new, 1), encoding='utf-8')
PY

python - <<'PY'
from pathlib import Path
p = Path('apps/client-next/src/engine/runtime/platform/platform.ts')
s = p.read_text(encoding='utf-8')
old_exp = '''\tconst experimentalKey = "sro:v1150:experimental-options:1";\n\tlet experimental = experimentalOptions();\n\ttry {\n\t\tconst stored = localStorage.getItem( experimentalKey );\n\t\tconst value = stored === null ? null : JSON.parse( stored );\n\t\texperimental = experimentalOptions( value );'''
new_exp = '''\tconst isIos = /iPad|iPhone|iPod/.test( navigator.userAgent ) ||\n\t\t(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);\n\tconst experimentalKey = "sro:v1150:experimental-options:1";\n\tlet experimental = experimentalOptions(), hasStoredExperimental = false;\n\ttry {\n\t\tconst stored = localStorage.getItem( experimentalKey );\n\t\thasStoredExperimental = stored !== null;\n\t\tconst value = stored === null ? null : JSON.parse( stored );\n\t\texperimental = experimentalOptions( value );'''
if old_exp not in s:
    raise SystemExit('experimental preference anchor changed upstream')
s = s.replace(old_exp, new_exp, 1)
old_exp_end = '''\t} catch ( error ) {\n\t\tstatus.value = "Experimental options could not be restored: " + String( error );\n\t}\n\tonUi( { kind: "experimental-preferences", value: experimental } );'''
new_exp_end = '''\t} catch ( error ) {\n\t\tstatus.value = "Experimental options could not be restored: " + String( error );\n\t}\n\tif ( isIos && !hasStoredExperimental ) {\n\t\texperimental = experimentalOptions( { renderScale: 75 } );\n\t}\n\tonUi( { kind: "experimental-preferences", value: experimental } );'''
if old_exp_end not in s:
    raise SystemExit('experimental preference end anchor changed upstream')
s = s.replace(old_exp_end, new_exp_end, 1)
old_video = '''\tconst videoKey = "sro:v1150:video-options:1";\n\tlet video = defaultVideoOptions();\n\ttry {\n\t\tconst stored = localStorage.getItem( videoKey );\n\t\tif ( stored !== null ) video = videoOptions( JSON.parse( stored ) );\n\t} catch ( error ) {\n\t\tstatus.value = "Video options could not be restored: " + String( error );\n\t}\n\tonUi( { kind: "video-preferences", value: video } );'''
new_video = '''\tconst videoKey = "sro:v1150:video-options:1";\n\tlet video = defaultVideoOptions(), hasStoredVideo = false;\n\ttry {\n\t\tconst stored = localStorage.getItem( videoKey );\n\t\thasStoredVideo = stored !== null;\n\t\tif ( stored !== null ) video = videoOptions( JSON.parse( stored ) );\n\t} catch ( error ) {\n\t\tstatus.value = "Video options could not be restored: " + String( error );\n\t}\n\tif ( isIos && !hasStoredVideo ) {\n\t\tconst records = video.records.map( row => {\n\t\t\tconst next = [ ...row ];\n\t\t\tnext[2] = 0;\n\t\t\tnext[6] = 0;\n\t\t\tnext[7] = 0;\n\t\t\tnext[9] = 0;\n\t\t\tnext[10] = 0;\n\t\t\tnext[12] = 0;\n\t\t\tnext[13] = 1;\n\t\t\treturn next;\n\t\t} ) as [number[], number[]];\n\t\tvideo = videoOptions( { ...video, frameLimit: 60, records } );\n\t}\n\tonUi( { kind: "video-preferences", value: video } );'''
if old_video not in s:
    raise SystemExit('video preference anchor changed upstream')
s = s.replace(old_video, new_video, 1)
p.write_text(s, encoding='utf-8')
PY

python - <<'PY'
from pathlib import Path
platform = Path('apps/client-next/src/engine/runtime/platform/platform.ts')
s = platform.read_text(encoding='utf-8')
anchor = '''\tconst lifetime = new AbortController();\n'''
insert = '''\tconst lifetime = new AbortController();\n\tconst storage = navigator.storage;\n\tif ( storage?.persisted && storage?.persist ) {\n\t\tvoid storage.persisted().then( kept => kept || storage.persist() ).catch( () => false );\n\t}\n'''
if anchor not in s:
    raise SystemExit('platform lifetime anchor changed upstream')
platform.write_text(s.replace(anchor, insert, 1), encoding='utf-8')

loading = Path('apps/client-next/src/engine/foundation/ui/loading-detail.ts')
s = loading.read_text(encoding='utf-8')
old = '''\tif ( progress.bytesRead !== undefined ) {\n\t\tparts.push( `${(progress.bytesRead / BYTES_PER_MB).toFixed( 1 )} MB read` );\n\t\tparts.push( `${progress.filesReady} files ready` );\n\t}\n'''
new = '''\tif ( progress.bytesRead !== undefined ) {\n\t\tparts.push( `${(progress.bytesRead / BYTES_PER_MB).toFixed( 1 )} MB processed` );\n\t\tif ( progress.bytesReceived > 0 ) {\n\t\t\tparts.push( `${(progress.bytesReceived / BYTES_PER_MB).toFixed( 1 )} MB network` );\n\t\t}\n\t\tif ( progress.cacheHits > 0 ) parts.push( `${progress.cacheHits} cache hits` );\n\t\tparts.push( `${progress.filesReady} files ready` );\n\t}\n'''
if old not in s:
    raise SystemExit('loading detail byte display changed upstream')
loading.write_text(s.replace(old, new, 1), encoding='utf-8')
PY

corepack pnpm --filter @sro/client-next build
mkdir -p apps/client-next/temp/artifacts/dist/assets/fonts
SRO_FONT_ARIAL=/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf \
SRO_FONT_ARIAL_BOLD=/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf \
python scripts/build/native_ui_font_atlas.py \
  apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.json \
  apps/client-next/temp/artifacts/dist/assets/fonts/native-ui-font-atlas.png

rm -rf /out/client-public
mkdir -p /out/client-public
cp -a apps/client-next/temp/artifacts/dist/. /out/client-public/
