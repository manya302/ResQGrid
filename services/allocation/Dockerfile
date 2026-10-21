FROM node:22-alpine

RUN npm install --global npm@latest

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src

USER node

EXPOSE 3001
CMD ["node", "src/index.js"]