FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /opt/videobot
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY sql ./sql
USER node
CMD ["node","src/runtime/main.mjs"]
