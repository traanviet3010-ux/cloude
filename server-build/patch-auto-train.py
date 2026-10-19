#!/usr/bin/env python3
"""Patch only the pinned OpenSRO v1.150 TEST build with complete Auto Train stage 1.
Refuses to patch if runtime entry points changed. Does not change the game server.
"""
from pathlib import Path
import os

root=Path(os.environ.get("HIEUSRO_OPENSRO_ROOT","/src/opensro"))
path=root/"apps/client-next/src/engine/runtime/runtime.ts"
source=path.read_text(encoding="utf-8")
def replace_once(before, after):
    global source
    assert source.count(before) == 1, f"Auto Train anchor missing/duplicated: {before[:90]!r}"
    source=source.replace(before, after, 1)

replace_once(
    'import { createSimulationHost } from "./simulation/host";',
    'import { createSimulationHost } from "./simulation/host";\n'
    'import { createAutoTrain } from "./auto-train/auto-train";'
)
replace_once(
    '\t\tconst simulation = own( createSimulationHost() );',
    '\t\tconst simulation = own( createSimulationHost() );\n'
    '\t\t// Auto is a disposable owner of the real gameplay command lane.\n'
    '\t\tconst autoTrain = own( createAutoTrain( command => simulation.session( { kind: "gameplay", command } ) ) );'
)
replace_once(
    '\t\tfunction sessionCommand( command: import("@/engine/contracts/session").SessionCommand ) {\n',
    '\t\tfunction sessionCommand( command: import("@/engine/contracts/session").SessionCommand ) {\n'
    '\t\t\tif ( command.kind === "gameplay" ) autoTrain.manual( command.command );\n'
)
replace_once(
    '\t\tfunction worldClick( x: number, y: number, click: WorldClickInput = {} ) {\n',
    '\t\tfunction worldClick( x: number, y: number, click: WorldClickInput = {} ) {\n'
    '\t\t\t// Explicit world interaction overrides automated target acquisition.\n'
    '\t\t\tautoTrain.stop( "Đã dừng Auto vì người chơi điều khiển trực tiếp." );\n'
)
replace_once(
    '\t\t\tconst semantics = ui.step(\n',
    '\t\t\t// Runs at the presentation boundary after all authoritative entity\n'
    '\t\t\t// events have been applied. Never synthesizes health or rewards.\n'
    '\t\t\tautoTrain.step( {\n'
    '\t\t\t\tworld: frontendState.phase === "world" && sessionState?.phase === "world" && readySent,\n'
    '\t\t\t\tgameplay: presentation.gameplay(),\n'
    '\t\t\t\tlocal: presentation.gameplay()?.localGid ? presentation.read( presentation.gameplay()!.localGid ) : null,\n'
    '\t\t\t\tentities: presentation.entities(),\n'
    '\t\t\t\tnow,\n'\n    '\t\t\t\tsimNow: simulationTimeMs\n'
    '\t\t\t} );\n'
    '\t\t\tconst semantics = ui.step(\n'
)
path.write_text(source,encoding="utf-8")
print("HieuSRO Auto Train runtime hooks installed (UI, manual override, authoritative targeting, cleanup).")
