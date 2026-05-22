FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY packages ./packages
RUN npm install
RUN npm run build --workspace @sparkcanvas/ai-design-language \
 && npm run build --workspace @sparkcanvas/cal-canvas-bridge \
 && npm run build --workspace @sparkcanvas/cal-theme-transformer
WORKDIR /app/frontend
COPY frontend/index.html ./index.html
COPY frontend/tsconfig.json ./tsconfig.json
COPY frontend/tsconfig.node.json ./tsconfig.node.json
COPY frontend/vite.config.ts ./vite.config.ts
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html/site-assets /usr/share/nginx/html/brand-assets || true
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
