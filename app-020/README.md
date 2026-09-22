# 消防疏散图应用 · Fire Evacuation Map (app-020)

数据模型与几何核心：毫米坐标存储；校验全部在浏览器本地完成，**数据不出浏览器**（无任何后端/联网上传），断网可用。

## 开发

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest 单元测试（疏散距离/覆盖/规则/台账/性能）
npm run build    # tsc 类型检查 + vite 构建到 dist/
```

## Docker

```bash
cd app-020
docker compose up -d --build
curl http://localhost:8100/healthz
docker compose down
```

- 多阶段构建：`node:20-alpine` 构建 → `nginx:1.27-alpine`，端口 `8100:80`
- nginx：SPA 回退、哈希资源 immutable、index.html no-cache、gzip、SVG 正确 MIME
- `client_max_body_size` 未配置也无妨：底图与照片仅存浏览器 IndexedDB，不上传

## 说明

- 疏散距离沿**走道路径**计算（Dijkstra，栅格 0.25m），不是直线距离；房间内取「最远点 → 房间门」直线段
- 灭火器覆盖用 0.5m 栅格采样近似，未覆盖面积 > max(2㎡, 5%) 判不合规
- 校验结果保存时记录当时使用的规则版本与依据文号，打印报告中可见
- 底图与检查照片压缩（长边 1600）后存 IndexedDB，不出浏览器、不入 git（`.gitignore` 已排除 `underlays/`、`photos/`、`exports/`）
