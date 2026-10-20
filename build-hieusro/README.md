# HieuSRO v1.150 — isolated build from OpenSRO + client PK2

This directory provides a **reproducible build procedure**, not a deployed or playable game by itself.

## Inputs

1. A local copy of the user-provided `opensro-main.zip`. This is the **source of truth** (do not silently replace it with another upstream revision).
2. The legally usable Legend III v1.150 client: `SRO_Client.exe`, `Media.pk2`, `Data.pk2`, `Map.pk2`, `Particles.pk2`, and `Music.pk2`. The retail `Silkroad.exe` **is not** a browser client and is **not** executed.
3. Linux or Windows-with-WSL build machine with **Node.js 24**, **Go 1.27.1**, **Python 3.12**, **ffmpeg**, **pnpm 12.6.0 via Corepack**. Nomad is required for runtime cluster deployment; the build script stops **before deployment**.

## Path A: PK2 archives already downloaded

```sh
bash build-hieusro/build.sh --source-zip /private/opensro-main.zip --game-root /private/legend3-client --work-dir /private/hieusro-test-build
```

## Path B: download directly from the linked Drive folder

The downloader can list the supplied, link-shared Drive folder at runtime and automatically select the required files (preferring the ordered Data/Map chunks). No file IDs or retail files are committed to this repository. On a build machine with access to the link:

```sh
python3 -m pip install gdown==5.2.0
python3 build-hieusro/drive_download.py \
  --folder-url "https://drive.google.com/drive/folders/YOUR_FOLDER_ID" \
  --output /private/legend3-client
bash build-hieusro/build.sh --source-zip /private/opensro-main.zip --game-root /private/legend3-client --work-dir /private/hieusro-test-build
```

An optional `--manifest` file can be used instead if folder discovery is blocked. Keep this JSON **outside Git** and provide the file IDs privately. Supported strategies are `single` (one file ID) and `parts` (ordered part IDs). Do **not** commit your private link or PK2 files to Git.

```json
{
  "Media.pk2": {"single": "<Google Drive file ID>"},
  "Data.pk2": {"parts": ["<part001 ID>", "<part002 ID>", "<...>"]},
  "Map.pk2": {"parts": ["<part001 ID>", "<part002 ID>", "<...>"]},
  "Particles.pk2": {"single": "<Google Drive file ID>"},
  "Music.pk2": {"single": "<Google Drive file ID>"},
  "SRO_Client.exe": {"single": "<Google Drive file ID>"}
}
```

```sh
python3 -m pip install gdown==5.2.0
python3 build-hieusro/drive_download.py --manifest /private/sro-drive-files.json --output /private/legend3-client
bash build-hieusro/build.sh --source-zip /private/opensro-main.zip --game-root /private/legend3-client --work-dir /private/hieusro-test-build
```

The downloader checks archive sizes and magic, avoids partial final files, and refuses to overwrite a valid existing client. `Media.pk2` is about 289 MB; download it on the build machine, not through the 256 MiB file handoff limit. For `Data.pk2` and `Map.pk2`, the ordered split chunks from the supplied Drive folder avoid single-file transfer limits.

## Generated output

* `<work-dir>/opensro-main/.generated/client-public/assets/`: browser assets.
* `<work-dir>/opensro-main/apps/client-next/dist/`: production browser client.
* `<work-dir>/opensro-main/apps/server/.generated/game-data/1.150/`: server game data.
* `<work-dir>/opensro-main/.hieusro-build-verification.json`: verification report.
* Go binaries in `<work-dir>/bin/`.

No LIVE database, user account data, existing service, remote server, current Git branch, or Render app is modified by either script. Build artifacts are not committed, and the scripts never start a production server.

## Next stage: TEST runtime

Run the Go Agent and GameWorld with a **new empty test world** and test-only credentials, using the repository's `docs/GETTING_STARTED.md` for the pinned Nomad runtime. Serve the browser client and asset packs on the same origin using the provided reverse proxy configuration. Only after login, create-character, world movement, combat, logout/relogin and resource loads pass should a TEST hostname be published.

## Licensing

The OpenSRO source is AGPL-3.0-or-later. This does not license third-party Silkroad art/audio. Keep client archives and built game resources private unless you hold the necessary rights; complying with the source license and retail content rights are **separate** issues.
