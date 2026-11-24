FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
# Hardhat lives in devDependencies — never omit them during image build
# (Coolify/buildkit often inject NODE_ENV=production).
RUN npm ci --include=dev

COPY hardhat.config.ts tsconfig.json ./
COPY contracts ./contracts
COPY scripts ./scripts
RUN npx hardhat compile

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NETWORK_DIR=/network
VOLUME ["/network"]
ENTRYPOINT ["/entrypoint.sh"]
