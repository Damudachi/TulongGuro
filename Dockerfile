# TulongGuro frontend: Vite build served by nginx.
#
# VITE_API_URL is read at BUILD time — Vite inlines it into the bundle, so
# changing it means rebuilding the image, not restarting the container:
#   docker build --build-arg VITE_API_URL=https://tulongguro-api.onrender.com -t tulongguro-web .

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN npx vite build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
