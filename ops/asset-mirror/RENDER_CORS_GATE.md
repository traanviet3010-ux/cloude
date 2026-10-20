# Render CDN -> Safari Mobile Lite: CORS readiness

Verified on 2026-10-20: 213/213 pack HEADs, manifest SHA-256 and 17/17 group HTTP 206 Range requests passed against https://hieusro-assets-cdn-test-20261020.onrender.com.

**Blocker:** Response to pack Range requests sent with Origin: https://hieusro-mobile-lite-20261020.onrender.com has no Access-Control-Allow-Origin header. Do NOT point browser game client at this CDN until this is fixed and tested.

Render Static Site service: https://dashboard.render.com/static/srv-dbbckds9v7es73eo6l4g

Render Dashboard -> service -> Redirects/Rewrites or Settings -> Custom Headers (label may vary). Add response headers for path `/assets/packs/*`:

- `Access-Control-Allow-Origin`: `*` (packs are public, static, credential-free; do not send cookies/credentials)
- `Access-Control-Expose-Headers`: `Content-Range, Accept-Ranges, Content-Length, ETag`

Recommended cache headers (verify path matching precedence in Render before applying):
- `/assets/packs/*.bin`: `Cache-Control: public, max-age=31536000, immutable`
- `/assets/packs/manifest.json`: `Cache-Control: no-cache`

Do not gzip/Brotli-transform `.bin` Range representations. HTTP 206 and Content-Range must match the *identity byte sequence*.

Acceptance: Origin request for manifest and pack must return `Access-Control-Allow-Origin: *` or the precise requesting test origin. Range still returns 206 and correct Content-Range. Run the GitHub Action `Gate Render asset CDN CORS` to confirm.

Only after CORS gate succeeds, change HieuSRO **Mobile Lite TEST only** to use the CDN. Never modify LIVE or database without explicit approval.