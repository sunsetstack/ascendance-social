# -- Build stage
FROM node:24.13.0-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm ci --include=dev

COPY frontend/ ./frontend/

COPY tsconfig.base.json ./
COPY tsconfig.json ./  

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}

RUN npm run build --workspace=frontend

FROM nginx:alpine AS production
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf