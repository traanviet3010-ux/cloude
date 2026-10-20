#!/usr/bin/env python3
"""Extend ONLY Mobile Lite TEST title-server cold-start tolerance.

When a Render free service cold-starts, the proxy can return 502/503/504 for
over a minute. OpenSRO already understands PROCESS_STARTING, but the proxy
may emit plain 502. Keep the bounded retry and do not synthesize server data.
"""
from pathlib import Path
import os
root=Path(os.environ.get("HIEUSRO_OPENSRO_ROOT","/opt/opensro"))
path=root/"apps/client-next/src/engine/runtime/simulation/worker/session/session.ts"
source=path.read_text()
anchor='import { createSessionHttp } from "./http/http";'
if source.count(anchor)!=1:raise SystemExit("Missing title session import")
source=source.replace(anchor,anchor+'\nimport { mobileLiteEnabled } from "@/engine/foundation/rendering/mobile-lite";',1)
needle="""\t\t\t\t\t\tconst starting = result.value && !result.value.httpOk ?
\t\t\t\t\t\t\t(result.kind === "servers" || result.kind === "login" ?
\t\t\t\t\t\t\t\tserverStarting( result.value.body ) :
\t\t\t\t\t\t\t\tresult.kind === "roster" ?
\t\t\t\t\t\t\t\trosterStarting( result.value ) :
\t\t\t\t\t\t\t\tnull) :
\t\t\t\t\t\t\tnull;"""
replacement="""\t\t\t\t\t\t// Render free-tier upstream can still be waking even when the
\t\t\t\t\t\t// Nginx client shell and local UI media are already ready. 502
\t\t\t\t\t\t// is not an empty server catalogue; retry only title operations.
\t\t\t\t\t\tconst proxyStarting = mobileLiteEnabled() && result.value &&
\t\t\t\t\t\t\t(result.kind === "servers" || result.kind === "login") &&
\t\t\t\t\t\t\t[ 502, 503, 504 ].includes( result.value.status ) ?
\t\t\t\t\t\t\t{ message: "Máy chủ TEST đang khởi động. Vui lòng chờ, game sẽ tự thử lại.", retryMs: 3000 } :
\t\t\t\t\t\t\tnull;
\t\t\t\t\t\tconst starting = (result.value && !result.value.httpOk ?
\t\t\t\t\t\t\t(result.kind === "servers" || result.kind === "login" ?
\t\t\t\t\t\t\t\tserverStarting( result.value.body ) :
\t\t\t\t\t\t\t\tresult.kind === "roster" ?
\t\t\t\t\t\t\t\trosterStarting( result.value ) :
\t\t\t\t\t\t\t\tnull) :
\t\t\t\t\t\t\tnull) ?? proxyStarting;"""
if source.count(needle)!=1: raise SystemExit("Title-server retry code changed upstream: refusing patch")
source=source.replace(needle,replacement,1)
x='if ( now - startingSince < MAX_STARTING_WAIT_MS ) {'
y='if ( now - startingSince < (mobileLiteEnabled() ? 240_000 : MAX_STARTING_WAIT_MS) ) {'
if source.count(x)!=1:raise SystemExit("Title-server retry cap changed upstream")
source=source.replace(x,y,1)
path.write_text(source)
print("HIEUSRO_MOBILE_TITLE_RETRY_PATCH_OK=1")
