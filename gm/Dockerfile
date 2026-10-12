FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./package.json
COPY server.mjs ./server.mjs
COPY public ./public
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["npm","start"]
