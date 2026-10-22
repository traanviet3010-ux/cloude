#!/usr/bin/env bash
# HieuSRO original licensed v1.150 asset recovery for a NEW isolated TEST tree.
# Never deploy or overwrite LIVE/Icons Preview, never download from opensro.online.
set -Eeuo pipefail
: "${OPEN_SRO_SOURCE_ROOT:?Set OPEN_SRO_SOURCE_ROOT to local pinned OpenSRO checkout}"
: "${SRO_GAME_ROOT:?Set SRO_GAME_ROOT to a DISPOSABLE TEST folder containing owned v1.150 *.pk2 files}"
: "${SRO_GENERATED_ROOT:?Set SRO_GENERATED_ROOT to a NEW, empty TEST output folder}"
source_root="$(cd "$OPEN_SRO_SOURCE_ROOT" && pwd -P)"
game_root="$(cd "$SRO_GAME_ROOT" && pwd -P)"
output_root="$(realpath -m "$SRO_GENERATED_ROOT")"
expected="4f6919d6900d169b89e75647e56c99ca8ebd5cfb"
actual="$(git -C "$source_root" rev-parse HEAD)"
[[ "$actual" == "$expected" ]] || { echo "REFUSE: OpenSRO commit drift: $actual" >&2; exit 11; }
[[ "$game_root" != "$source_root" && "$output_root" != "$game_root" && "$output_root" != "$source_root" ]] ||
  { echo "REFUSE: must use three separate TEST roots" >&2; exit 12; }
case "$output_root" in
  */webgl2-parity*|*/hieusro-webgl2-test*|*/hieusro-original-test*) ;;
  *) echo "REFUSE: generated output path must be explicitly scoped to isolated WebGL2 TEST" >&2; exit 13 ;;
esac
for archive in Media Data Map Particles Music; do
  [[ -f "$game_root/$archive.pk2" ]] ||
    { echo "REFUSE: licensed v1.150 $archive.pk2 missing" >&2; exit 14; }
done
if [[ -e "$output_root" ]]; then
  [[ -d "$output_root" && -z "$(ls -A "$output_root")" ]] ||
    { echo "REFUSE: will not overwrite existing native/production assets" >&2; exit 15; }
fi
mkdir -p "$output_root"
for exe in python ffmpeg node corepack; do
  command -v "$exe" >/dev/null || { echo "Missing required builder: $exe" >&2; exit 16; }
done
echo "HIEUSRO_ORIGINAL_ASSET_BUILD=ISOLATED_TEST"
echo "OPEN_SRO_PINNED_SOURCE=$actual"
export SRO_GAME_ROOT="$game_root" SRO_GENERATED_ROOT="$output_root"
cd "$source_root"
corepack pnpm install --frozen-lockfile
corepack pnpm assets prepare
corepack pnpm assets doctor
corepack pnpm assets build full
port_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
node "$port_root/webgl2-parity/scripts/verify-native-stage-output.mjs" "$output_root/client-public"
echo "REAL_V150_STAGE_ASSETS_BUILT_AND_VERIFIED=1"
echo "NOTE: This is only an offline asset build. No game deployment or login verification was performed."
