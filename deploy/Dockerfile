FROM node:22-alpine
WORKDIR /opt/videobot
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY sql ./sql
USER node
CMD ["node","src/runtime/main.mjs"]
