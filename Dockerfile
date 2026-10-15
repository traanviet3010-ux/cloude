FROM node:24-alpine
WORKDIR /app
RUN printf '%s\n' \
  "import http from 'node:http';" \
  "const port = Number(process.env.PORT || 10000);" \
  "http.createServer((req, res) => {" \
  "  if (req.url === '/healthz') { res.writeHead(200, {'Content-Type':'text/plain','Cache-Control':'no-store'}); res.end('ok\\n'); return; }" \
  "  res.writeHead(410, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});" \
  "  res.end('HieuSRO legacy TEST deployment retired.\\n');" \
  "}).listen(port, '0.0.0.0');" \
  > /app/server.mjs
EXPOSE 10000
CMD ["node", "/app/server.mjs"]
