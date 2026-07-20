# 灵动交通可视化平台 - 代码说明文档

## 一、项目简介

**灵动交通可视化平台**是一款基于 Web 的香港道路交通态势可视化系统。平台以 Leaflet 地图为底图，叠加道路路网、检测器数据点、粒子动画、热力图等多种可视化层，帮助用户直观理解交通流量、速度和拥堵状态的空间分布与时序变化。

平台支持五大功能模块：实时数据展示、历史数据展示、模型预测展示、突发事件模拟、路线规划导览。已完成历史数据展示及路线规划导览模块，其余模块已预留后端接口与前端交互框架，后续可无缝接入爬虫、机器学习模型（LGBM / ASTGNN）。

路线规划模块已集成 Coze LLM（大语言模型）+ 腾讯地图 API，用户输入自然语言后，LLM 自动解析出发地/目的地/时间，腾讯地图规划驾车路线，匹配沿线检测器数据点并启动粒子动效。

---

## 二、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端地图引擎 | Leaflet 1.9.4 | 开源交互式地图库，负责地图渲染、图层管理、Marker/Popup 等 |
| 前端插件 | leaflet.heat | 基于 Canvas 的热力图渲染 |
| 前端语言 | Vanilla JavaScript (ES6+) | 无框架，直接操作 DOM 与 Leaflet API |
| 前端样式 | CSS3 | 自定义样式，毛玻璃效果、深色/浅色模式切换 |
| 后端框架 | Node.js + Express 4.x | HTTP 服务器、静态资源托管、RESTful API、gzip 压缩 |
| 后端中间件 | compression | HTTP gzip 压缩中间件 |
| LLM 集成 | Coze API (流式) | 自然语言解析，提取出发地/目的地/时间 |
| 地图服务 | 腾讯地图 Web Service API | 地理编码、驾车路线规划 |
| 数据格式 | CSV / GeoJSON | 交通流量数据与道路路网数据 |

---

## 三、目录结构

```
hk-traffic/
├── frontend/                  # 前端应用代码
│   ├── index.html             # 主页面：HTML 结构、外部资源引用
│   ├── css/
│   │   └── style.css          # 全局样式：布局、毛玻璃面板、动画、深色模式
│   ├── js/
│   │   ├── app.js             # 主应用逻辑：地图初始化、模式状态机、时间步控制、路线规划
│   │   ├── ui.js              # UI 模块：菜单交互、日历、Marker 管理、工具函数
│   │   ├── particle.js        # 粒子动画模块：CSV 解析、粒子发射与动画、计划模式过滤
│   │   └── heatmap.js         # 热力图模块：基于 congestionLevel 生成热力图层、时间步更新
│   └── vendor/                # 本地化 CDN 资源（leaflet 等）
│
├── backend/                   # 后端服务框架（Node.js + Express）
│   ├── server.js              # Express 入口：静态资源托管、gzip、路由挂载
│   ├── package.json           # 后端依赖声明（express, compression, dotenv 等）
│   ├── .env                   # 环境变量（Coze API、腾讯地图 AK 等，不提交至版本控制）
│   ├── routes/
│   │   ├── plan.js            # 路线规划 API：POST /api/plan_route（Coze LLM + 腾讯地图）
│   │   ├── history.js         # 历史数据 API：GET /api/history/:date
│   │   ├── predict.js         # 预测数据 API（预留骨架）
│   │   ├── realtime.js        # 实时数据 API（预留骨架）
│   │   └── events.js          # 突发事件 API（预留骨架）
│   ├── services/
│   │   └── dataService.js     # 数据服务层：封装 CSV / GeoJSON 文件读取
│   └── scripts/               # 部署/预览构建脚本
│
├── data/                      # 数据资源
│   ├── geojson/
│   │   └── HK_RoadCentreline_260310.geojson   # 香港道路中心线（精简版 ~1.6MB）
│   ├── monthly/               # 按月存放的历史交通流量 CSV
│   │   └── 2024-01/
│   │       └── fd_2024-01-01.csv
│   └── base/
│       └── hk_data_new.csv    # 检测器基础信息（含经纬度、道路名称、连接关系、距离）
│
├── docs/
│   └── README.md              # 本说明文档
│
├── .coze                      # Coze 平台项目配置（子项目级）
└── AGENTS.md                  # Agent 长期记忆与项目规范
```

---

## 四、核心架构

### 4.1 前端模块依赖

```
index.html
    ├─ 本地引入 ──> Leaflet / leaflet.heat（vendor/ 目录）
    ├─ CSS引入 ──> style.css
    ├─ JS引入 ──> particle.js  ──┐
    ├─ JS引入 ──> heatmap.js   ──┤
    ├─ JS引入 ──> ui.js        ──┼──> app.js（主逻辑，依赖上述模块）
    └─ JS引入 ──> app.js       ──┘
```

### 4.2 全局状态与模式系统

平台采用**模式状态机**设计，核心全局状态：

| 变量 | 位置 | 说明 |
|------|------|------|
| `window.visualPlaybackActive` | app.js | 全局播放状态，控制时间步是否自动推进 |
| `window.currentMode` | app.js | 当前模式：`null` / `'history'` / `'predict'` / `'plan'` |
| `window.planTimeStepRange` | app.js | 路线规划模式的时间步范围 `[start, end]`，用于循环播放 |
| `window._heatmapVisible` | heatmap.js | 热力图可见性标记 |
| `window.csvData` | app.js | 当前加载的检测器数据（含连接关系） |
| `window.markers` | app.js | Leaflet CircleMarker 数组 |
| `planModeState` | particle.js | 规划模式状态（active, planEdges） |

**模式切换规则**：
- 点击某功能按钮 → 调用 `exitCurrentMode()` 退出当前模式 → 进入新模式
- 历史/预测模式：再次点击同一按钮**不退出**，仅折叠菜单（需选日期或点其他模式退出）
- 路线规划模式：再次点击同一按钮**退出**并清除路线
- 无数据时自动退出当前模式
- 点击日历/二级菜单外部区域：关闭菜单并退出当前模式

### 4.3 时间步控制（播放按钮）

播放按钮控制**全局时间步推进**，与粒子/热力图显示状态解耦：

- **播放 ON**：`visualPlaybackActive = true`，`startAutoStep()` 每秒推进一个 time_step
- **播放 OFF**：`visualPlaybackActive = false`，`stopAutoStep()` 暂停推进
- 粒子按钮、热力图按钮只控制各层的**可见性**，不影响时间步推进
- 时间步变化时通过 `window.onTimeStepChange` 回调通知：更新 Marker 弹窗数据、底部栏时刻显示、热力图数据

### 4.4 粒子系统

粒子沿数据点之间的连接关系发射，方向和颜色由交通流量/速度决定：

- **正常模式**：所有连接关系均参与粒子发射
- **路线规划模式**：仅 `planEdges`（路线匹配到的检测器之间有关联的边）参与发射
- 粒子按钮切换 `particleMode`，只控制粒子画布可见性和发射，不控制时间步
- 每次开启粒子时，如果 `timeSteps` 为空则自动加载默认数据（2024-01-01）
- `resetTrafficData()` 可清空当前流量数据，同时彻底停止渲染循环和定时器，确保下次启动时完全重建
- `stopParticleAnimation()` 不再以 `particleMode` 为守卫跳过清理，始终执行完整的 `cancelAnimationFrame` + `clearAllParticles` + `stopAutoStep`

### 4.5 路线规划流程

```
用户输入自然语言 → POST /api/plan_route
  → Coze LLM 流式解析 → {origin, destination, date, time}
  → 腾讯地图 Geocoding → 经纬度
  → 腾讯地图驾车路线规划 → polyline（GCJ02）
  → GCJ02→WGS84 坐标转换
  → 路线坐标 20m 线性插值加密
  → 匹配沿线检测器（自适应阈值 50→150m）
  → 返回路线 + 匹配检测器 + 时刻

前端接收：
  → 显示蓝色虚线路线
  → 高亮匹配检测器（白色粗描边）
  → fitBounds 自动缩放（左侧留白 280px 避开毛玻璃面板）
  → startPlanParticles：尝试加载对应日期数据
    → 匹配 time_window：从 datetime 格式（如 "2024/1/1 1:00"）中提取时间部分，与出发时间对比
    → 搜索范围：[出发时间-5min, 出发时间+路线时长+5min]，找最近的 time_window
    → 有数据：启动粒子 + 播放，时间步在 [出发±5min, 到达±5min] 循环
    → 无数据：仅显示路线，toast 提示
```

### 4.6 通知系统

所有用户提示统一使用红色毛玻璃弹窗（`window.showToast(msg)`）：
- 位于页面顶部居中，3 秒自动消失
- 仅在**操作失败/异常**时弹出
- 正常状态变化（暂停/恢复/模式切换）仅 console.log

---

## 五、关键函数说明

### 5.1 app.js（主应用逻辑）

| 函数名 | 说明 |
|--------|------|
| `loadBaseData()` | 页面初始化时调用，加载 GeoJSON 路网和 hk_data_new.csv，创建初始 Marker 集合 |
| `loadCsvByDate(dateStr)` | 加载指定日期的历史流量 CSV，更新 Marker 颜色/半径，加载粒子数据，自动启动粒子+播放 |
| `enterHistoryMode(dateStr)` | 历史模式入口：停止所有可视化 → 设模式状态 → 选日期后加载数据 |
| `exitHistoryMode()` | 历史模式出口：停止播放 → 清粒子数据 → 隐藏底部栏 |
| `enterPlanMode()` | 路线规划模式入口 |
| `exitPlanMode()` | 路线规划模式出口：清除路线、恢复 Marker 样式、清粒子数据、清 planTimeStepRange |
| `exitCurrentMode()` | 通用清理入口，根据 currentMode 调用对应 exit 函数 |
| `stopAllVisualizations()` | 停止所有可视化效果：粒子、热力图、播放，重置按钮状态 |
| `toggleVisualPlayPause(forceState)` | 切换全局播放/暂停，仅控制时间步推进，不控制粒子显隐 |
| `showToast(msg)` | 显示红色毛玻璃通知弹窗 |
| `updateBottomBar()` | 更新底部毛玻璃面板的日期和时刻显示 |
| `handlePlanRoute()` | 处理路线规划请求，调用后端 API，显示路线和匹配点 |
| `displayPlannedRoute(data)` | 在地图上绘制蓝色虚线路线，高亮匹配检测器 |
| `startPlanParticles(planDate, planTime)` | 异步加载路线对应日期数据，匹配时间窗口，启动粒子 |
| `parseTimeToMinute(timeStr)` | 解析时间字符串（HHMM/HH:MM/HH）为分钟数 |

### 5.2 particle.js（粒子动画模块）

| 函数名 | 说明 |
|--------|------|
| `ParticleModule.init(container)` | 初始化粒子 Canvas 容器 |
| `ParticleModule.loadTrafficData(csvText)` | 解析流量 CSV，构建 volumeMatrix / speedMatrix |
| `ParticleModule.start()` | 启动粒子动画系统 |
| `ParticleModule.stop(keepAutoStep)` | 停止粒子动画，keepAutoStep=true 时保留时间步推进 |
| `ParticleModule.setCurrentTimeStep(step)` | 切换到指定时间步，触发 onTimeStepChange 回调 |
| `ParticleModule.toggleParticleAnimation()` | 切换粒子显隐（不控制播放状态） |
| `ParticleModule.setPlanMode(active, edges)` | 设置路线规划模式，active=true 时仅 edges 参与发射 |
| `ParticleModule.startAutoStep()` | 启动每秒自动推进时间步 |
| `ParticleModule.stopAutoStep()` | 停止自动推进 |
| `ParticleModule.resetTrafficData()` | 清空当前流量数据（timeSteps/markerToTrafficCol），确保下次重新加载 |
| `ParticleModule.rebuildRoutes()` | 重新收集路线（退出计划模式后调用） |
| `ParticleModule.getCurrentTimeStep()` | 获取当前时间步索引 |
| `ParticleModule.getPlanMode()` | 获取规划模式状态 |
| `collectRoutes()` | 从 Marker 连接关系收集有向边 |
| `emitParticlesFromBudget()` | 按流量预算批量发射粒子 |
| `forceEmitParticle(edgeIdx)` | 强制在指定边发射一个粒子 |
| `buildMarkerToTrafficCol()` | 将地图 Marker 与流量数据 detector_id 匹配 |

### 5.3 heatmap.js（热力图模块）

| 函数名 | 说明 |
|--------|------|
| `toggleHeat()` | 切换热力图显示/隐藏，同时设置 `_heatmapVisible` 标记 |
| `window.updateHeatmapData(csvData, timeStep, timeWindowMap)` | 根据时间步更新热力图数据（拥堵等级重计算） |

### 5.4 ui.js（UI 与工具模块）

| 函数名 | 说明 |
|--------|------|
| `initGlobalFixedMenu()` | 绑定左下角五个按钮的点击事件，控制二级菜单显隐 |
| `renderCalendar(containerId, type)` | 渲染指定年月日历到容器中 |
| `selectDate(dateStr, type)` | 用户选择日期后触发，调用对应模式的入口函数 |

---

## 六、如何运行

### 6.1 环境要求

- Node.js 24.x（使用 pnpm 包管理器）
- 现代浏览器（Chrome / Edge / Firefox，支持 ES6+）

### 6.2 安装与启动

```bash
# 1. 进入后端目录
cd backend

# 2. 安装依赖
pnpm install

# 3. 配置环境变量（路线规划功能需要）
cp .env.example .env
# 编辑 .env 填入 COZE_BOT_ID, COZE_ACCESS_TOKEN, TENCENT_MAP_AK

# 4. 启动服务器
PORT=5000 node server.js
```

在浏览器中访问 `http://localhost:5000` 即可使用平台。

---

## 七、功能状态表

| 功能模块 | 状态 | 说明 |
|----------|------|------|
| **地图底图与缩放** | 已完成 | Leaflet 初始化、CartoDB 底图（浅色/深色）、自定义缩放 |
| **道路路网显示** | 已完成 | GeoJSON 精简版加载、道路线样式、深色/浅色切换 |
| **数据点 Marker** | 已完成 | CircleMarker 创建、弹窗、高亮、标签、拥堵等级配色 |
| **粒子动画** | 已完成 | 时间步推进、按流量发射、速度颜色映射、计划模式过滤 |
| **热力图** | 已完成 | 基于 congestionLevel 渲染，随时间步动态更新 |
| **深色/浅色模式** | 已完成 | 一键切换、localStorage 记忆、地图/粒子/箭头联动变色 |
| **搜索功能** | 已完成 | 文本模糊匹配、自动缩放定位、打开弹窗 |
| **历史数据展示** | 已完成 | 日历选日期 → 加载 CSV → 自动粒子+播放 → 底部栏显示日期时刻 |
| **路线规划导览** | 已完成 | 自然语言输入 → LLM 解析 → 腾讯地图路线 → 粒子动效 → 时间步循环 |
| **毛玻璃通知系统** | 已完成 | 红色毛玻璃弹窗，统一错误/异常提示，3秒自动消失 |
| **底部信息面板** | 已完成 | 毛玻璃圆角矩形，显示当前日期 + time_window 对应时刻 |
| **实时数据展示** | 预留 | 前端菜单保留，后端骨架已搭，待接入爬虫 |
| **模型预测展示** | 预留 | 前端日历保留，后端骨架已搭，待接入 LGBM 模型 |
| **突发事件模拟** | 预留 | 前端菜单保留，后端骨架已搭，待接入 ASTGNN 模型 |

---

## 八、后续开发建议

1. **实时数据接入**：在 `backend/routes/realtime.js` 中实现爬虫逻辑，定时抓取外部交通数据，前端通过轮询获取最新数据。

2. **模型预测接入**：将 LGBM 模型封装为 Python 服务，接收日期参数后返回预测流量 CSV。

3. **突发事件模拟**：将参数通过 POST 发送到 `/api/events/simulate`，由 ASTGNN 模型计算后返回新 CSV。

4. **更多日期数据**：目前仅 2024-01-01 的数据，扩展 data/monthly/ 目录可支持更多日期。
