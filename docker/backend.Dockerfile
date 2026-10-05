# ZOLA STYLISH MANAGEMENT SYSTEM — API server image
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so they are cached between code changes.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY database ./database

# Run as an unprivileged user; storage folders are mounted as volumes.
RUN addgroup -S zola && adduser -S -G zola zola \
  && mkdir -p backend/storage/uploads backend/storage/backups backend/logs \
  && chown -R zola:zola backend/storage backend/logs
USER zola
WORKDIR /app/backend

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Waits for MySQL, applies migrations, seeds reference data, then starts the API.
CMD ["node", "scripts/docker-entrypoint.js"]
