# 多阶段构建：node 构建 → nginx 运行，最终镜像只含 dist 与 nginx 配置
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# alpine-slim 变体：不含 njs/otel 额外模块，镜像 ~20MB（标准 1.27-alpine 现 ~78MB，超验收 60MB 上限）
FROM nginx:1.27-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# 断网可用：无后端依赖，数据不出浏览器
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
