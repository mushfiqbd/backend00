FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
