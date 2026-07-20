# 灵动交通可视化平台 - 项目文档

## 项目概述

本项目是一个基于 Web 的**智能交通可视化平台**，旨在通过交互式地图展示香港地区的实时交通数据、历史数据分析、突发事件模拟预测等功能。平台采用前后端分离架构，前端使用 Leaflet 地图库进行可视化渲染，后端使用 Node.js + Express 提供 API 服务，并集成 Python 机器学习模型进行交通预测。

---

## 项目架构

```
├── 项目根目录/
│   ├── projects/                    # 项目主目录
│   │   ├── backend/                 # 后端服务 (Node.js)
│   │   │   ├── routes/             # API 路由模块
│   │   │   ├── services/           # 业务服务层
│   │   │   ├── server.js           # 服务器入口
│   │   │   └── python_api.py       # Python API 服务
│   │   ├── frontend/               # 前端应用
│   │   │   ├── js/                 # JavaScript 核心逻辑
│   │   │   ├── css/                # 样式文件
│   │   │   ├── assets/             # 静态资源
│   │   │   ├── vendor/             # 第三方库
│   │   │   └── index.html          # 入口页面
│   │   ├── data/                   # 数据文件
│   │   │   ├── geojson/            # GeoJSON 路网数据
│   │   │   ├── base/               # 基础检测器信息
│   │   │   └── monthly/            # 历史数据
│   │   └── 数据清理/               # 数据预处理脚本
```

---

## 功能模块详解

### 1. 基础地图可视化

#### 功能描述
加载香港地区道路路网数据（GeoJSON格式）和检测器点位信息（CSV格式），在地图上展示1005个交通检测节点。

#### 核心函数

| 函数名 | 位置 | 功能说明 | 参数 | 返回值 |
|--------|------|----------|------|--------|
| `loadBaseData()` | app.js#L268 | 加载基础地理数据（路网+检测器） | 无 | 无 |
| `initParticleModule()` | particle.js | 初始化粒子动画模块 | 无 | 无 |
| `buildArrowLayer()` | app.js | 构建节点连接关系箭头层 | 无 | 无 |

#### 调用流程
```
页面加载 → loadBaseData() → 加载GeoJSON路网 → 加载CSV检测器 → 创建Marker → 初始化粒子模块
```

---

### 2. 实时数据模式

#### 功能描述
从后端爬取实时交通数据，展示当前时刻的交通状况，包括速度、流量等信息。

#### 核心函数

| 函数名 | 位置 | 功能说明 | 参数 | 返回值 |
|--------|------|----------|------|--------|
| `fetchRealtimeData()` | app.js#L23 | 发起实时数据爬取请求 | 无 | 无 |
| `enterRealtimeMode()` | app.js#L998 | 进入实时模式 | `trafficData`: 爬取的实时数据 | 无 |
| `processRealtimeData()` | app.js#L1091 | 处理实时数据并启动粒子动画 | `trafficData`: 原始实时数据 | 无 |
| `updateRealtimeClock()` | app.js#L1031 | 更新顶部时间显示 | 无 | 无 |

#### API 接口

| 接口 | 方法 | 功能 | 返回格式 |
|------|------|------|----------|
| `/api/realtime/fetch` | POST | 爬取实时交通数据 | `{success: true, records: [...]}` |

#### 调用流程
```
用户点击"实时数据"按钮 → fetchRealtimeData() → POST /api/realtime/fetch 
→ 返回数据 → enterRealtimeMode() → processRealtimeData() → 启动粒子动画
```

---

### 3. 历史数据模式

#### 功能描述
选择历史日期，查看该日期的交通数据变化趋势，支持时间步滑块控制。

#### 核心函数

| 函数名 | 位置 | 功能说明 | 参数 | 返回值 |
|--------|------|----------|------|--------|
| `enterHistoryMode()` | app.js#L872 | 进入历史数据模式 | `dateStr`: 日期字符串(YYYY-MM-DD) | 无 |
| `exitHistoryMode()` | app.js#L913 | 退出历史数据模式 | 无 | 无 |
| `loadCsvByDate()` | app.js#L500 | 根据日期加载历史CSV数据 | `dateStr`: 日期字符串 | 无 |
| `showTimeSlider()` | app.js#L651 | 显示时间步滑块 | `historyByDetector`: 历史数据, `timeWindowMap`: 时间映射 | 无 |
| `updateMarkerColors()` | app.js#L822 | 根据速度更新节点颜色 | `timeStep`: 当前时间步 | 无 |

#### API 接口

| 接口 | 方法 | 功能 | 返回格式 |
|------|------|------|----------|
| `/api/history/available` | GET | 获取有数据的日期列表 | `{dates: [...]}` |
| `/api/history/:date` | GET | 获取指定日期的历史数据 | CSV文件流 |

#### 时间步计算逻辑
```javascript
// 历史模式下时间计算
if (currentActiveMode === 'history' && window._currentHistoryDate) {
    const baseTime = new Date(`${window._currentHistoryDate}T00:00:00`);
    const timeMinutes = timeStep * 10; // 每步10分钟
    currentDateTime = new Date(baseTime.getTime() + timeMinutes * 60 * 1000);
}
```

#### 调用流程
```
用户选择日期 → enterHistoryMode(date) → loadCsvByDate(date) 
→ 解析CSV → 构建historyByDetector → showTimeSlider() → 启动粒子动画
```

---

### 4. 预测模式（突发事件模拟）

#### 功能描述
模拟突发事件对交通的影响，使用 ASTGNN 模型预测路网中所有节点在事件发生后的速度变化。

#### 核心函数

| 函数名 | 位置 | 功能说明 | 参数 | 返回值 |
|--------|------|----------|------|--------|
| `submitEmergencySimulation()` | app.js#L2471 | 提交突发事件模拟请求 | 无 | 无 |
| `displayEmergencyResults()` | app.js#L2557 | 显示模拟结果 | `data`: 模拟返回数据 | 无 |
| `startEmergencyParticleSimulation()` | app.js#L2762 | 启动突发事件粒子模拟 | `nodeIds`: 受影响节点, `predictions`: 预测数据, `stepIdx`: 时间步 | 无 |
| `updatePredictionStep()` | app.js#L2686 | 更新预测时间步显示 | `stepIdx`: 时间步索引 | 无 |
| `initPredictionTimeSlider()` | app.js#L2642 | 初始化预测时间步滑块 | `steps`: 总步数, `timeStepMinutes`: 每步分钟数 | 无 |

#### API 接口

| 接口 | 方法 | 功能 | 返回格式 |
|------|------|------|----------|
| `/api/emergency/simulate` | POST | 提交突发事件模拟参数 | `{predictions: [...], steps: N}` |

#### 预测数据格式
```javascript
// predictions 结构：[[时间步0数据], [时间步1数据], ...]
// 每个时间步数据: [{node_id, flow, speed, occupancy}, ...]
predictions[stepIdx].forEach(pred => {
    predictionDataMap[pred.node_id] = {
        speed: pred.speed + 50,  // 速度+50偏移
        flow: pred.flow,
        occupancy: pred.occupancy
    };
});
```

#### 速度计算逻辑
- **预测数据优先**：使用 ASTGNN 模型返回的速度值 + 50 偏移
- **实时数据备用**：如果没有预测数据，使用实时数据的平均值

#### 调用流程
```
用户配置事件参数 → submitEmergencySimulation() 
→ POST /api/emergency/simulate → 返回预测数据
→ displayEmergencyResults() → startEmergencyParticleSimulation()
→ 拖动滑块 → updatePredictionStep()
```

---

### 5. 粒子动画系统

#### 功能描述
基于交通数据驱动的粒子动画，展示车流在道路上的流动效果。

#### 核心函数（particle.js）

| 函数名 | 功能说明 | 参数 | 返回值 |
|--------|----------|------|--------|
| `init()` | 初始化粒子模块 | 无 | 无 |
| `start()` | 启动粒子动画 | 无 | 无 |
| `stop()` | 停止粒子动画 | `clearParticles`: 是否清除粒子 | 无 |
| `resetTrafficData()` | 重置交通数据 | `externalData`: 外部交通数据 | 无 |
| `rebuildRoutes()` | 重建粒子路线 | 无 | 无 |
| `forceEmit()` | 强制从指定节点发射粒子 | `marker`: 节点标记, `speed`: 速度 | 无 |
| `updateColors()` | 更新粒子颜色 | 无 | 无 |
| `ensureAnimationRunning()` | 确保动画循环运行 | 无 | 无 |

#### 粒子颜色映射
| 速度范围(km/h) | 颜色 | 状态 |
|----------------|------|------|
| >= 60 | #5ad2af | 畅通 |
| >= 40 | #a8d8ea | 基本畅通 |
| >= 20 | #ffd369 | 缓行 |
| >= 10 | #ff9f43 | 拥堵 |
| < 10 | #ee5a24 | 严重拥堵 |

---

### 6. 热力图功能

#### 功能描述
基于交通流量数据生成热力图，直观展示交通繁忙程度。

#### 核心函数（heatmap.js）

| 函数名 | 功能说明 | 参数 | 返回值 |
|--------|----------|------|--------|
| `toggleHeat()` | 切换热力图显示/隐藏 | 无 | 无 |
| `updateHeatmapData()` | 更新热力图数据 | `timeStep`: 当前时间步 | 无 |

---

### 7. 用户界面交互

#### 核心函数（ui.js）

| 函数名 | 功能说明 | 参数 | 返回值 |
|--------|----------|------|--------|
| `initGlobalFixedMenu()` | 初始化全局固定菜单 | 无 | 无 |
| `handleMenuButtonClick()` | 处理菜单按钮点击 | `btn`: 按钮元素 | 无 |
| `syncEmergencyNodesInput()` | 同步选中节点到输入框 | 无 | 无 |
| `updateEmergencyParams()` | 更新突发事件参数 | 无 | 无 |

#### UI 组件

| 组件ID | 功能 | 关联功能模式 |
|--------|------|--------------|
| `showMarkersBtn` | 切换数据点显隐 | 全局 |
| `particleBtn` | 切换粒子动画 | 全局 |
| `heatBtn` | 切换热力图 | 全局 |
| `showHistoryBtn` | 打开历史数据日历 | 历史模式 |
| `predictTrafficBtn` | 打开突发事件模拟面板 | 预测模式 |
| `realtimeDataBtn` | 爬取实时数据 | 实时模式 |

---

## 全局状态管理

### 核心状态变量

| 变量名 | 类型 | 作用 | 初始值 |
|--------|------|------|--------|
| `currentActiveMode` | string/null | 当前激活模式 | `null` |
| `realtimeModeActive` | boolean | 实时模式是否激活 | `false` |
| `predictionModeActive` | boolean | 预测模式是否激活 | `false` |
| `currentDateTime` | Date/null | 当前显示时间 | `null` |
| `currentPredictionEvent` | string/null | 当前预测事件类型 | `null` |
| `globalParticlePaused` | boolean | 粒子是否暂停 | `false` |
| `visualPlaybackActive` | boolean | 可视化播放是否激活 | `true` |

### 模式状态机
```
┌─────────────────────────────────────────────────────────────┐
│                        初始状态                            │
│                   currentActiveMode = null                 │
└───────────────────────────┬───────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   实时模式     │   │   历史模式     │   │   预测模式     │
│ realtimeMode  │   │   history     │   │  prediction   │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                 任意模式 → stopAllVisualizations() → 重置状态
```

---

## 数据结构

### 实时数据格式
```javascript
{
    success: true,
    records: [
        { detector_id: "AID123", speed: 55, volume: 120 },
        // ...
    ]
}
```

### 历史数据格式（CSV）
```
detector_id,time_step,time_window,total_volume,avg_speed,avg_occupancy
AID001,0,2024-01-01 08:00,150,45,0.3
AID001,1,2024-01-01 08:10,180,42,0.35
// ...
```

### 预测数据格式
```javascript
{
    emergency_event: {
        type: "accident",
        node_ids: [1, 5, 12],
        severity: 0.7
    },
    predictions: [
        // 时间步 0
        [{ node_id: 1, speed: 25, flow: 80, occupancy: 0.6 }, ...],
        // 时间步 1
        [{ node_id: 1, speed: 28, flow: 90, occupancy: 0.55 }, ...],
        // ...
    ],
    steps: 12,
    time_step: 10  // 每步10分钟
}
```

---

## API 接口总览

### 后端 API（Node.js）

| 接口 | 方法 | 文件 | 功能 |
|------|------|------|------|
| `/api/history/available` | GET | routes/history.js | 获取可用历史日期列表 |
| `/api/history/:date` | GET | routes/history.js | 获取指定日期历史数据 |
| `/api/predict/:date` | GET | routes/predict.js | 获取预测数据（预留） |
| `/api/predict/status` | GET | routes/predict.js | 预测服务状态 |
| `/api/realtime/fetch` | POST | routes/realtime.js | 爬取实时数据 |
| `/api/events/simulate` | POST | routes/events.js | 突发事件模拟（预留） |
| `/api/events/status` | GET | routes/events.js | 事件服务状态 |
| `/api/plan/route` | POST | routes/plan.js | 路线规划 |

### Python API 代理

| 前端接口 | 代理目标 | 功能 |
|----------|----------|------|
| `/api/realtime/fetch` | `/api/python/realtime/fetch` | 实时数据爬取 |
| `/api/emergency/simulate` | `/api/python/emergency/simulate` | 突发事件模拟 |

---

## 启动方式

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 20.0.0 | 后端服务运行环境 |
| npm | >= 9.0.0 | Node.js 包管理器 |
| Python | >= 3.8.0 | 机器学习模型服务（可选） |
| PyTorch | >= 2.0.0 | ASTGNN 模型依赖（可选） |

### 方式一：一键启动（推荐）

使用项目提供的 `start.bat` 脚本，自动启动所有服务：

```bash
cd projects/backend
start.bat
```

**脚本执行流程**：
1. 启动 Python API 服务（端口 5001）
2. 等待 2 秒确保 Python 服务就绪
3. 启动 Node.js 后端服务（端口 3000）
4. 等待 5 秒确保服务启动完成
5. 自动打开浏览器访问 http://localhost:3000

### 方式二：手动启动

#### 1. 安装依赖

```bash
# 进入后端目录
cd projects/backend

# 安装 Node.js 依赖
npm install

# 安装 Python 依赖（如需使用预测功能）
pip install torch numpy pandas
```

#### 2. 启动服务

**启动 Python API（可选，预测功能需要）**：
```bash
cd projects/backend
python python_api.py
# 服务将在 http://localhost:5001 启动
```

**启动 Node.js 后端服务**：
```bash
cd projects/backend
npm start
# 服务将在 http://localhost:3000 启动
```

#### 3. 访问应用

打开浏览器访问：
```
http://localhost:3000
```

### 方式三：生产环境部署

使用 `scripts/` 目录下的部署脚本：

| 脚本文件 | 功能 | 使用方式 |
|----------|------|----------|
| `coze-deploy-build.sh` | 构建生产环境 | `./coze-deploy-build.sh` |
| `coze-deploy-run.sh` | 启动生产服务 | `./coze-deploy-run.sh` |
| `coze-preview-build.sh` | 构建预览环境 | `./coze-preview-build.sh` |
| `coze-preview-run.sh` | 启动预览服务 | `./coze-preview-run.sh` |

### 服务端口说明

| 服务 | 端口 | 配置位置 |
|------|------|----------|
| Node.js 后端 | 3000 | `server.js` |
| Python API | 5001 | `python_api.py` |

### 常见启动问题

#### Q1: 端口被占用
**现象**：`Error: listen EADDRINUSE: address already in use`

**解决**：
```bash
# Windows 查看占用端口的进程
netstat -ano | findstr ":3000"

# 终止占用进程（PID 为上一步查到的进程ID）
taskkill /F /PID <进程ID>
```

#### Q2: Python API 启动失败
**现象**：Python 脚本报错或无法启动

**解决**：
1. 确保已安装所需依赖：`pip install torch numpy pandas`
2. 检查 Python 版本 >= 3.8.0
3. 确保 `adj_matrix.npy` 和 `astgnn.pth` 文件存在于 `backend/` 目录

#### Q3: 页面无法访问
**现象**：浏览器显示 "无法访问此网站"

**解决**：
1. 检查 Node.js 服务是否正常启动
2. 确认端口 3000 未被防火墙阻止
3. 尝试直接访问 http://127.0.0.1:3000

### 启动日志说明

正常启动时，终端应显示以下日志：

```
◇ injected env (0) from .env
[Plan] 加载数据点文件: C:\Users\27773\Desktop\半成品\projects\data\base\hk_data_new.csv
[Plan] 使用编码 utf-8 成功加载 1005 个数据点
=====================================================
  灵动交通可视化平台后端服务已启动
  访问地址: http://localhost:3000
  API 前缀: /api
=====================================================
```

---

## 关键技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | Leaflet | 1.9.4 | 地图可视化 |
| 前端语言 | JavaScript | ES6+ | 交互逻辑 |
| 后端框架 | Express | 4.18.2 | API服务 |
| 后端语言 | Node.js | 20+ | 服务端运行 |
| 机器学习 | Python + PyTorch | - | ASTGNN模型 |
| 数据格式 | GeoJSON | - | 路网数据 |
| 数据格式 | CSV | - | 检测器数据 |

---

## 模块调用关系图

```
┌────────────────────────────────────────────────────────────────────┐
│                         index.html                                │
│                              │                                    │
│                              ▼                                    │
│              ┌─────────────────────────────────┐                  │
│              │            app.js                │                  │
│              │  ┌───────────────────────────┐  │                  │
│              │  │  全局状态管理              │  │                  │
│              │  │  模式状态机                │  │                  │
│              │  │  数据加载逻辑              │  │                  │
│              │  └───────────────────────────┘  │                  │
│              └───────────────┬─────────────────┘                  │
│                              │                                    │
│         ┌────────────────────┼────────────────────┐               │
│         ▼                    ▼                    ▼               │
│   ┌───────────┐       ┌───────────┐       ┌───────────┐          │
│   │   ui.js   │       │particle.js│       │heatmap.js │          │
│   │  UI交互   │       │ 粒子系统  │       │ 热力图    │          │
│   └───────────┘       └───────────┘       └───────────┘          │
│                              │                                    │
│                              ▼                                    │
│              ┌─────────────────────────────────┐                  │
│              │         Leaflet Map             │                  │
│              │  (图层: 底图 + 路网 + Marker)   │                  │
│              └─────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────┐
              │          server.js              │
              │  (Express + API路由)            │
              └─────────────────────────────────┘
                              │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       ┌─────────┐      ┌─────────┐      ┌─────────┐
       │ history │      │ predict │      │ realtime│
       │  routes │      │  routes │      │  routes │
       └─────────┘      └─────────┘      └─────────┘
                              │
                              ▼
                     ┌─────────────┐
                     │python_api.py│
                     │ (ASTGNN模型)│
                     └─────────────┘
```

---

## 代码规范

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 函数名 | 驼峰式 | `loadBaseData()` |
| 变量名 | 驼峰式 | `currentDateTime` |
| 全局变量 | 前缀 `window._` | `window._predictionData` |
| 常量 | 大写下划线 | `MARKER_BASE_RADIUS` |

### 注释规范

```javascript
/**
 * 函数功能说明
 * @param {类型} 参数名 - 参数描述
 * @returns {类型} 返回值描述
 */
function exampleFunction(param) {
    // 单行注释：说明关键逻辑
    // ...
}
```

---

## 常见问题

### Q1: 粒子动画不显示
**原因**：粒子模块未初始化或路线未重建
**解决**：调用 `window.ParticleModule.init()` 和 `window.ParticleModule.rebuildRoutes()`

### Q2: 历史模式时间不更新
**原因**：`currentActiveMode` 状态在 `stopAllVisualizations()` 中被重置
**解决**：确保在 `stopAllVisualizations()` 之后设置 `currentActiveMode = 'history'`

### Q3: 预测模式节点全黄
**原因**：预测数据未正确匹配到节点
**解决**：确保预测数据的 `node_id` 与 marker 的行号一致，使用数字ID格式

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 1.0.0 | 2024 | 初始版本，基础地图可视化 |
| 1.1.0 | 2024 | 添加实时数据爬取功能 |
| 1.2.0 | 2024 | 添加历史数据模式 |
| 1.3.0 | 2024 | 添加突发事件预测模式 |
| 1.4.0 | 2024 | 修复粒子颜色、时间更新等Bug |

---

## 开发团队

- **项目负责人**：-
- **前端开发**：-
- **后端开发**：-
- **算法工程师**：-

---

*文档生成日期：2024年*
