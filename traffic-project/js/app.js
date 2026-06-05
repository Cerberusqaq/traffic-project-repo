/**
 * app.js
 * 灵动交通可视化平台 - 主应用逻辑
 * 
 * 职责：
 * 1. Leaflet 地图初始化与图层配置
 * 2. 全局状态管理（深色模式、可视化播放、功能模式状态机）
 * 3. 基础数据加载：GeoJSON 路网 + hk_data_new.csv 检测器信息
 * 4. 历史数据加载：按日期从后端 /data/monthly/ 读取 CSV 并更新地图
 * 5. 功能模式生命周期：enterHistoryMode / exitHistoryMode / exitCurrentMode
 * 6. 可视化控制：播放/暂停、数据点显隐、热力图、粒子动画联动
 * 7. 搜索、时间轴、右侧面板、颜色编辑、按钮悬浮提示等交互
 * 
 * 全局变量说明：
 * 本文件使用 var 声明核心全局状态，使其自动挂载到 window 对象，
 * 供 ui.js、particle.js、heatmap.js 等模块访问。
 */

// ==================== 全局配置常量 ====================
/** Marker 基础半径（像素） */
var MARKER_BASE_RADIUS = 3.5;
/** Marker 最小半径（缩放级别较低时使用） */
var MARKER_MIN_RADIUS = 3.5;
/** Marker 最大半径（缩放级别较高时使用） */
var MARKER_MAX_RADIUS = 4;
/** Marker hover 时的半径 */
var MARKER_HOVER_RADIUS = 5;

// ==================== 全局状态变量 ====================
/** 深色模式是否激活 */
var darkModeActive = true;
/** GeoJSON 道路图层实例 */
var geoJsonLayer = null;
/** Marker 点集合图层 */
var pointLayer = null;
/** 所有 CircleMarker 实例数组 */
var markers = [];
/** 行号 -> Marker 映射 */
var rowToMarkerMap = {};
/** 当前加载的 CSV 数据二维数组 */
var csvData = [];
/** 箭头连接线图层 */
var arrowLayer = null;
/** 是否显示所有箭头 */
var showAllArrows = true;
/** 当前高亮的 Marker */
var currentHighlightedMarker = null;
/** 当前脉冲动画的 Marker 集合 */
var currentPulsingMarkers = new Set();
/** Connection1~5 的列索引数组 */
var globalConnCols = [];
/** 数据点是否可见 */
var markersVisible = true;

/** 可视化播放是否激活 */
var visualPlaybackActive = true;
/** 粒子动画是否暂停 */
var globalParticlePaused = false;
/** 累计暂停时长（毫秒），用于粒子运动时间补偿 */
var particlePauseTime = 0;
/** 本次暂停开始的时间戳 */
var lastPauseTimestamp = 0;
/** 路线规划模式时间步范围：{ startStep, endStep } 或 null */
var planTimeStepRange = null;

/** 当前激活的功能模式：null | 'history' */
var currentActiveMode = null;

// ==================== 地图初始化 ====================
/**
 * 创建 Leaflet 地图实例，配置初始视角为香港地区
 * 禁用默认缩放控件（使用自定义缩放指示器）
 */
var map = L.map('map', {
    zoomControl: false,
    center: [22.37, 114.05],
    zoom: 12,
    minZoom: 11,
    maxZoom: 18,
});

// 将地图实例挂载到全局，供其他模块使用
window.map = map;

// 简约轮廓底图（始终在底层，显示海岸线/区域边界）
var baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
    maxZoom: 19, opacity: 0.7
}).addTo(map);

// 浅色模式底图
var osmLight = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {maxZoom: 19});

// 深色模式底图
var osmDark = L.tileLayer('https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', {maxZoom: 19});

// ==================== 网页缩放禁用 ====================
// 阻止 Ctrl +/- 和 Ctrl 滚轮导致的网页缩放
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
    }
});
document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false });

// ==================== 状态提示函数 ====================
// 为方便调用，在 window 上创建快捷引用
window.showStatus = function(msg, err) {
    if (err) {
        window.showToast(msg);
    } else {
        console.log('[Status]', msg);
    }
};

// ==================== 统一通知弹窗（红色毛玻璃） ====================
window.showToast = function(msg, duration) {
    const toast = document.getElementById('cozeToast');
    const toastMsg = document.getElementById('cozeToastMsg');
    if (!toast || !toastMsg) return;
    toastMsg.textContent = msg;
    toast.style.display = 'block';
    void toast.offsetWidth; // force reflow for transition
    toast.classList.add('show');
    const dur = duration || 3000;
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, dur);
};

// ==================== 统一可视化清理函数 ====================
function stopAllVisualizations() {
    // 停止播放
    if (visualPlaybackActive) {
        toggleVisualPlayPause(false);
    }
    // 同步播放按钮为暂停状态
    const playBtn = document.getElementById('visualPlayPauseBtn');
    if (playBtn) {
        playBtn.classList.remove('active');
        const playIcon = playBtn.querySelector('.play-icon');
        const pauseIcon = playBtn.querySelector('.pause-icon');
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    }
    // 停止粒子动画
    if (window.ParticleModule) {
        window.ParticleModule.stop();
        window.ParticleModule.resetTrafficData();
    }
    // 关闭热力图
    if (window.heatmapActive) {
        window.toggleHeat();
    }
    // 隐藏数据点
    if (window._markersVisible) {
        markers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
        window._markersVisible = false;
    }
    // 同步粒子按钮状态
    const particleBtn = document.getElementById('particleBtn');
    if (particleBtn) particleBtn.classList.remove('active');
    window._particleActive = false;
}

// ==================== 核心函数：加载基础数据 ====================
/**
 * 加载基础地理数据：
 * 1. 道路路网 GeoJSON（data/geojson/HK_RoadCentreline_260310.geojson）
 * 2. 检测器基础信息 CSV（data/base/hk_data_new.csv）
 * 
 * 调用时机：页面首次加载、退出历史数据模式时恢复初始状态
 */
async function loadBaseData() {
    console.log('[App] 开始加载基础数据...');
    try {
        // 清理页面上残留的旧 Marker 标签，避免多次加载后 DOM 堆积
        document.querySelectorAll('.marker-label').forEach(el => el.remove());

        // ---------- 1. 加载道路路网 GeoJSON ----------
        console.log('[App] 正在加载 GeoJSON 路网...');
        const geoResp = await fetch('/data/geojson/HK_RoadCentreline_260310.geojson');
        if (!geoResp.ok) {
            console.error('[App] GeoJSON 加载失败，HTTP状态:', geoResp.status);
            window.showStatus('路网数据加载失败', true);
        } else {
            const geoData = await geoResp.json();
            console.log('[App] GeoJSON 加载成功，特征数量:', geoData.features?.length || 0);
            if (geoJsonLayer) map.removeLayer(geoJsonLayer);
            geoJsonLayer = L.geoJSON(geoData).addTo(map);
            geoJsonLayer.eachLayer((layer) => {
                layer.setStyle({
                    color: window.customBaseMapColor || '#7d8282',
                    weight: 1,
                    opacity: 0.8,
                    fillOpacity: 0,
                });
            });
        }

        // ---------- 2. 加载检测器基础信息 CSV ----------
        console.log('[App] 正在加载检测器基础信息 CSV...');
        const csvResp = await fetch('/data/base/hk_data_new.csv');
        if (!csvResp.ok) {
            console.error('[App] 基础 CSV 加载失败，HTTP状态:', csvResp.status);
            window.showStatus('基础数据加载失败', true);
            return;
        }
        const text = await csvResp.text();
        const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
        console.log('[App] CSV 行数:', lines.length);
        const headers = AppModules.parseLine(lines[0]);
        console.log('[App] CSV 表头:', headers);

        // 查找关键列索引
        const latCol = AppModules.findCol(headers, ['Latitude', 'latitude', 'Lat', 'lat', '纬度']);
        const lngCol = AppModules.findCol(headers, ['Longitude', 'longitude', 'Lng', 'lng', '经度']);
        const detectorIdCol = AppModules.findCol(headers, ['detector_id', 'Detector_ID', 'id', 'ID']);
        console.log('[App] 列索引 - lat:', latCol, 'lng:', lngCol, 'detectorId:', detectorIdCol);

        if (latCol === -1 || lngCol === -1) {
            console.error('[App] 未找到经纬度列！');
            window.showStatus('数据格式错误：未找到坐标列', true);
            return;
        }

        // 查找连接关系列 Connection1 ~ Connection5
        globalConnCols = [];
        for (let i = 1; i <= 5; i++) {
            globalConnCols.push(headers.findIndex((h) => h.toLowerCase() === `connection${i}`.toLowerCase()));
        }
        console.log('[App] 连接关系列:', globalConnCols);

        // 清理旧图层和数据
        if (pointLayer) map.removeLayer(pointLayer);
        if (arrowLayer) map.removeLayer(arrowLayer);
        pointLayer = L.layerGroup().addTo(map);
        markers = [];
        rowToMarkerMap = {};
        csvData = [];

        // ---------- 3. 逐行创建 Marker ----------
        let validMarkers = 0;
        for (let i = 0; i < lines.length - 1; i++) {
            const cells = AppModules.parseLine(lines[i + 1]);
            if (!cells || cells.length <= Math.max(latCol, lngCol)) continue;
            const lat = parseFloat((cells[latCol] || '').replace(/,/g, ''));
            const lng = parseFloat((cells[lngCol] || '').replace(/,/g, ''));
            if (isNaN(lat) || isNaN(lng)) continue;

            const markerColor = window.customMarkerColor || '#5ad2af';
            const marker = L.circleMarker([lat, lng], {
                radius: MARKER_BASE_RADIUS,
                color: '#ffffff',
                weight: 2,
                fillColor: markerColor,
                fillOpacity: 1,
            });

            // 构建弹窗内容
            let popup = '<table style="font-size:10px;">';
            ['AID_ID_Number', 'Road_EN', 'Road_TC', 'Direction', 'Speed_kmh'].forEach((h) => {
                const idx = headers.indexOf(h);
                if (idx > -1) popup += `<tr><td><b>${h}:</b></td><td>${cells[idx] || ''}</td></tr>`;
            });
            const congColIndex = headers.indexOf('Congestion_Level');
            const congLevel = congColIndex !== -1 ? cells[congColIndex] || 0 : 0;
            const congDesc = ['畅通无阻', '基本畅通', '缓行', '拥堵', '极端拥堵'];
            popup += `<tr><td><b>拥堵等级:</b></td><td>${congLevel} (${congDesc[congLevel]})</td></tr>`;
            popup += '</table>';
            marker.bindPopup(popup, { zIndexOffset: 9999 });

            marker.congestionLevel = parseInt(congLevel);

            // 交互：鼠标悬停放大
            marker._hovered = false;
            marker.on('mouseover', () => {
                marker._hovered = true;
                marker.setRadius(MARKER_HOVER_RADIUS);
            });
            marker.on('mouseout', () => {
                marker._hovered = false;
                AppModules.updateMarkerSizes();
            });

            // 数字标签（显示行号）
            const label = document.createElement('div');
            label.className = 'marker-label';
            label.textContent = `#${i + 2}`;
            label.style.cssText = 'position: absolute; z-index: 100; pointer-events: none; transform: translateX(-50%);';
            document.body.appendChild(label);
            marker.labelElement = label;

            // 弹窗打开时高亮当前 marker
            marker.on('popupopen', function () {
                if (currentHighlightedMarker && currentHighlightedMarker !== this) AppModules.clearAllHighlights();
                currentHighlightedMarker = this;
                this.setStyle({ fillColor: '#fac373', color: '#fac373', weight: 3 });
                AppModules.updateArrowsDisplay();
            });
            marker.on('popupclose', () => {
                AppModules.clearAllHighlights();
                AppModules.updateArrowsDisplay();
            });

            marker.rowNumber = i + 2;
            marker.rowData = cells;
            if (detectorIdCol !== -1) {
                marker.rowData.detector_id = cells[detectorIdCol];
            }
            marker.connCols = globalConnCols;

            markers.push(marker);
            rowToMarkerMap[i + 2] = marker;
            marker.addTo(pointLayer);
            csvData.push(cells);
            validMarkers++;
        }
        console.log('[App] 成功创建', validMarkers, '个有效 Marker');

        // 调整地图视野以包含所有数据点
        if (pointLayer.getBounds && pointLayer.getBounds().isValid()) {
            map.fitBounds(pointLayer.getBounds());
            console.log('[App] 地图视野已调整');
        } else {
            console.warn('[App] 无法获取有效边界，保持默认视野');
        }

        // 更新标签、箭头、marker 尺寸
        AppModules.updateAllLabels();
        AppModules.buildArrowLayer();
        AppModules.updateMarkerSizes();

        // 初始化粒子模块路径
        if (window.ParticleModule) {
            console.log('[App] 初始化粒子模块...');
            window.ParticleModule.init();
            window.ParticleModule.rebuildRoutes();
            // 注册到 AppModules，供规划模块调用
            window.AppModules.particle = window.ParticleModule;
        } else {
            console.warn('[App] 粒子模块未就绪');
        }

        window.showStatus('基础数据加载完成');
        console.log('[App] 基础数据加载成功！');
    } catch (e) {
        console.error('[App] 基础数据加载失败:', e);
        window.showStatus('基础数据加载失败', true);
    }
}

// ==================== 核心函数：加载历史数据 ====================
/**
 * 根据日期加载对应的历史交通流量 CSV 数据
 * 数据来源：/data/monthly/YYYY-MM/fd_YYYY-MM-DD.csv
 * 
 * 核心逻辑：通过 detector_id 匹配基础数据中的真实坐标，
 *          只更新被匹配到的 marker 的流量/速度属性，
 *          未匹配的历史数据点会显示但无真实位置。
 * 
 * @param {string} dateStr - 日期，格式 YYYY-MM-DD
 */
async function loadCsvByDate(dateStr) {
    console.log('[App] 开始加载历史数据:', dateStr);
    try {
        // 0. 清理页面上残留的旧 Marker 标签
        document.querySelectorAll('.marker-label').forEach(el => el.remove());

        // 1. 构造文件路径并请求数据
        const [year, month, day] = dateStr.split('-');
        const monthFolder = `${year}-${month}`;
        const csvFileName = `fd_${dateStr}.csv`;
        const csvUrl = `/data/monthly/${monthFolder}/${csvFileName}`;
        console.log('[App] 请求历史数据 URL:', csvUrl);

        const resp = await fetch(csvUrl);
        if (!resp.ok) {
            console.error('[App] 历史数据加载失败，HTTP状态:', resp.status);
            window.showToast(`未找到 ${dateStr} 的历史数据，请选择有数据的日期（如 2024-01-01）`);
            exitHistoryMode();
            return;
        }
        const text = await resp.text();
        const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');
        if (lines.length <= 1) {
            console.error('[App] 历史数据为空');
            window.showToast(`${dateStr} 数据为空`);
            exitHistoryMode();
            return;
        }
        console.log('[App] 历史数据行数:', lines.length - 1);

        // 2. 解析 CSV 表头
        const headers = AppModules.parseLine(lines[0]);
        const detectorIdCol = AppModules.findCol(headers, ['detector_id', 'Detector_ID']);
        const timeStepCol = AppModules.findCol(headers, ['time_step', 'Time_Step']);
        const totalVolumeCol = AppModules.findCol(headers, ['total_volume', 'Total_Volume']);
        const avgSpeedCol = AppModules.findCol(headers, ['avg_speed', 'Avg_Speed']);
        const avgOccupancyCol = AppModules.findCol(headers, ['avg_occupancy', 'Avg_Occupancy']);
        console.log('[App] 历史数据列索引:', { detectorIdCol, timeStepCol, totalVolumeCol, avgSpeedCol, avgOccupancyCol });

        if (detectorIdCol < 0) {
            console.error('[App] 未找到 detector_id 列');
            window.showToast('历史数据格式错误：缺少 detector_id 列');
            exitHistoryMode();
            return;
        }

        // 3. 解析所有历史数据行，按 detector_id 分组，同时收集 time_window 映射
        const historyByDetector = {};  // detector_id -> { timeStep: { volume, speed, occupancy } }
        const timeWindowMap = {};       // timeStep -> time_window 字符串
        const twCol = AppModules.findCol(headers, ['time_window', 'Time_Window']);
        for (let i = 1; i < lines.length; i++) {
            const cells = AppModules.parseLine(lines[i]);
            if (!cells || cells.length === 0) continue;
            const detId = cells[detectorIdCol] ? String(cells[detectorIdCol]).trim() : '';
            if (!detId) continue;
            const ts = timeStepCol >= 0 ? parseInt(cells[timeStepCol]) || 0 : 0;
            // 收集 time_window
            if (twCol >= 0 && cells[twCol]) {
                const twStr = String(cells[twCol]).trim();
                if (twStr && !(ts in timeWindowMap)) {
                    timeWindowMap[ts] = twStr;
                }
            }
            if (!historyByDetector[detId]) historyByDetector[detId] = {};
            historyByDetector[detId][ts] = {
                volume: totalVolumeCol >= 0 ? parseFloat(cells[totalVolumeCol]) || 0 : 0,
                speed: avgSpeedCol >= 0 ? parseFloat(cells[avgSpeedCol]) || 0 : 0,
                occupancy: avgOccupancyCol >= 0 ? parseFloat(cells[avgOccupancyCol]) || 0 : 0,
            };
        }
        // 保存 timeWindowMap 到全局
        window._timeWindowMap = timeWindowMap;
        const detectorCount = Object.keys(historyByDetector).length;
        console.log(`[App] 历史数据解析完成: ${detectorCount} 个检测器, ${lines.length - 1} 条记录`);

        // 4. 复用现有基础数据的 markers，只更新属性（不重建！）
        // 先清理箭头层
        if (arrowLayer) { map.removeLayer(arrowLayer); arrowLayer = null; }

        let matchedCount = 0;
        markers.forEach(marker => {
            const detId = marker.rowData?.detector_id ? String(marker.rowData.detector_id).trim() : '';
            const histData = historyByDetector[detId];
            if (histData) {
                marker.historyData = histData;
                marker.isMatched = true;
                matchedCount++;
                // 用 time_step 0 的数据初始化显示
                const d0 = histData[0] || Object.values(histData)[0] || {};
                marker.setStyle({ fillColor: '#5ad2af' });
                const popupContent = `
                    <table style="font-size:10px; width:180px">
                        <tr><td><b>检测器ID：</b></td><td>${detId}</td></tr>
                        <tr><td><b>总流量：</b></td><td>${d0.volume || '-'} 辆</td></tr>
                        <tr><td><b>平均速度：</b></td><td>${d0.speed || '-'} km/h</td></tr>
                        <tr><td><b>拥堵状态：</b></td><td>${getCongestionLevel(d0.speed)}</td></tr>
                    </table>
                `;
                marker.bindPopup(popupContent, { zIndexOffset: 9999 });
            } else {
                marker.historyData = null;
                marker.isMatched = false;
                marker.setStyle({ fillColor: '#888888', fillOpacity: 0.3 });
            }
        });
        console.log(`[App] 历史数据匹配: ${matchedCount}/${markers.length} 个检测器`);

        if (matchedCount === 0) {
            window.showToast(`未找到 ${dateStr} 与现有数据点匹配的历史数据`);
            exitHistoryMode();
            return;
        }

        console.log(`[App] 已加载 ${dateStr}: 匹配 ${matchedCount}/${markers.length} 个检测器`);

        // 5. 保存全局历史数据引用，供时间轴切换 time_step 时使用
        window._historyByDetector = historyByDetector;
        window._currentHistoryDate = dateStr;

        // 6. 加载粒子流量数据，自动启动粒子效果和播放
        if (window.ParticleModule) {
            console.log('[App] 初始化粒子模块并加载流量数据...');
            window.ParticleModule.init();
            window.ParticleModule.rebuildRoutes();
            window.ParticleModule.loadTrafficData(text);
            window.ParticleModule.setCurrentTimeStep(0);
            // 自动启动粒子动画（如果播放按钮未开启则同时开启）
            window.ParticleModule.start();
            if (!visualPlaybackActive) {
                toggleVisualPlayPause(true);
            }
        }

        // 7. 显示时间滑块，填充 time_window
        showTimeSlider(historyByDetector, timeWindowMap);

        console.log(`[App] 成功加载 ${dateStr} 历史数据`);
    } catch (error) {
        console.error('[App] 历史数据加载失败：', error);
        window.showToast('历史数据加载失败: ' + error.message);
        exitHistoryMode();
    }
}

/**
 * 显示时间滑块，基于历史数据的 time_window
 * @param {Object} historyByDetector - 按 detector_id 分组的历史数据
 * @param {Object} timeWindowMap - timeStep -> time_window 映射
 */
function showTimeSlider(historyByDetector, timeWindowMap) {
    // 显示时间轴容器
    const container = document.getElementById('timelineContainer');
    if (container) container.classList.add('active');

    // 收集所有 timeStep 并排序
    const steps = Object.keys(timeWindowMap).map(Number).sort((a, b) => a - b);
    if (steps.length === 0) {
        // 如果没有 time_window，尝试从历史数据推断
        const tsSet = new Set();
        for (const det of Object.values(historyByDetector)) {
            for (const ts of Object.keys(det)) tsSet.add(Number(ts));
        }
        const sortedSteps = [...tsSet].sort((a, b) => a - b);
        if (sortedSteps.length === 0) return;
        sortedSteps.forEach(ts => { timeWindowMap[ts] = `Step ${ts}`; });
        steps.push(...sortedSteps);
    }

    // 设置滑块范围
    const slider = document.getElementById('timelineSlider');
    if (slider) {
        slider.min = 0;
        slider.max = steps.length - 1;
        slider.value = 0;
        
        // 保存 steps 引用供滑块事件使用
        slider._steps = steps;
        slider._timeWindowMap = timeWindowMap;
        
        // 滑块变化事件
        slider.oninput = function() {
            const step = steps[this.value];
            if (window.ParticleModule) {
                window.ParticleModule.setCurrentTimeStep(step);
            }
            updateBottomBar(step);
        };
    }

    // 初始化时间步：设为最小步
    const startStep = steps[0];
    if (window.ParticleModule) {
        window.ParticleModule.setCurrentTimeStep(startStep);
    }
    // 初始化底部信息条
    updateBottomBar(startStep);

    console.log(`[App] 时间信息已就绪: ${steps.length} 个时间步`);
}



/**
 * 粒子模块时间步变化回调
 */
window.onTimeStepChange = function(timeStep) {
    updateBottomBar(timeStep);

    // 更新 marker popup
    if (window._historyByDetector) {
        const twMap = window.ParticleModule ? window.ParticleModule.getTimeWindowMap() : new Map();
        const tw = (twMap instanceof Map ? twMap.get(String(timeStep)) : twMap[timeStep]) || `Step ${timeStep}`;
        for (const [detId, marker] of Object.entries(window._baseMarkers || {})) {
            const detData = window._historyByDetector[detId];
            if (detData && detData[timeStep]) {
                const d = detData[timeStep];
                marker.setPopupContent(
                    `<b>${detId}</b><br>` +
                    `时间: ${tw}<br>` +
                    `流量: ${d.volume}<br>` +
                    `速度: ${d.speed} km/h<br>` +
                    `占用率: ${d.occupancy}%<br>` +
                    `状态: ${getCongestionLevel(d.speed)}`
                );
            }
        }
    }

    // 更新热力图数据（如果热力图已开启）
    if (window._heatmapVisible && window.updateHeatmapData) {
        window.updateHeatmapData(timeStep);
    }

    // 路线规划模式时间步循环
    if (planTimeStepRange && timeStep > planTimeStepRange.endStep) {
        // 超出路线时间范围，回到出发时刻循环
        window.ParticleModule.setCurrentTimeStep(planTimeStepRange.startStep);
    }
};

/**
 * 根据平均速度返回拥堵状态描述文本
 * @param {string|number} avgSpeed - 平均速度（km/h）
 * @returns {string}
 */
function getCongestionLevel(avgSpeed) {
    const speed = parseFloat(avgSpeed);
    if (isNaN(speed)) return '未知状态';
    if (speed >= 60) return '✅ 畅通';
    if (speed >= 40) return '⚠️ 缓行';
    if (speed >= 20) return '🔴 拥堵';
    return '🟤 严重拥堵';
}

// ==================== 功能模式状态机 ====================
/**
 * 进入历史数据展示模式
 * 说明文档 2a~2e 的核心实现
 * @param {string} dateStr - 选择的日期 YYYY-MM-DD
 */
function enterHistoryMode(dateStr) {
    // 设置当前模式
    currentActiveMode = 'history';
    console.log(`[App] 进入历史数据模式: ${dateStr || '等待选择日期'}`);

    // 先清理所有可视化效果（不显示粒子/数据点/热力图）
    stopAllVisualizations();

    // 如果有日期参数，立即加载数据；否则等用户选择日期
    if (dateStr) {
        window._currentHistoryDate = dateStr;
        loadCsvByDate(dateStr);
        setTimelineDate(dateStr);
    }
}

/**
 * 退出历史数据展示模式
 * 2e：停止演示，恢复初始状态
 */
function exitHistoryMode() {
    if (currentActiveMode !== 'history') return;
    currentActiveMode = null;
    console.log('[App] 退出历史数据模式');

    // 统一清理：停止所有可视化效果 + 暂停播放按钮
    stopAllVisualizations();

    // 清除模式按钮的 mode-active 状态
    const btnIds = ['showHistoryBtn', 'predictTrafficBtn'];
    btnIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('mode-active');
    });

    // 隐藏时间轴（带退出动画）
    const container = document.getElementById('timelineContainer');
    if (container) {
        if (container.classList.contains('active')) {
            container.classList.remove('active');
            container.classList.add('closing');
            setTimeout(() => {
                container.classList.remove('closing');
            }, 300);
        }
    }

    // 重置历史数据引用
    window._historyByDetector = null;
    window._currentHistoryDate = null;

    // 停止时间轴播放
    stopTimelinePlay();

    console.log('[App] 已退出历史数据模式');
}

/**
 * 退出当前任何激活的模式
 * 作为模式切换前的通用清理入口
 */
function exitCurrentMode() {
    if (currentActiveMode === 'history') {
        exitHistoryMode();
    }
    if (planModeActive) {
        exitPlanMode();
    }
    currentActiveMode = null;
}

// 将模式控制函数挂载到全局，供 ui.js 的日历选择调用
window.App = {
    enterHistoryMode,
    exitHistoryMode,
    exitCurrentMode,
    exitPlanMode,
    handlePlanRoute,
    displayPlannedRoute,
    stopAllVisualizations,
    get planModeActive() { return planModeActive; },
    get historyModeActive() { return currentActiveMode === 'history'; }
};

// ==================== 可视化播放 / 暂停控制 ====================
/**
 * 切换可视化全局播放/暂停状态
 * 仅控制时间步推进（影响粒子、热力图、底部栏等所有可视化元素）
 * 粒子/热力图的显隐由各自的按钮独立控制
 */
function toggleVisualPlayPause(forceState) {
    // forceState: true=强制播放, false=强制暂停, undefined=切换
    if (forceState !== undefined) {
        visualPlaybackActive = forceState;
    } else {
        visualPlaybackActive = !visualPlaybackActive;
    }
    globalParticlePaused = !visualPlaybackActive;

    const btn = document.getElementById('visualPlayPauseBtn');
    if (visualPlaybackActive) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }

    const playIcon = btn.querySelector('.play-icon');
    const pauseIcon = btn.querySelector('.pause-icon');
    if (playIcon) playIcon.style.display = visualPlaybackActive ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = visualPlaybackActive ? 'block' : 'none';

    const pm = window.ParticleModule;
    if (visualPlaybackActive) {
        // 恢复播放：补偿暂停时长
        if (lastPauseTimestamp > 0) {
            particlePauseTime += Date.now() - lastPauseTimestamp;
            lastPauseTimestamp = 0;
        }
        // 启动时间步推进（无论粒子是否开启）
        if (pm && pm.startAutoStep) pm.startAutoStep();
        // 如果粒子已开启，恢复粒子发射
        if (pm && pm.getParticleMode && pm.getParticleMode()) {
            if (pm.scheduleRandomEmissions) pm.scheduleRandomEmissions();
        }
        console.log('[播放] 时间步推进已恢复');
    } else {
        // 暂停：冻结计时
        lastPauseTimestamp = Date.now();
        if (pm && pm.stopAutoStep) pm.stopAutoStep();
        if (pm && pm.clearPendingTimers) pm.clearPendingTimers();
        console.log('[播放] 时间步推进已暂停');
    }
}

/**
 * 强制同步所有粒子在屏幕上的位置
 * 当地图缩放或拖拽时调用，确保粒子覆盖在正确的地图位置上
 */
function syncParticlesScreenPos() {
    const activeParticles = window.ParticleModule?.getActiveParticles ? window.ParticleModule.getActiveParticles() : [];
    if (!activeParticles || activeParticles.length === 0) return;
    for (const p of activeParticles) {
        const startPoint = map.latLngToContainerPoint(p.startLatLng);
        const endPoint = map.latLngToContainerPoint(p.endLatLng);
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        p.el.style.left = `${startPoint.x - 2}px`;
        p.el.style.top = `${startPoint.y - 2}px`;
        p.el.style.transform = `translate(${dx * p.progress}px, ${dy * p.progress}px)`;
    }
}

// ==================== 地图事件绑定 ====================
// 缩放结束时更新缩放指示器、同步粒子位置、更新标签
map.on('zoomend', () => {
    document.getElementById('currentZoomLevel').innerHTML =
        `<span class="zoom-num">${map.getZoom()}</span><br><span class="zoom-text">缩放</span>`;
    syncParticlesScreenPos();
    if (!globalParticlePaused) {
        AppModules.updateAllLabels();
        AppModules.updateMarkerSizes();
    }
});

// 拖拽开始时清空粒子（性能优化）
map.on('movestart', () => {
    if (globalParticlePaused) return;
    if (window.ParticleModule) window.ParticleModule.clear();
});

// 拖拽过程中同步粒子位置、更新标签
map.on('move', () => {
    syncParticlesScreenPos();
    if (!globalParticlePaused) {
        AppModules.updateAllLabels();
    }
});

// 右键菜单显示坐标
map.on('contextmenu', (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    const content = `<table style="font-size:10px;"><tr><td><b>纬度:</b></td><td>${lat}</td></tr><tr><td><b>经度:</b></td><td>${lng}</td></tr></table>`;
    L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
});

// ==================== 深色模式切换 ====================
function toggleDarkMode() {
    darkModeActive = !darkModeActive;
    document.body.classList.toggle('dark-mode', darkModeActive);
    if (darkModeActive) {
        map.removeLayer(baseOutline);
        baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', {maxZoom: 19, opacity: 0.7}).addTo(map);
        baseOutline.bringToBack();
    } else {
        map.removeLayer(baseOutline);
        baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {maxZoom: 19, opacity: 0.7}).addTo(map);
        baseOutline.bringToBack();
    }
    if (geoJsonLayer) {
        geoJsonLayer.eachLayer((layer) => {
            if (layer.setStyle) {
                layer.setStyle({
                    color: window.customBaseMapColor || '#7d8282',
                    weight: 1,
                    opacity: 0.8,
                });
            }
        });
    }
    AppModules.updateArrowsDisplay();
    localStorage.setItem('darkMode', darkModeActive ? 'enabled' : 'disabled');
    if (window.ParticleModule) window.ParticleModule.updateColors();
}

// ==================== 数据点显示切换 ====================
function toggleMarkers() {
    markersVisible = !markersVisible;
    const btn = document.getElementById('showMarkersBtn');
    btn.classList.toggle('active');
    markers.forEach((m) => {
        if (markersVisible) {
            m.getElement().style.display = 'block';
            if (m.labelElement) m.labelElement.style.display = 'block';
        } else {
            m.getElement().style.display = 'none';
            if (m.labelElement) m.labelElement.style.display = 'none';
        }
    });
}

// ==================== 搜索功能 ====================
function searchByText() {
    const txt = document.getElementById('searchText').value.toLowerCase().trim();
    if (!txt) return;
    for (const m of markers) {
        for (const cell of m.rowData) {
            if (cell && cell.toString().toLowerCase().includes(txt)) {
                map.setView(m.getLatLng(), 15);
                m.openPopup();
                return;
            }
        }
    }
    window.showStatus(`未查询到 "${txt}"`, true);
}

// ==================== 时间轴控制 ====================
var timelinePlaying = false;
var timelineTimer = null;
var currentTimelineDate = '2024-01-01';

/**
 * 生成指定日期范围列表
 * @param {number} year - 年份
 * @param {number} month - 月份（1-12）
 * @param {number} startDay - 起始日
 * @param {number} endDay - 结束日
 * @returns {string[]} - 日期字符串数组
 */
function generateDateList(year, month, startDay, endDay) {
    const dateList = [];
    const formatMonth = month.toString().padStart(2, '0');
    for (let day = startDay; day <= endDay; day++) {
        const formatDay = day.toString().padStart(2, '0');
        dateList.push(`${year}-${formatMonth}-${formatDay}`);
    }
    return dateList;
}

/** 当前支持的日期列表（2024年1月） */
var DATE_LIST = generateDateList(2024, 1, 1, 31);

/**
 * 初始化时间轴（已简化为底部信息条）
 * 占位函数，当前底部信息条逻辑由 ParticleModule 的 onTimeStepChange 驱动
 */
function initTimeline() {
    // 无需主动调用，底部信息条通过 window.onTimeStepChange 自动更新
}

/**
 * 切换时间轴播放/暂停
 * 播放时按 3 秒/天的速度自动切换日期并加载数据
 */
function toggleTimelinePlay() {
    toggleVisualPlayPause();
}

/**
 * 停止时间轴播放（供 exitHistoryMode 调用）
 */
function stopTimelinePlay() {
    if (timelinePlaying) {
        timelinePlaying = false;
        clearInterval(timelineTimer);
    }
}

/**
 * 外部设置当前时间轴日期
 * @param {string} dateStr
 */
function setTimelineDate(dateStr) {
    currentTimelineDate = dateStr;
    // 底部信息条由 window.onTimeStepChange 统一更新
}

// ==================== 右侧面板控制 ====================
function initSidePanel() {
    const container3 = document.getElementById('container3');
    const toggleBtn = document.getElementById('toggleContainer3');
    toggleBtn.addEventListener('click', () => {
        container3.classList.toggle('collapsed');
    });
}

// ==================== 颜色编辑菜单 ====================
function initColorEditMenu() {
    const editBtn = document.getElementById('editModeBtn');
    const colorMenu = document.getElementById('colorEditMenu');

    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (colorMenu.classList.contains('active')) {
            colorMenu.classList.add('closing');
            colorMenu.addEventListener('animationend', () => {
                colorMenu.classList.remove('active', 'closing');
            }, { once: true });
        } else {
            colorMenu.classList.remove('closing');
            colorMenu.classList.add('active');
        }
        editBtn.classList.toggle('active');
    });

    // 四套预设主题配置
    const colorConfig = {
        '#b4f0e6': { baseMap: '#7d8282', particle: '#b4f0e6' },
        '#64d7dc': { baseMap: '#507d82', particle: '#fad28c' },
        '#fad28c': { baseMap: '#647378', particle: '#64d7dc' },
        '#ff8773': { baseMap: '#b4a0af', particle: '#ff8773' },
    };

    document.querySelectorAll('.color-item').forEach((item) => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const btnColor = item.dataset.color;
            const config = colorConfig[btnColor];
            if (!config) return;
            window.customBaseMapColor = config.baseMap;
            window.customParticleColor = config.particle;
            if (geoJsonLayer) {
                geoJsonLayer.eachLayer((layer) => {
                    if (layer.setStyle) {
                        layer.setStyle({
                            color: window.customBaseMapColor,
                            weight: 1,
                            opacity: 0.8,
                        });
                    }
                });
            }
            document.querySelectorAll('.particle').forEach((p) => {
                p.style.background = window.customParticleColor;
                p.style.boxShadow = `0 0 6px ${window.customParticleColor}, 0 0 12px ${window.customParticleColor}`;
            });
            window.showStatus('主题切换成功');
            colorMenu.classList.remove('active');
            editBtn.classList.remove('active');
        });
    });
}

// ==================== 按钮悬浮提示 ====================
function initTooltips() {
    const tooltipConfig = [
        { selector: '#particleBtn', text: '粒子动画' },
        { selector: '#showMarkersBtn', text: '数据点' },
        { selector: '#showHeatBtn', text: '热力图' },
        { selector: '#showRealtimeDataBtn', text: '实时数据' },
        { selector: '#showHistoryBtn', text: '历史数据' },
        { selector: '#predictTrafficBtn', text: '模型预测' },
        { selector: '#customizeEventsBtn', text: '模拟事件' },
        { selector: '#realtimePlanBtn', text: '路线规划' },
        { selector: '#darkModeToggle', text: '深浅模式' },
        { selector: '#editModeBtn', text: '主题设置' },
        { selector: '#visualPlayPauseBtn', text: '可视化控制' },
    ];

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    document.body.appendChild(tooltip);

    tooltipConfig.forEach(item => {
        const els = document.querySelectorAll(item.selector);
        els.forEach(el => {
            el.addEventListener('mouseenter', () => {
                tooltip.textContent = item.text;
                tooltip.classList.add('show');
                positionTooltip(el, tooltip);
            });
            el.addEventListener('mouseleave', () => {
                tooltip.classList.remove('show');
            });
        });
    });

    function positionTooltip(button, tooltipEl) {
        const rect = button.getBoundingClientRect();
        tooltipEl.style.left = rect.left + (rect.width / 2) - (tooltipEl.offsetWidth / 2) + 'px';
        tooltipEl.style.top = rect.top - tooltipEl.offsetHeight - 1 + 'px';
    }
}

// ==================== 路线规划功能 ====================

// 路线规划状态
let planRouteLayer = null;
let planMatchedMarkers = [];
let planModeActive = false;       // 是否处于规划模式
let planMatchedData = null;       // 当前规划匹配的数据

/**
 * 退出路线规划模式：清除路线、恢复数据点样式、关闭粒子
 */
function exitPlanMode() {
    console.log('[Plan] 退出规划模式');
    planTimeStepRange = null; // 清除规划时间步范围
    
    // 清除路线图层
    if (planRouteLayer) {
        map.removeLayer(planRouteLayer);
        planRouteLayer = null;
    }
    
    // 恢复数据点样式
    planMatchedMarkers.forEach(m => {
        if (m._marker && map.hasLayer(m._marker)) {
            m._marker.setStyle({
                fillColor: m.originalColor,
                color: m.originalBorderColor || '#ffffff',
                weight: m.originalBorderWeight !== undefined ? m.originalBorderWeight : 2,
                radius: m.originalRadius
            });
            // 恢复原始 mouseout
            m._marker.off('mouseout');
            m._marker.on('mouseout', () => {
                m._marker.setStyle({ radius: m.originalRadius });
            });
        }
    });
    planMatchedMarkers = [];
    
    // 关闭路线专属粒子
    if (window.ParticleModule) {
        window.ParticleModule.setPlanMode(false, null);
        // 不再在此处调用 init()/rebuildRoutes()，由 stopAllVisualizations 统一清理
    }
    
    // 清理 UI
    const planResult = document.getElementById('planResult');
    const planStatus = document.getElementById('planStatus');
    if (planResult) { planResult.innerHTML = ''; planResult.classList.remove('show'); }
    if (planStatus) { planStatus.textContent = ''; planStatus.className = 'plan-status'; }
    
    planModeActive = false;
    planMatchedData = null;

    // 清除模式按钮的 mode-active 状态
    const planBtn = document.getElementById('realtimePlanBtn');
    if (planBtn) planBtn.classList.remove('mode-active');
}

/**
 * 处理路线规划请求（确认按钮总是重新规划，退出由左下角按钮控制）
 */
async function handlePlanRoute() {
    
    const planInput = document.getElementById('planInput');
    const planStatus = document.getElementById('planStatus');
    const planResult = document.getElementById('planResult');
    const confirmBtn = document.getElementById('planConfirmBtn');
    
    const userText = planInput.value.trim();
    
    if (!userText) {
        planStatus.textContent = '请输入行程描述';
        planStatus.className = 'plan-status error';
        return;
    }
    
    // 显示加载状态
    planStatus.textContent = '正在解析您的行程...';
    planStatus.className = 'plan-status loading';
    confirmBtn.disabled = true;
    console.log('[Plan] 发送路线规划请求:', userText);
    
    try {
        const response = await fetch('/api/plan/nlp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_text: userText })
        });
        
        const data = await response.json();
        console.log('[Plan] 收到响应:', data);
        
        if (!response.ok || !data.success) {
            planStatus.textContent = data.error || '规划失败';
            planStatus.className = 'plan-status error';
            window.showToast(data.error || '路线规划失败');
            return;
        }
        
        planModeActive = true;
        planMatchedData = data;
        
        // 成功：显示结果
        planStatus.textContent = '规划成功！点击确认按钮可重新规划';
        planStatus.className = 'plan-status success';
        
        // 显示路线信息
        let resultHtml = `
            <div class="plan-result-item">
                <div>从 <b>${data.origin_text}</b></div>
                <div>到 <b>${data.dest_text}</b></div>
            </div>
        `;
        
        if (data.route) {
            const distanceKm = (data.route.distance / 1000).toFixed(1);
            const durationMin = data.route.duration;
            resultHtml += `
                <div class="plan-result-item">
                    <div class="plan-result-route">
                        距离: ${distanceKm}km | 预计: ${durationMin}分钟
                    </div>
                </div>
            `;
        }
        
        resultHtml += `
            <div class="plan-result-item">
                <div class="plan-result-detectors">
                    匹配到 ${data.matched_detectors.length} 个沿线数据点
                </div>
            </div>
        `;
        
        if (data.data_message) {
            const msgColor = data.prediction_available ? '#4caf50' : '#ff9800';
            resultHtml += `
                <div class="plan-result-item" style="color: ${msgColor};">
                    ${data.data_message}
                </div>
            `;
        } else if (!data.prediction_available) {
            resultHtml += `
                <div class="plan-result-item" style="color: #ff9800;">
                    预测数据功能开发中，当前仅显示路线
                </div>
            `;
        }
        
        planResult.innerHTML = resultHtml;
        planResult.classList.add('show');
        
        // 在地图上绘制路线和匹配的点
        displayPlannedRoute(data);
        
        window.showToast(`路线规划成功：${data.origin_text} → ${data.dest_text}`);
        
    } catch (error) {
        console.error('[Plan] 请求失败:', error);
        planStatus.textContent = '网络错误，请检查连接';
        planStatus.className = 'plan-status error';
        window.showToast('路线规划请求失败');
    } finally {
        confirmBtn.disabled = false;
    }
}

/**
 * 在地图上显示规划的路线和匹配的数据点
 */
function displayPlannedRoute(data) {
    console.log('[Plan] 开始绘制路线...');
    
    // 1. 清除之前的规划结果
    if (planRouteLayer) {
        map.removeLayer(planRouteLayer);
    }
    planMatchedMarkers.forEach(m => {
        if (m._marker && map.hasLayer(m._marker)) {
            m._marker.setStyle({
                fillColor: m.originalColor,
                color: m.originalBorderColor || '#ffffff',
                weight: m.originalBorderWeight !== undefined ? m.originalBorderWeight : 2,
                radius: m.originalRadius
            });
        }
    });
    planMatchedMarkers = [];
    
    // 2. 绘制路线（蓝色虚线）
    if (data.route && data.route.full_polyline && data.route.full_polyline.length > 0) {
        const polylineCoords = data.route.full_polyline.map(p => [p.lat, p.lng]);
        
        planRouteLayer = L.polyline(polylineCoords, {
            color: '#007bff',
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 10'
        }).addTo(map);
        
        console.log('[Plan] 路线绘制完成，点数:', polylineCoords.length);
        
        // 3. 调整视野到路线（放大到几乎完整显示，右侧留白避免被左侧毛玻璃遮挡）
        // padding: [上, 右, 下, 左] - 左侧留出 280px 避免被毛玻璃面板遮挡
        map.fitBounds(planRouteLayer.getBounds(), {
            padding: [30, 30, 30, 280],
            maxZoom: 16
        });
        console.log('[Plan] 视野已调整到路线区域');
    }
    
    // 4. 高亮匹配的数据点并启动路线粒子（检查时刻数据）
    if (data.matched_detectors && data.matched_detectors.length > 0) {
        highlightMatchedDetectors(data.matched_detectors);
        startPlanParticles(data.matched_detectors, data.date, data.time);
    }
}

/**
 * 高亮显示匹配的数据点
 */
/**
 * 将时间字符串解析为分钟数（用于时间窗口比较）
 * 支持 HH:MM、HHMM、HH.MM 等格式
 */
function parseTimeToMinute(timeStr) {
    if (!timeStr) return 0;
    const s = String(timeStr).replace(/[:.]/g, '');
    if (s.length >= 3) {
        const h = parseInt(s.substring(0, s.length - 2)) || 0;
        const m = parseInt(s.substring(s.length - 2)) || 0;
        return h * 60 + m;
    }
    return parseInt(s) * 60 || 0;
}

/**
 * 将 time_window 值解析为分钟数
 * time_window 可能是 HHMM、HH:MM、HH:MM:SS 等格式
 */
function parseTimeWindowToMinute(tw) {
    if (!tw) return 0;
    tw = String(tw).trim();
    // 尝试提取空格后的时间部分（如 "2024/1/1 1:00" → "1:00"）
    const spaceIdx = tw.lastIndexOf(' ');
    let timePart;
    if (spaceIdx >= 0) {
        timePart = tw.substring(spaceIdx + 1);
    } else if (tw.includes('-')) {
        timePart = tw.split('-')[0].trim();
    } else {
        timePart = tw;
    }
    const s = timePart.replace(/[:.]/g, '');
    if (s.length >= 3) {
        const h = parseInt(s.substring(0, s.length - 2)) || 0;
        const m = parseInt(s.substring(s.length - 2)) || 0;
        return h * 60 + m;
    }
    return parseInt(s) * 60 || 0;
}

function highlightMatchedDetectors(matchedDetectors) {
    console.log('[Plan] 开始高亮匹配的数据点，数量:', matchedDetectors.length);
    
    // 找到对应的 marker 并高亮
    const detectorIdSet = new Set(matchedDetectors.map(d => String(d.detector_id).trim()));
    
    markers.forEach((marker, idx) => {
        const markerDetId = marker.rowData?.detector_id;
        if (markerDetId && detectorIdSet.has(String(markerDetId).trim())) {
            // 高亮这个 marker
            const markerColor = '#ff5722'; // 橙色高亮
            marker.setStyle({
                fillColor: markerColor,
                color: '#ffffff',
                weight: 3,
                radius: MARKER_HOVER_RADIUS
            });
            
            // 存储高亮状态以便后续清除
            planMatchedMarkers.push({
                _marker: marker,
                originalColor: window.customMarkerColor || '#5ad2af',
                originalBorderColor: '#ffffff',
                originalBorderWeight: 2,
                originalRadius: MARKER_BASE_RADIUS
            });
            
            // 鼠标移出时恢复高亮颜色（但保持橙色高亮）
            marker.off('mouseout');
            marker.on('mouseout', () => {
                marker.setStyle({
                    fillColor: markerColor,
                    color: '#ffffff',
                    weight: 3,
                    radius: MARKER_BASE_RADIUS
                });
            });
        }
    });
    
    console.log('[Plan] 匹配到并高亮了', planMatchedMarkers.length, '个数据点');
}

/**
 * 启动路线规划的粒子效果
 * 只在两个匹配点之间有关系表关联时才发射粒子
 */
async function startPlanParticles(matchedDetectors, planDate, planTime) {
    console.log('[Plan] 启动路线粒子效果，匹配点数:', matchedDetectors.length, '日期:', planDate, '时间:', planTime);
    
    if (!window.ParticleModule) {
        console.warn('[Plan] 粒子模块未加载');
        return;
    }
    
    // ===== 检查解析的时刻是否有对应数据 =====
    let hasTimeData = false;
    let targetTimeStep = 0;
    let loadedTimeWindowMap = {};
    
    if (planDate) {
        // 尝试加载该日期的历史数据
        const [year, month, day] = planDate.split('-');
        const monthFolder = `${year}-${month}`;
        const csvUrl = `/data/monthly/${monthFolder}/fd_${planDate}.csv`;
        console.log('[Plan] 尝试加载日期数据:', csvUrl);
        
        try {
            const resp = await fetch(csvUrl);
            if (resp.ok) {
                const text = await resp.text();
                const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
                if (lines.length > 1) {
                    const headers = AppModules.parseLine(lines[0]);
                    const twCol = AppModules.findCol(headers, ['time_window', 'Time_Window']);
                    const timeStepCol = AppModules.findCol(headers, ['time_step', 'Time_Step']);
                    
                    // 收集 time_window 映射
                    for (let i = 1; i < lines.length; i++) {
                        const cells = AppModules.parseLine(lines[i]);
                        if (!cells || cells.length === 0) continue;
                        const ts = timeStepCol >= 0 ? parseInt(cells[timeStepCol]) || 0 : 0;
                        if (twCol >= 0 && cells[twCol]) {
                            const twStr = String(cells[twCol]).trim();
                            if (twStr && !(ts in loadedTimeWindowMap)) {
                                loadedTimeWindowMap[ts] = twStr;
                            }
                        }
                    }
                    
                    // 查找与 planTime 匹配的 time_step
                    if (planTime && twCol >= 0) {
                        // 灵活匹配时间窗口：考虑路线时长，在出发时间到到达时间范围内搜索
                        // route.duration 单位可能是秒或分钟（腾讯地图 API 返回秒，但后端注释写分钟）
                        // 如果值 > 100，视为秒；否则视为分钟
                        const rawDuration = planMatchedData?.route?.duration || 0;
                        const routeDurationMin = rawDuration > 100 ? rawDuration / 60 : rawDuration;

                        // 将 planTime（如 "1300"、"13:00"、"1:00"）解析为当天的分钟数
                        const planTimeToMinute = (s) => {
                            if (!s) return null;
                            s = String(s).replace(/[:.]/g, '').trim();
                            if (s.length < 1) return null;
                            if (s.length <= 2) { // 只有小时，如 "1" 或 "13"
                                const hh = parseInt(s);
                                return isNaN(hh) || hh > 23 ? null : hh * 60;
                            }
                            if (s.length === 3) s = '0' + s;
                            const hh = parseInt(s.substring(0, 2));
                            const mm = parseInt(s.substring(2, 4));
                            if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) return null;
                            return hh * 60 + mm;
                        };

                        // 从 time_window 字符串提取时间部分的分钟数
                        // 支持格式: "2024/1/1 1:00", "2024/1/1 13:30", "08:00-08:10" 等
                        const timeWindowToMinute = (tw) => {
                            tw = String(tw).trim();
                            // 尝试提取空格后的时间部分（如 "2024/1/1 1:00" → "1:00"）
                            const spaceIdx = tw.lastIndexOf(' ');
                            let timePart;
                            if (spaceIdx >= 0) {
                                timePart = tw.substring(spaceIdx + 1);
                            } else if (tw.includes('-')) {
                                // 格式: "08:00-08:10" → 取前半部分
                                timePart = tw.split('-')[0].trim();
                            } else {
                                timePart = tw;
                            }
                            return planTimeToMinute(timePart);
                        };

                        const startMinute = planTimeToMinute(planTime);
                        const endMinute = startMinute !== null ? startMinute + routeDurationMin : null;

                        console.log('[Plan] 时间解析: planTime=', planTime, '→ startMinute=', startMinute, 'routeDuration=', routeDurationMin, 'min');

                        if (startMinute !== null) {
                            // 在 [出发时间-5min, 到达时间+5min] 范围内搜索
                            const searchStart = startMinute - 5;
                            const searchEnd = (endMinute !== null ? endMinute : startMinute + 60) + 5;

                            let bestStep = -1;
                            let bestDist = Infinity;

                            for (const [ts, tw] of Object.entries(loadedTimeWindowMap)) {
                                const twStart = timeWindowToMinute(tw);
                                if (twStart === null) continue;

                                if (twStart >= searchStart && twStart <= searchEnd) {
                                    const dist = Math.abs(twStart - startMinute);
                                    if (dist < bestDist) {
                                        bestDist = dist;
                                        bestStep = parseInt(ts);
                                    }
                                }
                            }

                            if (bestStep >= 0) {
                                targetTimeStep = bestStep;
                                hasTimeData = true;
                                console.log('[Plan] 时间窗口灵活匹配: 出发', planTime, '(' + startMinute + 'min)',
                                    '路线时长', routeDurationMin + 'min', '搜索范围', searchStart + '-' + searchEnd,
                                    '匹配到 timeStep', targetTimeStep, 'time_window:', loadedTimeWindowMap[targetTimeStep]);
                            } else {
                                console.log('[Plan] 灵活匹配未找到, 搜索范围:', searchStart + '-' + searchEnd,
                                    'loadedTimeWindowMap 条目数:', Object.keys(loadedTimeWindowMap).length);
                            }
                        }

                        // 回退：如果灵活匹配没找到，尝试字符串包含匹配
                        if (!hasTimeData) {
                            const planTimeNorm = String(planTime).replace(/[:.]/g, '');
                            for (const [ts, tw] of Object.entries(loadedTimeWindowMap)) {
                                const twNorm = String(tw).replace(/[:.\/\s]/g, '');
                                if (twNorm.includes(planTimeNorm)) {
                                    targetTimeStep = parseInt(ts);
                                    hasTimeData = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // 如果有数据但没匹配到精确时刻，至少标记日期有数据
                    if (Object.keys(loadedTimeWindowMap).length > 0 && !planTime) {
                        hasTimeData = true;
                        targetTimeStep = 0;
                    }
                    
                    console.log('[Plan] 日期数据加载成功, time_window映射数:', Object.keys(loadedTimeWindowMap).length, 'hasTimeData:', hasTimeData, 'targetTimeStep:', targetTimeStep);
                }
            }
        } catch (e) {
            console.warn('[Plan] 加载日期数据失败:', e);
        }
    }
    
    // 初始匹配集
    const matchedIds = new Set(matchedDetectors.map(d => String(d.detector_id).trim()));
    
    // 扩展匹配集：将直接关联但未在路线匹配中的检测器也纳入
    // 这样 A->B 的关系如果 A 在路线匹配中，B 也会被纳入
    const extendedDetectors = [...matchedDetectors];
    const extendedIds = new Set(matchedIds);
    const detectorMap = {};
    matchedDetectors.forEach(d => {
        detectorMap[String(d.detector_id).trim()] = d;
    });
    
    // 从基础数据中查找关联的未匹配检测器
    for (const d of matchedDetectors) {
        const connections = d.connections || [];
        for (const connId of connections) {
            const connIdStr = String(connId).trim();
            if (!extendedIds.has(connIdStr)) {
                // 在 window.csvData 中查找该检测器的坐标
                const connData = (window.csvData || []).find(
                    row => String(row.detector_id || '').trim() === connIdStr
                );
                if (connData) {
                    extendedIds.add(connIdStr);
                    extendedDetectors.push({
                        detector_id: connIdStr,
                        lat: parseFloat(connData.Latitude || connData.lat || 0),
                        lon: parseFloat(connData.Longitude || connData.lon || connData.lng || 0),
                        connections: [],
                        road_en: connData.Road_EN || connData.road_en || '',
                        road_sc: connData.Road_SC || connData.road_sc || ''
                    });
                    detectorMap[connIdStr] = extendedDetectors[extendedDetectors.length - 1];
                }
            }
        }
    }
    
    console.log('[Plan] 扩展后匹配集:', matchedIds.size, '->', extendedIds.size);
    
    // 构建路线匹配点之间的关联边
    // 只有两端点都在扩展匹配集合中的连接才激活
    const planEdges = [];
    for (const d of extendedDetectors) {
        const detId = String(d.detector_id).trim();
        const connections = d.connections || [];
        for (const connId of connections) {
            const connIdStr = String(connId).trim();
            if (extendedIds.has(connIdStr) && detId < connIdStr) {
                planEdges.push({
                    from: detId,
                    to: connIdStr,
                    fromLat: d.lat,
                    fromLng: d.lon || d.lng,
                    toLat: detectorMap[connIdStr]?.lat,
                    toLng: detectorMap[connIdStr]?.lon || detectorMap[connIdStr]?.lng
                });
            }
        }
    }
    
    console.log('[Plan] 路线关联边数:', planEdges.length);
    
    // 将匹配信息传递给粒子模块
    window.ParticleModule.setPlanMode(true, {
        matchedIds: extendedIds,
        planEdges: planEdges,
        matchedDetectors: extendedDetectors
    });
    
    // 检查时刻数据
    if (planEdges.length === 0) {
        window.ParticleModule.setPlanMode(false, null);
        window.showToast('路线沿线的数据点之间暂无拓扑关联关系，无法显示粒子效果');
        return;
    }
    
    if (!hasTimeData && planDate) {
        // 有日期但该时刻没有数据：不启动粒子，仅显示路线
        window.ParticleModule.setPlanMode(false, null);
        const timeInfo = planTime ? `${planDate} ${planTime}` : planDate;
        window.showToast(`${timeInfo} 暂无交通数据，仅显示路线`);
        console.log('[Plan] 无时刻数据，不启动粒子');
        return;
    }
    
    // 自动开启播放和粒子动效，同步按钮状态
    // 开启播放
    if (!visualPlaybackActive) {
        toggleVisualPlayPause(true);
    }
    // 确保粒子动画已开启
    if (!window.ParticleModule.getParticleMode()) {
        window.ParticleModule.start();
    }
    // 同步粒子按钮和播放按钮的视觉状态
    const particleBtn = document.getElementById('particleBtn');
    if (particleBtn) particleBtn.classList.add('active');
    window._particleActive = true;
    const playBtn = document.getElementById('visualPlayPauseBtn');
    if (playBtn) {
        playBtn.classList.add('active');
        const playIcon = playBtn.querySelector('.play-icon');
        const pauseIcon = playBtn.querySelector('.pause-icon');
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'inline';
    }
    
    // 如果匹配到了精确时刻，设置时间步
    if (hasTimeData && targetTimeStep >= 0 && window.ParticleModule.setCurrentTimeStep) {
        window.ParticleModule.setCurrentTimeStep(targetTimeStep);
        updateBottomBar(targetTimeStep);
    }
    
    // 设置路线规划时间步范围（出发时刻±5分钟 到 到达时刻±5分钟，然后循环）
    if (hasTimeData && planTime && loadedTimeWindowMap) {
        const timeSteps = window.ParticleModule.getTimeSteps();
        if (timeSteps && timeSteps.length > 0) {
            const twMap = window.ParticleModule.getTimeWindowMap();
            let rangeStart = targetTimeStep;
            let rangeEnd = targetTimeStep;
            const rawDuration = planMatchedData?.route?.duration || 0;
            const routeDurationMin = rawDuration > 100 ? rawDuration / 60 : rawDuration;
            const startMinute = parseTimeToMinute(planTime);
            const endMinute = startMinute + routeDurationMin;
            
            // 找出发时刻附近-5分钟的timeStep
            for (let i = 0; i < timeSteps.length; i++) {
                const tw = (twMap instanceof Map ? twMap.get(String(i)) : twMap[i]) || loadedTimeWindowMap[i];
                if (tw) {
                    const m = parseTimeWindowToMinute(String(tw));
                    if (m >= startMinute - 5 && i < rangeStart) {
                        rangeStart = i;
                    }
                    if (m <= endMinute + 5 && i > rangeEnd) {
                        rangeEnd = i;
                    }
                }
            }
            // 确保不超出范围
            rangeStart = Math.max(0, rangeStart);
            rangeEnd = Math.min(timeSteps.length - 1, rangeEnd);
            if (rangeEnd <= rangeStart) rangeEnd = Math.min(rangeStart + 10, timeSteps.length - 1);
            
            planTimeStepRange = { startStep: rangeStart, endStep: rangeEnd };
            console.log('[Plan] 时间步范围:', planTimeStepRange, '出发分钟:', startMinute, '到达分钟:', endMinute);
        }
    } else if (!hasTimeData) {
        planTimeStepRange = null;
    }
}

// 导出给全局使用
window.App = window.App || {};
window.App.handlePlanRoute = handlePlanRoute;
window.App.displayPlannedRoute = displayPlannedRoute;
window.App.exitPlanMode = exitPlanMode;

// ==================== 时间轴更新 ====================
/**
 * 更新时间轴标签：日期 + 时刻
 */
function updateBottomBar(step) {
    // 时间轴标签
    const timelineDateEl = document.getElementById('timelineDateLabel');
    const timelineTimeEl = document.getElementById('timelineTimeLabel');
    const slider = document.getElementById('timelineSlider');

    // 日期
    const dateStr = window._currentHistoryDate || '';

    // 时刻：从 ParticleModule 获取 timeWindowMap
    let timeStr = '';
    let stepIndex = 0;
    const pm = window.ParticleModule;
    if (pm && pm.getTimeWindowMap) {
        const twMap = pm.getTimeWindowMap();
        // 转换为数组查找索引
        const steps = slider && slider._steps ? slider._steps : [];
        stepIndex = steps.findIndex(s => s === step);
        if (stepIndex === -1) stepIndex = 0;
        
        timeStr = (twMap instanceof Map ? twMap.get(String(step)) : twMap[step]) || '';
        if (timeStr) {
            // 格式化：取时间部分 "2024/1/1 0:10" → "0:10"
            const parts = timeStr.split(' ');
            timeStr = parts.length > 1 ? parts[1] : timeStr;
        }
    }

    // 更新时间轴标签
    if (timelineDateEl) timelineDateEl.textContent = dateStr || '';
    if (timelineTimeEl) timelineTimeEl.textContent = timeStr || '';
    if (slider && slider._steps) {
        slider.value = stepIndex;
    }
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 初始化深色模式（优先读取本地存储）
    darkModeActive = true;
    document.body.classList.add('dark-mode');
    // 切换底图为暗色
    map.removeLayer(baseOutline);
    baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', {maxZoom: 19, opacity: 0.7}).addTo(map);
    baseOutline.bringToBack();
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode === 'disabled') {
        darkModeActive = false;
        document.body.classList.remove('dark-mode');
        map.removeLayer(baseOutline);
        baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {maxZoom: 19, opacity: 0.7}).addTo(map);
        baseOutline.bringToBack();
    }

    // 2. 加载基础地理数据（路网 + 检测器）
    try { await loadBaseData(); console.log('[Init] loadBaseData 完成'); } catch(e) { console.error('[Init] loadBaseData 失败:', e); }

    // 3. 初始化 UI 模块（菜单、日历）
    try { AppModules.initGlobalFixedMenu(); console.log('[Init] initGlobalFixedMenu 完成'); } catch(e) { console.error('[Init] initGlobalFixedMenu 失败:', e); }

    // 4. 初始化实时数据弹窗
    try { initRealtimeModal(); console.log('[Init] initRealtimeModal 完成'); } catch(e) { console.error('[Init] initRealtimeModal 失败:', e); }

    // 5. 默认激活数据点按钮
    try { document.getElementById('showMarkersBtn').classList.add('active'); } catch(e) { console.error('[Init] 激活数据点按钮失败:', e); }

    // 5. 初始化时间轴、右侧面板、颜色编辑、悬浮提示
    try { initTimeline(); } catch(e) { console.error('[Init] initTimeline 失败:', e); }
    try { initSidePanel(); } catch(e) { console.error('[Init] initSidePanel 失败:', e); }
    try { initColorEditMenu(); } catch(e) { console.error('[Init] initColorEditMenu 失败:', e); }
    try { initTooltips(); } catch(e) { console.error('[Init] initTooltips 失败:', e); }
    
    // 6. 路线规划输入框回车支持（Ctrl+Enter 提交）
    const planInput = document.getElementById('planInput');
    if (planInput) {
        planInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handlePlanRoute();
            }
        });
    }
});

// ==================== 实时数据弹窗功能 ====================

let realtimeModal = null;
let realtimeOverlay = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// 初始化实时数据弹窗
function initRealtimeModal() {
    console.log('[实时数据] initRealtimeModal 被调用');
    realtimeModal = document.getElementById('realtimeModal');
    console.log('[实时数据] realtimeModal 元素:', realtimeModal);
    const closeBtn = document.getElementById('realtimeModalClose');
    const header = document.getElementById('realtimeModalHeader');
    console.log('[实时数据] closeBtn:', closeBtn);
    console.log('[实时数据] header:', header);
    
    // 点击关闭按钮
    if (closeBtn) {
        closeBtn.addEventListener('click', closeRealtimeModal);
    }
    
    // 拖拽功能
    if (header) {
        header.addEventListener('mousedown', startDrag);
    }
    
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    
    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeRealtimeModal();
    });
}

function startDrag(e) {
    isDragging = true;
    const rect = realtimeModal.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    realtimeModal.style.transform = 'none';
}

function drag(e) {
    if (!isDragging) return;
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    realtimeModal.style.left = x + 'px';
    realtimeModal.style.top = y + 'px';
}

function stopDrag() {
    isDragging = false;
}

// 打开实时数据弹窗
async function openRealtimeModal() {
    console.log('[实时数据] openRealtimeModal 开始');
    
    // 获取元素
    realtimeModal = document.getElementById('realtimeModal');
    console.log('[实时数据] realtimeModal:', realtimeModal);
    
    if (!realtimeModal) {
        console.error('[实时数据] 找不到 realtimeModal 元素！');
        return;
    }
    
    // 创建/显示遮罩层
    if (!realtimeOverlay) {
        realtimeOverlay = document.createElement('div');
        realtimeOverlay.className = 'modal-overlay';
        realtimeOverlay.addEventListener('click', closeRealtimeModal);
        document.body.appendChild(realtimeOverlay);
    }
    realtimeOverlay.style.display = 'block';
    
    // 移除关闭动画
    realtimeModal.classList.remove('closing');
    
    // 直接设置样式确保显示
    realtimeModal.style.display = 'flex';
    realtimeModal.style.opacity = '1';
    realtimeModal.style.transform = 'translate(-50%, -50%) scale(1)';
    
    // 显示弹窗（使用 active class 触发动画）
    realtimeModal.classList.add('active');
    
    console.log('[实时数据] 弹窗已显示, classList:', realtimeModal.className);
    console.log('[实时数据] style.display:', realtimeModal.style.display);
    
    // 加载数据
    await loadRealtimeData();
}

// 关闭实时数据弹窗
function closeRealtimeModal() {
    if (realtimeModal) {
        // 添加关闭动画
        realtimeModal.classList.remove('active');
        realtimeModal.classList.add('closing');
        
        // 动画结束后隐藏
        setTimeout(() => {
            realtimeModal.classList.remove('closing');
            realtimeModal.style.display = 'none';
        }, 300);
    }
    // 隐藏遮罩层
    if (realtimeOverlay) {
        realtimeOverlay.style.display = 'none';
    }
}

// 加载实时数据
async function loadRealtimeData() {
    const content = document.getElementById('realtimeModalContent');
    if (!content) return;
    
    content.innerHTML = '<div class="realtime-loading">加载中...</div>';
    
    try {
        // 优先从 API 获取，如果失败则从 CSV 直接读取
        let data = null;
        try {
            const response = await fetch('/api/realtime/current');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    data = result.data;
                }
            }
        } catch (e) {
            console.log('API 请求失败，尝试直接读取 CSV');
        }
        
        // 如果 API 失败，尝试直接读取 CSV（仅适用于同源情况）
        if (!data) {
            data = await loadRealtimeDataFromCSV();
        }
        
        if (data && data.length > 0) {
            renderRealtimeTable(data);
        } else {
            content.innerHTML = '<div class="realtime-loading">暂无数据</div>';
        }
    } catch (error) {
        console.error('加载实时数据失败:', error);
        content.innerHTML = '<div class="realtime-loading">加载失败，请稍后重试</div>';
    }
}

// 直接从 CSV 文件读取数据
async function loadRealtimeDataFromCSV() {
    try {
        const response = await fetch('./data/realtime/traffic_final.csv');
        if (!response.ok) return null;
        
        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return null;
        
        const headers = lines[0].split(',');
        const data = [];
        const maxRows = Math.min(lines.length - 1, 100);
        
        for (let i = 1; i <= maxRows; i++) {
            const values = lines[i].split(',');
            const row = {};
            headers.forEach((header, index) => {
                row[header.trim()] = values[index] ? values[index].trim() : '';
            });
            data.push(row);
        }
        
        return data;
    } catch (e) {
        console.error('读取 CSV 失败:', e);
        return null;
    }
}

// 渲染实时数据表格
function renderRealtimeTable(data) {
    const content = document.getElementById('realtimeModalContent');
    if (!content) return;
    
    const table = document.createElement('table');
    table.className = 'realtime-table';
    
    // 表头
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>检测器ID</th>
            <th>时间窗口</th>
            <th>时间步</th>
            <th>总流量</th>
            <th>平均速度</th>
        </tr>
    `;
    table.appendChild(thead);
    
    // 表体
    const tbody = document.createElement('tbody');
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.detector_id || '-'}</td>
            <td>${row.time_window || '-'}</td>
            <td>${row.time_step || '-'}</td>
            <td class="volume">${row.total_volume || '0'}</td>
            <td class="speed">${row.avg_speed || '0'} km/h</td>
        `;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    
    content.innerHTML = '';
    content.appendChild(table);
}

// 实时数据按钮点击处理
function onRealtimeDataBtnClick() {
    console.log('[实时数据] 按钮点击开始');
    console.log('[实时数据] realtimeModal:', realtimeModal);
    console.log('[实时数据] document.getElementById:', document.getElementById('realtimeModal'));
    openRealtimeModal();
}

// 测试函数：直接显示弹窗（不使用动画）
function testShowRealtimeModal() {
    console.log('[测试] testShowRealtimeModal 被调用');
    if (!realtimeModal) {
        realtimeModal = document.getElementById('realtimeModal');
    }
    if (!realtimeModal) {
        console.error('[测试] realtimeModal 元素不存在！');
        return;
    }
    console.log('[测试] realtimeModal 元素存在');
    console.log('[测试] 当前 display:', realtimeModal.style.display);
    console.log('[测试] 当前 classList:', realtimeModal.className);
    console.log('[测试] 当前 computed display:', window.getComputedStyle(realtimeModal).display);
    console.log('[测试] 当前 opacity:', window.getComputedStyle(realtimeModal).opacity);
    
    // 直接显示
    realtimeModal.style.display = 'flex';
    realtimeModal.style.opacity = '1';
    realtimeModal.style.transform = 'translate(-50%, -50%)';
    realtimeModal.classList.add('active');
    
    console.log('[测试] 设置后 display:', realtimeModal.style.display);
    console.log('[测试] 设置后 classList:', realtimeModal.className);
}
