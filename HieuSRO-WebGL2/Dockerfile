FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json index.html ./
COPY src ./src
RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY package.json server.mjs ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
EXPOSE 10000
CMD ["node","server.mjs"]
