/**
 * particle.js
 * 灵动交通可视化平台 - 粒子动效模块
 * 
 * 职责：
 * 1. 解析交通流量 CSV 数据，构建时间步矩阵（volumeMatrix, speedMatrix）
 * 2. 根据检测器之间的连接关系（Connection1~5）构建有向路径集合
 * 3. 将 marker 与流量数据中的 detector_id 进行匹配映射
 * 4. 按时间步自动发射粒子，粒子颜色随速度变化（红→黄→绿）
 * 5. 粒子到达终点后自动"接力"，在下游检测器继续发射新粒子
 * 6. 支持播放/暂停、时间步自动推进（1秒/步）
 * 
 * 核心概念：
 * - 时间步（timeStep）：CSV 中 time_step 列，代表一天中的不同时段（如每5分钟一个时间步）
 * - 发射预算（remainingEmitBudget）：每个时间步开始时，根据该时段流量计算每个检测器应发射多少粒子
 * - 接力机制：粒子到达终点后，如果终点检测器仍有发射预算，则自动消费预算并发射新粒子
 * 
 * 依赖：
 * - 全局变量 map, markers, csvData 由 app.js 初始化
 * - 全局状态 visualPlaybackActive, globalParticlePaused 由 app.js 控制
 */

// ==================== 模块级状态变量 ====================

/** 粒子动画是否处于运行状态 */
let particleMode = false;

/** 路线规划模式状态 */
let planModeState = {
    active: false,
    matchedIds: null,    // Set<detector_id>
    planEdges: null      // Array<{from, to, fromLat, fromLng, toLat, toLng}>
};

/** 粒子系统容器对象 { container: DOMElement, routes: Array } */
let particleSystem = null;

/** requestAnimationFrame 返回的 ID，用于停止动画循环 */
let animationFrameId = null;

/** 自动时间步推进的 setInterval ID */
let autoStepIntervalId = null;

// -------------------- 交通数据矩阵 --------------------
/** 所有时间步的编号数组，如 [0, 1, 2, ..., 287] */
let timeSteps = [];

/** 流量矩阵：volumeMatrix[t][d] 表示第 t 个时间步、第 d 个检测器的总流量 */
let volumeMatrix = [];

/** 速度矩阵：speedMatrix[t][d] 表示第 t 个时间步、第 d 个检测器的平均速度 */
let speedMatrix = [];

/** time_step → time_window 映射，如 0 → "2024/1/1 0:00" */
let timeWindowMap = new Map();

/** 当前所处的时间步索引 */
let currentTimeStep = 0;

// -------------------- 检测器映射 --------------------
/** trafficDetectorToCol: Map<detector_id, column_index>
 *  将 CSV 中的 detector_id 映射到流量矩阵的列索引 */
let trafficDetectorToCol = new Map();

/** markerToTrafficCol: Map<Marker, column_index>
 *  将地图上的 marker 对象映射到流量矩阵的列索引 */
let markerToTrafficCol = new Map();

// -------------------- 粒子管理 --------------------
/** activeParticles: Array<ParticleObject>
 *  当前正在屏幕上运动的粒子对象数组 */
let activeParticles = [];

/** remainingEmitBudget: Map<Marker, number>
 *  当前时间步中，每个检测器剩余可发射的粒子数量 */
let remainingEmitBudget = new Map();

// -------------------- 统计与定时器 --------------------
/** 当前时间步已经发射的粒子总数（用于调试统计） */
let currentStepEmitCount = 0;

/** pendingTimers: Array<timeoutID>
 *  存储所有未执行的 setTimeout ID，用于暂停时一键清除 */
let pendingTimers = [];

// ==================== 常量配置 ====================

/** 流量转粒子数的除数：每 80 辆车对应 1 个粒子（数值越大粒子越稀疏） */
const VOLUME_DIVISOR = 80;

/** 单个检测器每时间步最多发射粒子数上限 */
const MAX_PARTICLES_PER_SECOND = 6;

/** 屏幕上同时存在的粒子数量上限，防止性能崩溃 */
const MAX_CONCURRENT_PARTICLES = 800;

/** 粒子最小运动速度（米/秒），避免速度过慢导致粒子长时间停留 */
const MIN_SPEED_MS = 10;

/** 速度乘数，让粒子视觉上更快（不影响颜色计算） */
const SPEED_MULTIPLIER = 2.5;

/** 自动时间步推进间隔（毫秒），即每 1 秒切换一个时间步 */
const AUTO_STEP_INTERVAL_MS = 1000;

/** 默认加载的历史数据文件路径（通过后端静态资源托管访问） */
const DEFAULT_DATA_URL = '/data/monthly/2024-01/fd_2024-01-01.csv';

// ==================== 工具函数 ====================

/**
 * 根据速度值计算粒子颜色（红→黄→绿渐变）
 * @param {number} speed - 速度值（km/h）
 * @returns {string} - CSS rgb 颜色字符串
 */
function getColorBySpeed(speed) {
    const t = Math.min(100, Math.max(0, speed)) / 100;
    let r, g, b;
    if (t < 0.5) {
        // 低速：红色为主，随速度增加向黄色过渡
        r = 255;
        g = Math.floor(255 * (t / 0.5));
        b = 0;
    } else {
        // 高速：黄色向绿色过渡
        r = Math.floor(255 * (1 - (t - 0.5) / 0.5));
        g = 255;
        b = 0;
    }
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 解析单行 CSV 文本（与 ui.js 的 parseLine 逻辑相同，保持模块独立）
 * @param {string} line - 一行 CSV 文本
 * @returns {string[]} - 字段数组
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ==================== 路径收集 ====================

/**
 * 从全局 csvData 和 markers 中收集所有有向连接路径
 * 每个 marker 的 connCols 中存储了 Connection1~5 的列索引，
 * 对应值为目标 marker 的行号（从 2 开始）
 */
function collectRoutes() {
    if (!particleSystem) return;
    particleSystem.routes = [];
    
    // 规划模式：只收集路线关联的边
    if (planModeState.active && planModeState.planEdges) {
        console.log(`[粒子] 规划模式：从 ${planModeState.planEdges.length} 条关联边中收集路线`);
        for (const edge of planModeState.planEdges) {
            // 通过 detector_id 找到对应的 marker
            const startMarker = findMarkerByDetectorId(edge.from);
            const endMarker = findMarkerByDetectorId(edge.to);
            if (startMarker && endMarker) {
                particleSystem.routes.push({
                    start: startMarker.getLatLng(),
                    end: endMarker.getLatLng(),
                    startMarker,
                    endMarker
                });
            }
        }
        console.log(`[粒子] 规划模式收集到 ${particleSystem.routes.length} 条有向边`);
        return;
    }
    
    // 正常模式：收集所有边
    for (let i = 0; i < window.csvData.length; i++) {
        const row = window.csvData[i];
        const m = window.markers[i];
        if (!m || !m.connCols) continue;
        for (let j of m.connCols) {
            if (j === -1 || j >= row.length) continue;
            const v = (row[j] || '').trim();
            if (!v || v.toLowerCase() === 'others' || v.toLowerCase() === 'n/a') continue;
            const r = parseInt(v, 10);
            if (isNaN(r) || r < 2 || r - 2 >= window.markers.length) continue;
            const cm = window.markers[r - 2];
            if (cm) {
                particleSystem.routes.push({
                    start: m.getLatLng(),
                    end: cm.getLatLng(),
                    startMarker: m,
                    endMarker: cm
                });
            }
        }
    }
    console.log(`[粒子] 收集到 ${particleSystem.routes.length} 条有向边`);
}

// ==================== 交通数据解析 ====================

/**
 * 解析交通流量 CSV 文本，构建 volumeMatrix 和 speedMatrix
 * @param {string} csvText - CSV 文件完整文本
 * @returns {boolean} - 解析是否成功
 */
function parseTrafficCSV(csvText) {
    const lines = csvText.split(/\r\n|\r|\n/).filter(l => l.trim());
    if (lines.length < 2) return false;

    const headers = parseCSVLine(lines[0]);
    const colIdx = {
        detector: headers.findIndex(h => /detector_id/i.test(h)),
        timeStep: headers.findIndex(h => /time_step/i.test(h)),
        timeWindow: headers.findIndex(h => /time_window/i.test(h)),
        volume: headers.findIndex(h => /total_volume/i.test(h)),
        speed: headers.findIndex(h => /avg_speed/i.test(h))
    };
    if (colIdx.detector === -1 || colIdx.timeStep === -1 || colIdx.volume === -1 || colIdx.speed === -1) {
        console.error('[粒子] CSV 缺少必要列（detector_id / time_step / total_volume / avg_speed）');
        return false;
    }

    const timeMap = new Map();
    const detectorSet = new Set();
    let maxTimeStep = 0;
    timeWindowMap.clear();

    // 逐行解析数据，按 time_step 分组存储
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCSVLine(lines[i]);
        if (cells.length <= Math.max(colIdx.detector, colIdx.timeStep, colIdx.volume, colIdx.speed)) continue;
        const rawDetId = cells[colIdx.detector];
        const timeStep = parseInt(cells[colIdx.timeStep], 10);
        const volume = parseFloat(cells[colIdx.volume]) || 0;
        const speed = parseFloat(cells[colIdx.speed]) || 0;
        if (isNaN(timeStep) || !rawDetId) continue;

        const detIdStr = String(rawDetId).trim();
        detectorSet.add(detIdStr);
        if (timeStep > maxTimeStep) maxTimeStep = timeStep;

        // 保存 time_window 映射
        if (colIdx.timeWindow !== -1 && cells[colIdx.timeWindow]) {
            const tw = cells[colIdx.timeWindow].trim();
            if (tw && !timeWindowMap.has(timeStep)) {
                timeWindowMap.set(timeStep, tw);
            }
        }

        if (!timeMap.has(timeStep)) timeMap.set(timeStep, new Map());
        const stepMap = timeMap.get(timeStep);
        stepMap.set(detIdStr, { volume, speed });
    }

    const T = maxTimeStep + 1;
    const detectorList = Array.from(detectorSet);
    const D = detectorList.length;

    // 建立 detector_id -> 列索引 的映射
    trafficDetectorToCol.clear();
    detectorList.forEach((id, idx) => {
        trafficDetectorToCol.set(id, idx);
        const numId = Number(id);
        if (!isNaN(numId) && String(numId) !== id) {
            trafficDetectorToCol.set(numId, idx);
        }
    });

    // 初始化全零矩阵
    volumeMatrix = Array(T).fill().map(() => Array(D).fill(0));
    speedMatrix = Array(T).fill().map(() => Array(D).fill(0));

    // 填充矩阵数据
    for (let t = 0; t < T; t++) {
        const stepMap = timeMap.get(t);
        if (stepMap) {
            for (let [detIdStr, data] of stepMap.entries()) {
                const col = trafficDetectorToCol.get(detIdStr);
                if (col !== undefined) {
                    volumeMatrix[t][col] = data.volume;
                    speedMatrix[t][col] = data.speed;
                }
            }
        }
    }

    timeSteps = Array.from({ length: T }, (_, i) => i);
    console.log(`[粒子] 解析完成：${T} 个时间步，${D} 个检测器`);
    return true;
}

// ==================== Marker 映射 ====================

/**
 * 将地图上的 markers 与流量数据中的检测器 ID 进行匹配
 * 匹配依据：marker.rowData.detector_id（或 ID / id / Detector_ID 等别名）
 * @returns {number} - 成功匹配的 marker 数量
 */
function buildMarkerToTrafficCol() {
    markerToTrafficCol.clear();
    let matched = 0;
    let unmatchedExample = null;
    for (let i = 0; i < window.markers.length; i++) {
        const marker = window.markers[i];
        const row = marker.rowData;
        if (!row) continue;
        let detectorId = null;
        if (row.detector_id !== undefined) detectorId = row.detector_id;
        else if (row.Detector_ID !== undefined) detectorId = row.Detector_ID;
        else if (row.id !== undefined) detectorId = row.id;
        else if (row.ID !== undefined) detectorId = row.ID;
        if (detectorId !== null && detectorId !== undefined) {
            const idStr = String(detectorId).trim();
            let col = trafficDetectorToCol.get(idStr);
            if (col === undefined) {
                const numId = Number(idStr);
                if (!isNaN(numId)) col = trafficDetectorToCol.get(numId);
                if (col === undefined) col = trafficDetectorToCol.get(String(numId));
            }
            if (col !== undefined) {
                markerToTrafficCol.set(marker, col);
                matched++;
            } else if (unmatchedExample === null) {
                unmatchedExample = idStr;
            }
        }
    }
    console.log(`[粒子] 标记到流量列索引匹配：${matched}/${window.markers.length}`);
    if (matched < window.markers.length) {
        console.warn(`[粒子] 未匹配的检测器示例: ${unmatchedExample}`);
        console.warn(`[粒子] 请检查基础数据中的 detector_id 是否与流量 CSV 中的 detector_id 一致`);
    }
    return matched;
}

/**
 * 获取指定 marker 在当前时间步的流量和速度
 * @param {L.CircleMarker} marker - Leaflet 标记对象
 * @returns {{volume: number, speed: number}}
 */
function getCurrentTrafficForMarker(marker) {
    if (!marker || currentTimeStep < 0 || currentTimeStep >= timeSteps.length) {
        return { volume: 0, speed: 0 };
    }
    const col = markerToTrafficCol.get(marker);
    if (col === undefined) return { volume: 0, speed: 0 };
    return {
        volume: volumeMatrix[currentTimeStep][col],
        speed: speedMatrix[currentTimeStep][col]
    };
}

// ==================== 粒子发射逻辑 ====================

/**
 * 强制发射一个粒子（不检查并发数量上限）
 * 主要用于时间步切换时的种子发射，以及到达接力时的强制发射
 * @param {L.CircleMarker} marker - 起始检测器标记
 * @param {number} speedKmh - 粒子运动速度（km/h）
 * @returns {boolean} - 是否发射成功
 */
function forceEmitParticle(marker, speedKmh) {
    if (!particleMode || !particleSystem) return false;
    // 防御：确保有有效数据
    if (!markerToTrafficCol || markerToTrafficCol.size === 0) return false;
    if (!particleSystem.routes || particleSystem.routes.length === 0) return false;
    const outRoutes = particleSystem.routes.filter(r => r.startMarker === marker);
    if (outRoutes.length === 0) return false;
    const route = outRoutes[Math.floor(Math.random() * outRoutes.length)];
    createParticle(marker, route.endMarker, speedKmh, (endMarker) => {
        // 到达回调：接力发射
        const budget = remainingEmitBudget.get(endMarker);
        if (budget && budget > 0) {
            remainingEmitBudget.set(endMarker, budget - 1);
            const { speed } = getCurrentTrafficForMarker(endMarker);
            forceEmitParticle(endMarker, speed);
        }
    }, true); // isRelay = true
    currentStepEmitCount++;
    return true;
}

/**
 * 正常发射一个粒子（受 MAX_CONCURRENT_PARTICLES 并发上限限制）
 * @param {L.CircleMarker} marker - 起始检测器标记
 * @param {number} speedKmh - 粒子运动速度（km/h）
 * @returns {boolean}
 */
function emitOneParticle(marker, speedKmh) {
    if (!particleSystem) return false;
    if (activeParticles.length >= MAX_CONCURRENT_PARTICLES) return false;
    const outRoutes = particleSystem.routes.filter(r => r.startMarker === marker);
    if (outRoutes.length === 0) return false;
    const route = outRoutes[Math.floor(Math.random() * outRoutes.length)];
    createParticle(marker, route.endMarker, speedKmh, (endMarker) => {
        // 到达回调：接力发射
        const budget = remainingEmitBudget.get(endMarker);
        if (budget && budget > 0) {
            remainingEmitBudget.set(endMarker, budget - 1);
            const { speed } = getCurrentTrafficForMarker(endMarker);
            emitOneParticle(endMarker, speed);
        }
    }, true); // isRelay = true
    currentStepEmitCount++;
    return true;
}

/**
 * 清除所有待执行的 setTimeout 定时器
 * 用于暂停粒子发射或切换时间步时重置调度
 */
function clearPendingTimers() {
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    pendingTimers = [];
}

/**
 * 为当前时间步的所有预算粒子调度随机延迟发射
 * 每个粒子的延迟在 0 ~ AUTO_STEP_INTERVAL_MS 之间随机，使发射更自然
 */
function scheduleRandomEmissions() {
    clearPendingTimers();
    const emitTasks = [];
    for (const [marker, count] of remainingEmitBudget.entries()) {
        const { speed } = getCurrentTrafficForMarker(marker);
        for (let i = 0; i < count; i++) {
            const delay = Math.random() * AUTO_STEP_INTERVAL_MS;
            emitTasks.push({ delay, marker, speed });
        }
    }
    for (const task of emitTasks) {
        const timer = setTimeout(() => {
            forceEmitParticle(task.marker, task.speed);
            const idx = pendingTimers.indexOf(timer);
            if (idx !== -1) pendingTimers.splice(idx, 1);
        }, task.delay);
        pendingTimers.push(timer);
    }
    console.log(`[时间步 ${currentTimeStep}] 已调度 ${emitTasks.length} 个粒子发射任务`);
}

/**
 * 重置当前时间步的发射预算，并立即调度随机发射
 * 预算计算：ceil(流量 / VOLUME_DIVISOR)，上限 MAX_PARTICLES_PER_SECOND
 */
function resetAndEmitBudget() {
    if (!particleMode) return;
    // 防御：确保有有效数据和路线后再发射
    if (!markerToTrafficCol || markerToTrafficCol.size === 0) {
        console.warn('[粒子] 无有效流量数据，跳过发射');
        return;
    }
    if (!particleSystem || !particleSystem.routes || particleSystem.routes.length === 0) {
        console.warn('[粒子] 无有效路线，跳过发射');
        return;
    }
    remainingEmitBudget.clear();
    let totalBudget = 0;
    for (const marker of markerToTrafficCol.keys()) {
        // 规划模式下：只为路线匹配的检测器分配预算
        if (planModeState.active && planModeState.matchedIds) {
            const detId = marker.rowData ? String(marker.rowData.detector_id).trim() : '';
            if (!planModeState.matchedIds.has(detId)) continue;
        }
        const { volume } = getCurrentTrafficForMarker(marker);
        let particles = Math.ceil(volume / VOLUME_DIVISOR);
        if (particles <= 0) continue;
        particles = Math.min(particles, MAX_PARTICLES_PER_SECOND);
        remainingEmitBudget.set(marker, particles);
        totalBudget += particles;
    }
    console.log(`[时间步 ${currentTimeStep}] 发射预算: 共 ${remainingEmitBudget.size} 个检测器，总粒子预算 ${totalBudget}`);
    scheduleRandomEmissions();
}

// ==================== 粒子创建与动画 ====================

/**
 * 在地图上创建一个运动粒子
 * @param {L.CircleMarker} startMarker - 起点标记
 * @param {L.CircleMarker} endMarker - 终点标记
 * @param {number} speedKmh - 速度（km/h）
 * @param {Function} onArrivalCallback - 到达终点后的回调函数，接收 endMarker 作为参数
 * @returns {Object|null} - 粒子对象，若创建失败返回 null
 */
function createParticle(startMarker, endMarker, speedKmh, onArrivalCallback, isRelay) {
    if (!particleSystem?.container) return null;
    if (activeParticles.length >= MAX_CONCURRENT_PARTICLES) return null;

    const start = startMarker.getLatLng();
    const end = endMarker.getLatLng();
    // 将 km/h 转换为 m/s，应用速度乘数，并限制最小速度
    const speedMs = Math.max(speedKmh * 1000 / 3600 * SPEED_MULTIPLIER, MIN_SPEED_MS);
    // 计算两点间实际地理距离（米）
    const distMeters = window.map.distance(start, end);
    // 运动时长（毫秒）= 距离 / 速度 * 1000，上限 4 秒
    let durationMs = (distMeters / speedMs) * 1000;
    durationMs = Math.min(durationMs, 4000);

    const particleColor = getColorBySpeed(speedKmh);
    const el = document.createElement('div');
    el.className = 'particle';
    el.style.background = particleColor;
    el.style.boxShadow = `0 0 2px ${particleColor}`;

    const sp = window.map.latLngToContainerPoint(start);
    el.style.left = `${sp.x - 2}px`;
    el.style.top = `${sp.y - 2}px`;
    particleSystem.container.appendChild(el);

    // 粒子对象：包含 DOM 元素、地理坐标、运动参数、回调
    const particleObj = {
        el, startMarker, endMarker,
        startLatLng: start, endLatLng: end,
        progress: 0,
        startTime: Date.now(),
        duration: durationMs,
        onArrival: onArrivalCallback,
        isRelay: isRelay || false
    };
    activeParticles.push(particleObj);
    return particleObj;
}

/**
 * 粒子动画主循环（通过 requestAnimationFrame 驱动）
 * 每帧更新所有粒子的位置，并清理已到达终点的粒子
 */
function updateParticleAnimations() {
    if (!particleSystem?.container) return;
    const now = Date.now();
    const toRemove = [];

    for (let i = 0; i < activeParticles.length; i++) {
        const p = activeParticles[i];

        // 暂停时完全冻结进度，不推进时间
        if (!window.globalParticlePaused) {
            // 扣除累计暂停时长，计算真实运动时间
            const elapsed = now - p.startTime - window.particlePauseTime;
            p.progress = Math.min(elapsed / p.duration, 1);
        }

        // 将地理坐标转换为屏幕坐标，更新粒子位置
        const startPoint = window.map.latLngToContainerPoint(p.startLatLng);
        const endPoint = window.map.latLngToContainerPoint(p.endLatLng);
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        p.el.style.left = `${startPoint.x - 2}px`;
        p.el.style.top = `${startPoint.y - 2}px`;
        p.el.style.transform = `translate(${dx * p.progress}px, ${dy * p.progress}px)`;

        // 非接力粒子：起点渐显、终点渐隐
        if (!p.isRelay) {
            let opacity = 1;
            if (p.progress < 0.15) {
                opacity = p.progress / 0.15;
            } else if (p.progress > 0.85) {
                opacity = (1 - p.progress) / 0.15;
            }
            p.el.style.opacity = Math.max(0, Math.min(1, opacity));
        }

        // 仅在非暂停状态下移除到达终点的粒子，并触发到达回调
        if (!window.globalParticlePaused && p.progress >= 1) {
            if (p.onArrival) p.onArrival(p.endMarker);
            p.el.remove();
            toRemove.push(i);
        }
    }

    // 从数组中倒序移除已到达的粒子（避免索引错乱）
    for (let i = toRemove.length - 1; i >= 0; i--) {
        activeParticles.splice(toRemove[i], 1);
    }

    animationFrameId = requestAnimationFrame(updateParticleAnimations);
}

/**
 * 重置流量数据，使下次启动粒子时重新加载默认数据
 * 同时彻底停止渲染循环，防止残留粒子继续绘制
 */
function resetTrafficData() {
    // 彻底停止渲染循环和定时器
    particleMode = false;
    clearPendingTimers();
    clearAllParticles();
    remainingEmitBudget.clear();
    currentStepEmitCount = 0;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    stopAutoStep();

    // 重置粒子暂停时间补偿，防止跨会话累积导致新粒子进度为负
    if (typeof window.particlePauseTime !== 'undefined') window.particlePauseTime = 0;
    if (typeof window.lastPauseTimestamp !== 'undefined') window.lastPauseTimestamp = 0;

    // 重置数据
    timeSteps = [];
    timeWindowMap = new Map();
    markerToTrafficCol = new Map();
    currentTimeStep = 0;
    console.log('[粒子] 流量数据已重置（含渲染循环清理）');
}

// ==================== 时间步控制 ====================

/**
 * 启动自动时间步推进定时器
 * 每 AUTO_STEP_INTERVAL_MS（1秒）推进到下一个时间步，循环往复
 */
function startAutoStep() {
    if (autoStepIntervalId) clearInterval(autoStepIntervalId);
    autoStepIntervalId = setInterval(() => {
        if (!window.visualPlaybackActive) return;
        if (timeSteps.length === 0) return;

        // 规划模式：使用 app.js 管理的范围循环
        if (window._planStepRange) {
            const { start, end } = window._planStepRange;
            let nextStep = currentTimeStep + 1;
            if (nextStep > end) nextStep = start;
            setCurrentTimeStep(nextStep);
            return;
        }

        let nextStep = currentTimeStep + 1;
        if (nextStep >= timeSteps.length) nextStep = 0;
        setCurrentTimeStep(nextStep);
    }, AUTO_STEP_INTERVAL_MS);
}

/**
 * 停止自动时间步推进
 */
function stopAutoStep() {
    if (autoStepIntervalId) {
        clearInterval(autoStepIntervalId);
        autoStepIntervalId = null;
    }
}

/**
 * 清空所有粒子（从 DOM 和内存中彻底移除）
 */
function clearAllParticles() {
    for (const p of activeParticles) if (p.el && p.el.remove) p.el.remove();
    activeParticles = [];
    if (particleSystem?.container) particleSystem.container.innerHTML = '';
}

// ==================== 模块初始化与数据加载 ====================

/**
 * 初始化粒子系统 DOM 容器
 * 在 body 中创建一个绝对定位的 div，用于容纳所有粒子元素
 */
function initParticleModule() {
    if (particleSystem?.container) particleSystem.container.remove();
    const container = document.createElement('div');
    container.id = 'particleContainer';
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;overflow:hidden';
    document.body.appendChild(container);
    particleSystem = { container, particles: [], routes: [] };
    collectRoutes();
    console.log('[粒子] 模块初始化完成');
}

/**
 * 加载交通流量 CSV 数据并准备发射
 * @param {string} csvText - CSV 文件完整文本
 * @returns {boolean} - 加载是否成功
 */
function loadTrafficData(csvText) {
    if (!parseTrafficCSV(csvText)) return false;
    if (currentTimeStep >= timeSteps.length) currentTimeStep = 0;
    clearAllParticles();
    const matched = buildMarkerToTrafficCol();
    if (matched === 0) {
        console.error('[粒子] 没有标记匹配到流量数据，请检查 detector_id 是否一致');
        return false;
    }
    if (particleMode) {
        currentStepEmitCount = 0;
        resetAndEmitBudget();
    }
    return true;
}

/**
 * 切换到指定时间步，并重置发射预算调度新粒子
 * @param {number} stepIndex - 目标时间步索引
 */
function setCurrentTimeStep(stepIndex) {
    if (stepIndex < 0) stepIndex = 0;
    if (stepIndex >= timeSteps.length) stepIndex = timeSteps.length - 1;
    if (currentTimeStep === stepIndex) return;

    console.log(`[时间步 ${currentTimeStep}] 结束，该时间步共发射粒子: ${currentStepEmitCount} 个`);

    currentTimeStep = stepIndex;
    console.log(`[时间步切换] 切换到 ${currentTimeStep}`);

    // 通知外部更新信息条
    if (typeof window.onTimeStepChange === 'function') {
        window.onTimeStepChange(currentTimeStep, timeWindowMap.get(String(currentTimeStep)) || '');
    }

    if (particleMode) {
        clearPendingTimers();
        remainingEmitBudget.clear();
        let totalBudget = 0;
        for (const marker of markerToTrafficCol.keys()) {
            // 规划模式下：只为路线匹配的检测器分配预算
            if (planModeState.active && planModeState.matchedIds) {
                const detId = marker.rowData ? String(marker.rowData.detector_id).trim() : '';
                if (!planModeState.matchedIds.has(detId)) continue;
            }
            const { volume } = getCurrentTrafficForMarker(marker);
            let particles = Math.ceil(volume / VOLUME_DIVISOR);
            if (particles <= 0) continue;
            particles = Math.min(particles, MAX_PARTICLES_PER_SECOND);
            remainingEmitBudget.set(marker, particles);
            totalBudget += particles;
        }
        console.log(`[时间步 ${currentTimeStep}] 新预算: 共 ${remainingEmitBudget.size} 个检测器，总粒子预算 ${totalBudget}`);
        currentStepEmitCount = 0;
        scheduleRandomEmissions();
    }
}

/**
 * 获取当前时间步的数值
 * @returns {number}
 */
function getCurrentTimeStepValue() {
    return timeSteps[currentTimeStep] !== undefined ? timeSteps[currentTimeStep] : 0;
}

// ==================== 播放控制 ====================

/**
 * 启动粒子动画
 * 如果尚未加载流量数据，会先尝试加载默认数据文件
 */
async function startParticleAnimation() {
    if (particleMode) return;
    console.log('[粒子] 尝试启动粒子动画...');

    // 强制全量重置：清除任何残留的旧粒子、定时器、动画帧
    // 不经过 stopParticleAnimation 的 particleMode 守卫，直接清理底层资源
    clearPendingTimers();
    clearAllParticles();
    remainingEmitBudget.clear();
    currentStepEmitCount = 0;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    // 重置暂停时间补偿，防止跨会话累积导致新粒子进度为负（粒子从外面飞回来）
    if (typeof window.particlePauseTime !== 'undefined') window.particlePauseTime = 0;
    if (typeof window.lastPauseTimestamp !== 'undefined') window.lastPauseTimestamp = 0;

    // 若未加载过流量数据，尝试加载默认文件
    const needReload = timeSteps.length === 0;
    if (needReload) {
        console.log('[粒子] 需要重新加载流量数据, timeSteps:', timeSteps.length);
        try {
            const resp = await fetch(DEFAULT_DATA_URL);
            if (!resp.ok) {
                console.error(`[粒子] 无法加载默认数据文件: ${DEFAULT_DATA_URL}`);
                return;
            }
            const csvText = await resp.text();
            const success = loadTrafficData(csvText);
            if (!success) {
                console.error('[粒子] 解析默认数据失败');
                return;
            }
            console.log(`[粒子] 默认数据加载成功，时间步数: ${timeSteps.length}`);
            if (window.markers && window.markers.length > 0) {
                collectRoutes();
                console.log(`[粒子] 路线已重新收集，${particleSystem.routes.length} 条路线`);
            }
        } catch (err) {
            console.error('[粒子] 加载默认数据出错', err);
            return;
        }
    }

    if (timeSteps.length === 0) {
        console.error('[粒子] 没有可用的流量数据，无法启动粒子动画');
        return;
    }

    if (!particleSystem) initParticleModule();
    // 始终重新收集路线和流量映射，确保与当前模式的数据一致
    collectRoutes();
    buildMarkerToTrafficCol();

    particleMode = true;
    const btn = document.getElementById('particleBtn');
    if (btn) btn.classList.add('active');
    // 立即设置发射预算
    resetAndEmitBudget();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(updateParticleAnimations);
    startAutoStep();
    console.log('[粒子] 动画已启动');
}

/**
 * 停止粒子动画并清理所有资源
 * @param {boolean} stopAutoStepToo - 是否同时停止时间步推进（默认 true，由播放按钮调用时传 false）
 */
function stopParticleAnimation(stopAutoStepToo) {
    if (stopAutoStepToo === undefined) stopAutoStepToo = true;
    // 不再以 particleMode 为守卫跳过清理——即使已停止也要确保底层资源释放
    particleMode = false;
    const btn = document.getElementById('particleBtn');
    if (btn) btn.classList.remove('active');
    clearPendingTimers();
    clearAllParticles();
    remainingEmitBudget.clear();
    currentStepEmitCount = 0;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (stopAutoStepToo) {
        stopAutoStep();
    }
    console.log('[粒子] 动画已停止（含完整清理）');
}

/**
 * 切换粒子动画的启动/停止状态
 * 供左上角的粒子按钮调用
 * 粒子开关仅控制粒子可见性，不影响时间步推进
 */
function toggleParticleAnimation() {
    console.log('[粒子] toggle 被调用, 当前状态:', particleMode);
    if (particleMode) {
        // 关闭粒子时：不停止 autoStep（时间步继续由播放按钮控制）
        stopParticleAnimation(false);
    } else {
        startParticleAnimation();
    }
}

/**
 * 重新收集路径（当地图数据点发生变化后调用）
 */
function rebuildRoutes() {
    if (particleSystem) {
        collectRoutes();
        if (particleMode) resetAndEmitBudget();
    }
}

/**
 * 空函数占位，保留接口兼容性
 */
function updateParticlesPosition() {}
function updateParticleColors() {}

// ==================== 模块对外接口 ====================

/**
 * 根据 detector_id 查找对应的 marker
 */
function findMarkerByDetectorId(detId) {
    const target = String(detId).trim();
    for (const marker of (window.markers || [])) {
        if (marker.rowData && String(marker.rowData.detector_id).trim() === target) {
            return marker;
        }
    }
    return null;
}

/**
 * 设置路线规划模式
 * @param {boolean} active - 是否进入规划模式
 * @param {Object|null} planData - 规划数据 { matchedIds: Set, planEdges: Array }
 */
function setPlanMode(active, planData) {
    planModeState.active = active;
    planModeState.matchedIds = planData?.matchedIds || null;
    planModeState.planEdges = planData?.planEdges || null;
    
    if (active) {
        console.log('[粒子] 进入规划模式，匹配边数:', planData?.planEdges?.length || 0);
        // 只重建路线，不发射粒子（由 start() 或 setCurrentTimeStep() 统一发射）
        clearAllParticles();
        clearPendingTimers();
        remainingEmitBudget.clear();
        collectRoutes();
    } else {
        console.log('[粒子] 退出规划模式，恢复全量路线');
        clearAllParticles();
        clearPendingTimers();
        remainingEmitBudget.clear();
        collectRoutes();
    }
}

window.ParticleModule = {
    init: initParticleModule,
    loadTrafficData,
    setCurrentTimeStep,
    getCurrentTimeStepValue,
    start: startParticleAnimation,
    stop: stopParticleAnimation,
    toggle: toggleParticleAnimation,
    clear: clearAllParticles,
    updatePositions: updateParticlesPosition,
    rebuildRoutes,
    updateColors: updateParticleColors,
    setPlanMode,
    startAutoStep,
    stopAutoStep,
    resetTrafficData,
    // 暴露内部状态访问接口
    getActiveParticles: () => activeParticles,
    getParticleMode: () => particleMode,
    getPlanMode: () => planModeState.active,
    getTimeSteps: () => timeSteps,
    getTimeWindowMap: () => timeWindowMap,
    getCurrentTimeStep: () => currentTimeStep
};

// 将切换函数也暴露到全局，供 HTML 内联 onclick 使用
window.toggleParticleAnimation = toggleParticleAnimation;
