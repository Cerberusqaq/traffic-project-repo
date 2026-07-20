## 项目概述
**灵动交通可视化平台** - 基于 Web 的香港道路交通态势可视化系统。使用 Leaflet 地图叠加道路路网、检测器数据点、粒子动画、热力图等多种可视化层，支持实时数据、历史数据、模型预测、突发事件模拟、路线规划等模块。

## 技术栈
- **前端**：Vanilla JavaScript (ES6+)、Leaflet 1.9.4、Leaflet 插件 (leaflet.heat)、CSS3
- **后端**：Node.js + Express 4.x、CORS、compression (gzip)、dotenv
- **AI 模型服务**：Python 3 + Flask + PyTorch（ASTGNN 时空图神经网络，端口 5001）
- **外部 API**：Coze LLM API（自然语言解析）、腾讯地图 API（地址解析+路线规划）
- **数据格式**：CSV / GeoJSON / NumPy (.npy) / PyTorch (.pth)
- **包管理器**：pnpm（平台强制要求）

## 目录结构
```
hk-traffic/                          # 技术项目根目录
├── frontend/                        # 前端应用
│   ├── index.html                   # 主页面入口
│   ├── css/style.css                # 全局样式（毛玻璃按钮/通知/底部栏）
│   ├── js/
│   │   ├── app.js                  # 主应用逻辑（地图初始化/模式管理/播放控制/路线规划）
│   │   ├── ui.js                   # UI 模块（左侧菜单/日期选择/模式切换）
│   │   ├── particle.js              # 粒子动画（发射/路线收集/规划模式过滤）
│   │   └── heatmap.js              # 热力图（切换/数据更新）
│   ├── vendor/                      # 本地化 CDN 库
│   └── assets/icons/                # SVG 图标
├── backend/                         # 后端服务 (Node.js + Express)
│   ├── server.js                    # Express 入口（端口 5000，gzip 压缩，Python API 代理）
│   ├── python_api.py                # ASTGNN 模型 API（Flask，端口 5001，突发事件模拟+路网操作）
│   ├── astgnn.pth                   # ASTGNN 模型权重文件
│   ├── adj_matrix.npy               # 邻接矩阵（1007×1007）
|   ├── node_feature.csv             # 节点信息表格（包括中英文名，经纬度等等）
|   ├── edge_list.csv                # 边信息表格（包括长度（km））
│   ├── routes/
│   │   └── plan.js                  # LLM 路线规划 API（Coze + 腾讯地图）
│   ├── scripts/
│   │   ├── coze-preview-build.sh   # 预览构建脚本
│   │   ├── coze-preview-run.sh     # 预览运行脚本（同时启动 Python API）
│   │   ├── coze-deploy-build.sh    # 部署构建脚本
│   │   └── coze-deploy-run.sh      # 部署运行脚本（同时启动 Python API）
│   └── .env                         # API 密钥（COZE_BOT_ID, COZE_ACCESS_TOKEN, TENCENT_MAP_AK）
├── data/                            # 数据资源
│   ├── base/
│   │   └── hk_data_new.csv          # 检测器基础数据（位置/连接关系）
│   ├── geojson/
│   │   └── HK_RoadCentreline_260310.geojson  # 精简路网（1.6MB）
│   └── monthly/                     # 按月存放历史流量 CSV
│       └── 2024-01/fd_2024-01-01.csv
└── docs/README.md                   # 项目说明文档
```

## 核心模块与架构

### 播放控制系统（解耦架构）
- **播放按钮**：只控制 `visualPlaybackActive` + 时间步自动推进（`startAutoStep`/`stopAutoStep`）
- **粒子按钮**：只控制粒子显隐（`particleMode`），不影响时间步推进
- **热力图按钮**：控制热力图显隐，随时间步自动更新数据
- 时间步变化通过 `window.onTimeStepChange` 回调，驱动底部栏、数据点 popup、热力图同步更新

### 模式系统
| 模式 | 入口 | 退出方式 | 特殊行为 |
|------|------|---------|---------|
| 实时数据 | 左下"实时数据"按钮 | 点击其他模式按钮 | 默认演示状态 |
| 历史数据 | 左下"历史数据"+选日期 | 点击其他模式/数据缺失 | 选日期后自动开启粒子+播放 |
| 预测数据 | 左下"预测数据"+选日期 | 点击其他模式/数据缺失 | 同历史 |
| 自定义路径 | 左下"自定义路径" | 再次点击该按钮/点击其他模式 | 地图选点添加/移除连接，意愿强度设置，重置路网 |
| 突发事件 | 左下"模拟事件" | 点击其他模式按钮 | 事件类型+节点选择+ASTGNN模型预测，地图选点支持 |
| 路线规划 | 左下"路线规划" | 再次点击该按钮/点击其他模式 | 退出时清蓝线+恢复数据点样式 |

### 路线规划流程
1. 用户在输入框输入自然语言（如"明天早上8点从旺角到中环"）
2. 前端 POST `/api/plan_route` → 后端调用 Coze LLM 解析出时间/起点/终点
3. 腾讯地图 Geocoding → 驾车路线规划 → 路线坐标 20m 插值加密
4. GCJ02→WGS84 坐标转换，自适应阈值匹配检测器
5. 尝试加载对应日期历史 CSV，匹配时间窗口范围（出发时间±5min → 到达时间+路线时长±5min）
6. 有数据：启动规划模式粒子+播放，时间步在路线时间范围内循环
7. 无数据：只显示路线，toast 提示

### 粒子系统
- 基于 DOM 的粒子发射系统，沿有向边（检测器连接关系）移动
- 正常模式：所有有向边参与发射
- 规划模式：仅路线匹配的检测器之间的有向边发射
- 数据驱动：每个时间步根据流量数据计算发射预算
- **生命周期管理**：`stopParticleAnimation()` 和 `resetTrafficData()` 不再以 `particleMode` 为守卫跳过清理，始终执行完整的动画帧取消+粒子清空+定时器清除，防止模式退出后残留渲染循环导致粒子散乱
- **重启路径**：退出模式后 `resetTrafficData()` 清空 `timeSteps`，再次开启粒子时 `startParticleAnimation()` 检测 `needReload` 重新从 `DEFAULT_DATA_URL` 加载数据 → `collectRoutes()` → `buildMarkerToTrafficCol()` → 重建完整状态

## 关键入口
- **前端入口**：`frontend/index.html`
- **后端入口**：`backend/server.js`
- **Python API 入口**：`backend/python_api.py`（端口 5001）
- **启动命令**：`PORT=5000 node backend/server.js` + `PYTHON_API_PORT=5001 python3 backend/python_api.py`
- **API 路由**：`/api/plan_route`（POST）、`/api/health`（GET）、`/api/emergency/simulate`（POST）、`/api/network/*`（GET/POST）

## ASTGNN 模型服务
- **架构**：Flask + PyTorch，运行在 5001 端口
- **模型**：ASTGNN（自适应时空图神经网络），1007 节点，3 特征（flow/speed/occupancy）
- **邻接矩阵**：`adj_matrix.npy`，1007×1007，可通过 API 动态修改
- **API 列表**：
  - `GET /api/python/health` - 健康检查
  - `GET /api/python/network/stats` - 路网统计
  - `POST /api/python/network/connection` - 添加连接（node1, node2, weight）
  - `POST /api/python/network/check` - 检查连接
  - `POST /api/python/network/remove` - 移除连接
  - `POST /api/python/network/reset` - 重置路网
  - `POST /api/python/emergency/simulate` - 突发事件模拟（type, node_ids, severity, num_steps）
- **代理**：Node.js 后端将 `/api/emergency/*` 和 `/api/network/*` 转发到 Python API，同时完成字段名映射

## 运行与预览
- **运行时**：Node.js 24（平台强制要求）
- **服务端口**：5000（平台固定端口，启动时需 `PORT=5000`）
- **预览链路**：`general-dev-preview` skill 管理
- **部署链路**：`general-deploy` skill 管理

## .coze 配置映射
| 字段 | 根目录 (.coze) | 子项目 (.coze) |
|------|----------------|----------------|
| sub_id | - | cb6254d7 |
| name | - | hk-traffic |
| project_type | web | web |
| preview_enable | enabled | enabled |
| requires | nodejs-24 | nodejs-24 |

## 用户偏好与长期约束
- 包管理器：`pnpm`（平台强制要求）
- 端口：HTTP 服务固定使用 5000
- 脚本幂等性：run 脚本执行前先清理 5000 端口残留进程
- 后端 CORS 已配置，支持跨域请求
- API 密钥存放在 `backend/.env`，不放在代码文件中
- 通知系统：统一使用 `window.showToast()`（红色毛玻璃样式），暂停/恢复等行为反馈用 `console.log`
- 模式退出后粒子需重新加载默认数据（`resetTrafficData()` 确保下次开启时加载默认 CSV）

## 常见问题和预防
- **粒子乱飘**：根因是模式退出后渲染循环(animationFrameId)未被取消，导致旧粒子继续在空数据上绘制。修复：`resetTrafficData()` 和 `stopParticleAnimation()` 不再以 `particleMode` 为守卫跳过清理，始终执行完整的 `cancelAnimationFrame` + `clearAllParticles` + `clearPendingTimers` + `stopAutoStep`
- **路线规划时间匹配失败**：CSV 的 `time_window` 格式为 `"2024/1/1 1:00"`（日期时间），而非 `"08:00-08:10"`（时间范围），解析函数必须从空格后提取时间部分；另外 `planTimeStr` 变量曾未定义（应为 `planTime`）
- **Map 对象用方括号访问无效**：`timeWindowMap` 是 `Map` 类型，必须用 `.get(key)` 访问，不能用 `map[key]`。所有访问点需用 `instanceof Map` 判断后分别处理
- **数据点白边丢失**：规划模式匹配的数据点恢复时需用原始样式（`color: '#ffffff', weight: 2`），不是 `transparent`
- **按钮无响应**：`initGlobalFixedMenu` 对不存在的 DOM 元素绑定会崩溃 → 加 try-catch；`planRouteBtn` ID 需与 HTML 中的 `realtimePlanBtn` 匹配
- **点击外部区域**：日历/二级菜单打开时点击外部区域应关闭菜单并退出当前模式（document 级 click 事件监听）
- **路线时长单位**：腾讯地图 `route.duration` 返回秒，但后端注释写"分钟"，前端用 `rawDuration > 100 ? rawDuration / 60 : rawDuration` 兼容两种情况
- **跨域问题**：后端已配置 CORS 中间件
- **静态资源路径**：前端通过相对路径引用 `../frontend` 和 `../data`
- **预览验证**：必须同时满足 curl 返回 200 和 ss 显示 0.0.0.0:5000
- **汉字编码问题**：CSV 文件可能使用 GBK/GB2312 编码，前端直接用 UTF-8 解码会出现黑色问号菱形乱码。修复：添加 `decodeCSVText()` 函数，自动检测编码类型（检查 BOM、检测乱码字符 `\uFFFD`），优先尝试 UTF-8，失败则回退 GBK
- **虚拟点显示**：数据中存在虚拟点（`Road_EN` 和 `Road_TC` 字段为空），原代码会显示空表格。修复：检测虚拟点，统一显示"虚拟点 无信息"
- **突发事件模拟节点移动**：模拟结果返回时会修改节点位置。修复：改用粒子动画展示模拟结果，不在节点选择模式下修改 marker 样式
