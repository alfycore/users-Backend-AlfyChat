FROM oven/bun:1-alpine

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY . .
COPY .env .env
EXPOSE 3001
CMD ["bun", "src/index.ts"]
