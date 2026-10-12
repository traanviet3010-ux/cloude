FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./package.json
RUN npm install --omit=dev
COPY server.mjs ./server.mjs
COPY public ./public
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 10000
CMD ["npm","start"]
