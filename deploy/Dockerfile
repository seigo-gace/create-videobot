FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /opt/videobot
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node owner ./owner
COPY --chown=node:node sql ./sql
COPY --chown=node:node web ./web
USER node
CMD ["node","src/runtime/main.mjs"]
