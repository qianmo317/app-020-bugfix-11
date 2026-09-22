# 消防疏散图与灭火器点位绘制 · Fire Evacuation Map

> 类型：前端 Web 应用（纯前端）｜技术栈：**React 18 + TypeScript + Vite**（手写 SVG 画布与 CSS，不引入 UI 库、路由库、状态库、Canvas 图形库）

## 1. 一句话简介
在浏览器里按毫米坐标绘制楼层平面与消防设施，沿走道路径算疏散距离、按保护半径算灭火器覆盖，自动判合规，并出可打印的疏散指示图与设施检查台账。

## 2. 真实场景与痛点
- 物业与维保单位每个季度都要交楼层疏散指示图和灭火器台账；用 CAD 重画一次平面成本高，改一处房间就要重出图。
- 疏散距离**不是直线距离**：L 形走道里直线量图会系统性低估（`tests/travel.test.ts` 第 03/04 组：直线 34.4m 合格、沿路径 46.6m 已超标），拿尺子量图等于漏判。
- 灭火器保护半径、袋形走道长度、安全出口数量都要逐个核对规范限值，人工核一层楼很费时间。
- 台账散在 Excel 里，谁该检查、哪天到期没人盯；检查照片存在个人手机，复核时翻不到。
- 楼层平面属建筑内部资料，不能上传到第三方云。

## 3. 目标用户
- 物业 / 园区消防安全管理员与维保单位巡检员。
- 企业 EHS 与安全生产负责人（自建厂房、仓库、门店）。
- 学校、医院后勤（教学楼、病房楼）。
- 消防技术服务机构的现场出图人员。

## 4. 核心功能（MVP）
1. **建筑与楼层管理**：新建建筑（办公楼 / 商业 / 厂房 / 学校四类，类别决定用哪套规则）；按层号加楼层，地上显示 `1F`、地下显示 `B1`；建筑列表按层汇总超限项与过期/缺检数量。
2. **平面绘制**（毫米坐标，吸附 0.1m）：多边形画房间（办公/商业/仓库/病房/走道/其他六种用途）与走道，可拖动整体平移；六类设施点位（灭火器/消火栓/疏散指示灯/应急照明/安全出口/喷淋）点击放置，编号自动生成（`3F-EX-01`，查重取最大序号 +1）。
3. **门由几何推断，不需要画门**：房间边与走道相邻的连续段 ≥0.4m 即取其中点作为门。
4. **自动校验**（编辑后 500ms 防抖重算，不需要点按钮）：疏散最远距离、袋形走道死端、灭火器未覆盖面积、安全出口数量与连通性、房间无门、检查记录过期/缺失/损坏。
5. **规则可配**：`#/rules` 按建筑类别改限值（疏散距离、袋形走道、灭火器半径、需两个出口的最小面积与人数、依据文号），改一次版本号 +1，此后校验结果记录当时快照。
6. **出图与台账**：A4/A3 横纵四种规格的白底图纸（图例、比例尺、指北针、「您在此」标记），打印 / 另存 PDF、导出 PNG、导出 CSV；整改清单列全部不合规项。
7. **底图与照片**：导入平面图片（长边压缩到 1600、JPEG 0.85）存 IndexedDB，可调不透明度与 mm/px 比例；检查记录可附现场照片。
8. **本地持久化**：结构数据存 localStorage（键 `fem.v1`），底图与照片存 IndexedDB（库 `fem-blobs`）；内置「载入示例」一键生成示例楼层。

## 5. 进阶功能
- 竖向疏散剖面：`#/building/:id` 把各层安全出口按 x 位置归一化画到同一轨道，上下接近的出口即共享疏散楼梯。
- 全楼台账页：跨建筑、跨楼层按设施类型筛选，勾「只看待整改（过期/缺失/损坏）」，按下次应检日期排序，导出 CSV（带 BOM，Excel 直接打开）。
- 未覆盖区域可视化：编辑器可把 0.5m 未覆盖栅格以红色方块直接叠在图纸上。
- 保留但界面未开放的类型：喷淋（`sprinkler`）已参与台账与编号，尚未参与任何校验规则。

## 6. 页面结构
自实现 hash 路由（`src/router.tsx`），不依赖服务端路由：
```
#/                     建筑列表（新建 / 载入示例 / 超限与缺检汇总）
#/building/:id         楼层列表 + 竖向疏散剖面
#/floor/:id            楼层编辑器（左：工具与元素库；中：SVG 图纸；右：校验与属性）
#/floor/:id/print      出图与台账（打印/PDF、PNG、CSV、整改清单）
#/facilities           全楼设施台账与检查记录
#/rules                校验规则配置
```
顶栏常驻：建筑 / 设施台账 / 规则，以及提示「数据仅存于本机浏览器 · 断网可用」。

## 7. 数据模型
```ts
type Pt = { x: number; y: number };                       // 一律毫米
type Room = { id: string; polygon: Pt[]; name: string;
              usage: 'office'|'retail'|'storage'|'ward'|'corridor'|'other';
              areaM2: number; occupants?: number };
type Facility = { id: string;
                  kind: 'extinguisher'|'hydrant'|'exit_sign'|'emergency_light'|'exit'|'sprinkler';
                  x: number; y: number; code: string;      // 如 3F-EX-01
                  spec?: { extType?: 'dry_powder'|'co2'|'water'; weightKg?: number };
                  checks: CheckRecord[] };
type CheckRecord = { date: string; status: 'ok'|'low_pressure'|'expired'|'damaged'|'missing';
                     photoKey?: string; note?: string };   // photoKey 指向 IndexedDB
type Floor = { id: string; buildingId: string; level: number; scaleMmPerUnit: number;
               rooms: Room[]; facilities: Facility[]; exits: string[];
               underlay?: Underlay; version: number; lastValidation?: ValidationResult };
type RuleSet = { buildingKind: BuildingKind; maxTravelDistanceM: number; deadEndDistanceM: number;
                 extinguisherRadiusM: number; exitMinAreaM2: number; exitMaxOccupants: number;
                 source: string; version: number };
type ValidationResult = { checkedAt: string; pass: boolean; items: ValidationItem[];
                          travelWorstM: number | null; travelWorstPoint?: Pt | null;
                          deadEndM: number | null; coverage: { uncoveredM2: number; totalM2: number;
                          pass: boolean; samples: Pt[] } | null;
                          exits: { present: number; required: number };
                          rulesSnapshot: { buildingKind; version; source; maxTravelDistanceM;
                                           deadEndDistanceM; extinguisherRadiusM } };
```
全局状态为 `{ buildings, floors, rules, marks }`，`marks` 存各楼层的「您在此」坐标；默认规则集在 `src/rules/defaults.ts`（四类建筑各一套，均带依据文号，版本从 1 起）。

## 8. 关键算法
1. **走道栅格图 + Dijkstra**（`src/lib/graph.ts`）：把可行走多边形按 **0.25m** 栅格化（射线法掩码 + 按多边形 bbox 预过滤），再做 **1 格 4 邻膨胀**补上共边房间之间的断缝；安全出口节点按 **2.5m**、门节点按 **1.5m** 吸附到最近栅格点；8 邻连通，对角要求两个正交邻居都可行（防切角穿墙）；二叉堆多源 Dijkstra 得每个栅格点到最近出口的路径距离。栅格数超过 8,000,000 直接抛 `floor too large for grid`。
2. **房间疏散距离**（`engine.ts` 的 `roomWorstTravelM`）：房间内采样 0.5m 栅格点 **加上全部多边形顶点**（保证非凸房间的最远角不漏），房间内取「最远点 → 房间门」直线段，再加上门到出口的路径距离；房间内本身有出口时只算房内直线。
3. **门推断**（`geometry.ts` 的 `doorCandidates`）：沿房间边界每 100mm 采样，用两侧 80mm 探针判断是否命中走道，连续命中且长度 ≥400mm 取中点作为门。
4. **袋形走道死端**（`graph.ts` 的 `computeDeadEnd`）：多出口时 `depth(n) = min over 出口对 (i,j) of (d(n,i) + d(n,j) − D(i,j)) / 2`；单出口时 `depth(n) = d(n, 唯一出口)`，取全部栅格点的最大值。可用出口上限取 12 个。
5. **灭火器覆盖**（`engine.ts` 的 `computeCoverage`）：0.5m 格心采样，格心落在任一灭火器保护圆内即整格算已覆盖，未覆盖面积 = 未覆盖格数 × 0.25㎡；`uncoveredM2 <= max(2, 楼层面积 × 5%)` 才合格。用边长 `max(radius, 5m)` 的桶哈希，仅检查 3×3 邻桶内的点位。
6. **安全出口数量**：`required = (楼层总面积 > exitMinAreaM2 或 估算人数 > exitMaxOccupants) ? 2 : 1`；人数未填时按用途密度估算（办公 10、商业 3、仓库 50、病房 8、走道 0、其他 20 ㎡/人）。
7. **检查到期**（`checkDueInfo`）：按日期取最近一次记录，应检日期 = 最近检查 + 周期（灭火器 30 天、消火栓 30 天、疏散指示灯 90 天、应急照明 90 天、安全出口 180 天、喷淋 180 天）；`damaged`/`missing` 记 `defect`（error），无记录 `CHECK_MISSING`（warning），超周期 `CHECK_OVERDUE`（warning）；日期按本地时区拼接，避免 `toISOString` 跨时区提前一天。
8. **结论与排序**：`pass = 无 error 项 且 灭火器覆盖合格`；列表 error 置前，同类按 `value / limit` 降序。
9. **渲染**：全部走 SVG，1 用户单位 = 1mm，缩放是 viewBox 变换（不重算几何）；图纸含 1m/5m 网格、房间多边形与面积标注、设施符号、未覆盖栅格高亮、校验定位红圈。
10. **状态管理**（`src/store/store.ts`）：手写外部 store + `useSyncExternalStore`；每次 `setState` 浅拷贝各顶层容器并替换被改动的对象引用，保证选择器能感知更新（`tests/store.test.ts` S1 就是这条的回归）。

## 9. 交互与视觉要点
- 编辑器三栏：左侧工具与元素库、中间 SVG 图纸、右侧校验面板与属性面板；滚轮以光标为锚点缩放（0.008 ~ 3），空白处或中键拖动平移，画多边形时 `Enter` 或双击起点闭合、`Esc` 取消。
- 选中房间 / 设施后右侧出属性与检查记录；`Delete` / `Backspace` 删除；校验项可点击「定位」，视图居中并红圈高亮 2.5 秒后自动消失。
- 设施符号用**颜色 + 形状 + 字母三重编码**：灭火器红圆 `E`、消火栓红方 `H`、安全出口绿块 `EXIT`、疏散指示灯绿三角 `S`、应急照明橙菱形 `L`、喷淋蓝六边形 `P`，黑白打印和色觉障碍下都能区分；房间按用途浅色填充，走道加粗描边。
- 打印页为白底图纸：标题与比例尺 `1:X`、依据文号、图例（设施与房间用途）、尺标、指北针，页脚打印校验结论、疏散最远值、规则版本与校验时间；`@media print` 隐藏 `.no-print` 并强制 A4 横向、8mm 页边距。
- 破坏性操作（删建筑、删楼层）都有 `confirm` 二次确认；顶栏常驻「数据仅存于本机浏览器 · 断网可用」。

## 10. 验收标准
- 单元测试 **7 个文件 / 59 个用例**全部通过（vitest 2.1.9，`npm test`）：疏散距离 20 组、灭火器覆盖 10 组、检查台账 7 组、编号 6 组、store 回归 10 组、规则切换 4 组、性能 2 组。
- 疏散距离：20 组沿路径用例与手工沿路径测量的误差 < 0.5m；其中第 04 组必须证明「直线距离 ≤40m 看着合格、沿路径 >50m 实际超标」被判 `TRAVEL_EXCEED` 且 `pass=false`。
- 灭火器覆盖：10 组未覆盖面积与人工核算（圆面积差集、条带面积）误差 ≤10%，且格心采样总面积与房间面积一致（20×20 房间 = 400㎡）。
- 台账：过期项 **100%** 出现在校验结果中（L6 按 `facilityId` 对账，无遗漏也无多余）；`damaged`/`missing` 为 error 级且排在最前。
- 规则：同一张图纸在办公 / 厂房 / 商业规则下结论翻转；改规则后版本 +1，`rulesSnapshot` 记下版本与依据文号。
- 性能：210 房间 + 500 设施单次 `validateFloor` < 500ms（本机实测冷启动 218ms、热路径 62ms）。
- 容器：`docker compose up -d --build` 后 `curl http://localhost:8100/healthz` 返回 `ok`（实测 HTTP 200）；镜像约 21MB，站点产物 216KB。

## 11. 边界（刻意不做）
不做账号与权限、不做多人协同、不做后端与数据库（应用内没有任何网络请求，断网可用）、不做 CAD/DXF 导入与图元级编辑、不做完整建筑防火审查（只覆盖疏散距离、袋形走道、灭火器覆盖、出口数量、检查台账五类）、不做底图自动识别与 OCR、不做移动端 App 与消息推送、不做多语言界面；避开黑名单里的博客 CMS、电商订单、音乐播放器方向。

**已知实现边界**（README 声称与代码实情逐条核对）：
- README 说 `.gitignore` 已排除 `underlays/`、`photos/`、`exports/`；实际 `.gitignore` 只有 `node_modules`、`dist`、`*.log`、`.DS_Store`、`.DS_Store?`，这三条都没有。由于底图与照片本来就只进 IndexedDB、导出走浏览器下载，不落盘也不会污染仓库，但该句描述与实现不符。
- README 写运行镜像是 `nginx:1.27-alpine`，`Dockerfile` 实际用的是 `nginx:1.27-alpine-slim`（注释里解释了为把镜像压到验收线以下）。
- README 的 `npm test` 说明只列了 5 类测试（疏散距离/覆盖/规则/台账/性能），实际还有 `tests/id.test.ts`（编号 6 例）与 `tests/store.test.ts`（store 回归 10 例）。
- 仓库内**没有** `e2e/` 目录与 `playwright.config.ts`，也没有端到端测试；浏览器阶段发现的两个 bug 只是就地固化成 vitest 用例（`tests/store.test.ts` 文件头注释说明了出处）。
- `Floor.scaleMmPerUnit` 注释写「此值仅影响底图显示」（`src/model.ts`），但全仓库没有任何渲染或校验路径读它，只在 store 与测试里写入；底图缩放实际用的是 `underlay.scaleMmPerPx`。
- `Floor.exits: string[]` 由 store 维护、也有测试断言，但校验引擎不读它（引擎直接过滤 `facilities` 里 `kind === 'exit'` 的项），是冗余派生字段。
- 房间与走道不共边时只给一条 `NO_DOOR` 警告并跳过该房间（engine 里的 `continue`），这个房间的疏散距离不会被判定。
- `.dockerignore` 排除了 `tests`，容器内 `tsc --noEmit` 实际只检查 `src`（按同条件实测通过）；另有一批导出但无调用点的工具函数与常量（`pointInAnyPoly`、`USAGE_STROKES`、`facilityBelongs`、`deleteBlob`）。

## 12. 容器化与构建（Docker）

本项目交付必须能通过 Docker 构建与运行，验收以容器内运行结果为准。

- **Dockerfile（两阶段）**：`node:20-alpine` 里 `npm ci --no-audit --no-fund` → `COPY . .` → `npm run build`（即 `tsc --noEmit && vite build`）；运行阶段 `nginx:1.27-alpine-slim`，只拷 `nginx.conf` 到 `/etc/nginx/conf.d/default.conf` 与 `/app/dist` 到 `/usr/share/nginx/html`；`EXPOSE 80`。
- **健康检查**：Dockerfile 内置 `HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz`，对应 nginx 的 `location = /healthz { return 200 'ok'; }`（实测返回 HTTP 200 与 `ok`）。
- **docker-compose.yml**：服务名与容器名都是 `app-020`，端口 **`8100:80`**（宿主 8100 → 容器 80），`restart: unless-stopped`。
- **nginx.conf**：`/assets/` 与 `*.svg` 一年 `immutable` 缓存；`location = /index.html` 用 `no-store`，防止发版后旧入口引用已删除的哈希资源导致白屏；其余路径 SPA 回退 `try_files $uri $uri/ /index.html`；gzip 覆盖 js/css/json/svg（≥1024B）；未配置 `client_max_body_size`（底图与照片只进浏览器 IndexedDB，不上传）。
- **构建配置**：Vite `base: './'`，dev 端口 5173；产物 `dist` 216KB（JS 201.09KB / gzip 66.16KB，CSS 7.06KB）。无后端与联网依赖。

```bash
cd app-020
npm test                                  # 7 个文件 59 个用例
docker compose up -d --build
curl http://localhost:8100/healthz        # 期望输出 ok
docker compose down
```
- **验收**：打开 `http://localhost:8100` 能走完「新建建筑 → 画走道与房间 → 放安全出口与灭火器 → 看校验结论 → 出图并打印」；刷新后数据仍在；`docker images` 显示 app-020 镜像约 21MB（低于 60MB 上限）。

### 忽略文件（.dockerignore / .gitignore）
- **`.dockerignore`**：`node_modules`、`dist`、`tests`、`*.log`、`.DS_Store`。排除 `node_modules` 后构建上下文远小于 5MB；`package-lock.json` 保留，`npm ci` 才能装到锁定版本。
- **`.gitignore`**：`node_modules`、`dist`、`*.log`、`.DS_Store`、`.DS_Store?`。
- **自检**：`git status` 不应出现构建产物与本地编辑器缓存文件。
