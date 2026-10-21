FROM node:22-alpine

RUN npm install --global npm@latest

ENV NODE_ENV=production
WORKDIR /app

# Copy only the package files first so this slow step is cached
# and only reruns when dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Now copy the application code.
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

# Drop root privileges.
USER node

EXPOSE 3000
CMD ["node", "src/index.js"]