FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY package*.json ./
EXPOSE 3010
# Aplica as migrations e roda o seed (só cria o que falta e completa os
# horários dos próximos 28 dias) antes de subir a API.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ -n \"$SEED_ADMIN_EMAIL\" ]; then node scripts/seed.js; fi && node dist/main.js"]
