# HieuSRO LIVE baseline — 2026-10-16

Production branch baseline before `/assets/` mirror/cache work.

- LIVE root restored to HTML after routing repair.
- External verifier observed root `200 text/html` and title catalog `200` at 2026-10-16T04:51:39Z.
- User-observed mobile baseline from the current investigation: approximately 44 KB/s on iPhone versus approximately 484 KiB/s from an external test, with roughly 1,422 asset requests in the load path.
- Mobile comparison still required on both Wi-Fi and 4G after each production change; use the same first-load and reload sequence.

Rollback anchor before mirror/cache work: `71fc160e8ddc50ab263edebb2ee25ffe40cea400` on `hieusro-digitalocean`.

Planned order:
1. Extend deploy backup to include Caddy/Nginx/compose configuration.
2. Add persistent Nginx disk cache/mirror for `/assets/` and bypass Node for ordinary asset delivery.
3. Preserve localized Vietnamese JSON routes through the client edge.
4. Measure again before adding precompressed/Brotli delivery changes.
