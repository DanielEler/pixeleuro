# ─── PixelEuro – Express + PostgreSQL + Stripe ───
# node:slim (Debian) statt alpine: sharp (Bildskalierung) läuft mit den
# glibc-Prebuilds zuverlässiger als unter musl/alpine.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Nur Manifeste zuerst -> Layer-Cache für npm ci
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# App-Code (public/, src/, db/ – siehe .dockerignore für Ausschlüsse)
COPY . .

EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
