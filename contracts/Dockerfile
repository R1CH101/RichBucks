FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY hardhat.config.ts tsconfig.json ./
COPY contracts ./contracts
COPY scripts ./scripts
RUN npx hardhat compile

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NETWORK_DIR=/network
VOLUME ["/network"]
ENTRYPOINT ["/entrypoint.sh"]
