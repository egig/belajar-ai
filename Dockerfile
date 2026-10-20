FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js db.js store.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
