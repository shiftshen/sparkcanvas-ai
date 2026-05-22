FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY backend ./backend
WORKDIR /app/backend
COPY backend/tsconfig.json ./tsconfig.json
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app/backend
ENV NODE_ENV=production
RUN apk add --no-cache python3
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY scripts /app/scripts
COPY frontend/public /app/frontend/public
RUN mkdir -p /app/data
EXPOSE 4100
CMD ["node", "dist/server.js"]
