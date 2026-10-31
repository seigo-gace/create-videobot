FROM node:22-alpine
WORKDIR /opt/videobot
COPY package.json ./
COPY src ./src
USER node
CMD ["node","src/runtime/main.mjs"]
