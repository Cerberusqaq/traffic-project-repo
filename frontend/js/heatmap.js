/**
 * heatmap.js
 * 灵动交通可视化平台 - 热力图模块
 * 
 * 职责：
 * 1. 根据地图上所有 marker 的拥堵等级（congestionLevel）生成热力图层
 * 2. 提供显示/隐藏热力图的切换功能
 * 3. 拥堵等级与热力值的映射：
 *    - 0（畅通无阻）-> 10
 *    - 1（基本畅通）-> 40
 *    - 2（缓行）    -> 70
 *    - 3（拥堵）    -> 90
 *    - 4（极端拥堵）-> 100
 * 
 * 依赖：
 * - Leaflet.heat 插件（在 index.html 中通过 CDN 引入）
 * - 全局变量 map, markers 由 app.js 初始化
 */

/** 热力图是否处于显示状态 */
/** 热力图是否处于显示状态（挂载到 window 供 app.js 访问） */
window.heatmapActive = false;

/** Leaflet 热力图层实例 */
let heatmap = null;

/**
 * 切换热力图的显示/隐藏状态
 * 供左上角热力图按钮调用（onclick="toggleHeat()"）
 */
function toggleHeat() {
    window.heatmapActive = !window.heatmapActive;
    window._heatmapVisible = window.heatmapActive;
    const btn = document.getElementById('showHeatBtn');
    btn.classList.toggle('active');

    if (window.heatmapActive) {
        showHeatmap();
    } else {
        hideHeatmap();
    }
}

/**
 * 显示热力图
 * 首次显示时根据当前 markers 的 congestionLevel 创建热力数据并生成图层
 * 后续显示时直接复用已创建的图层实例
 */
function showHeatmap() {
    if (heatmap) {
        window.map.addLayer(heatmap);
        return;
    }

    // 确保 markers 已初始化且有数据
    if (!window.markers || window.markers.length === 0) {
        console.warn('[热力图] 当前没有可用的数据点，无法生成热力图');
        return;
    }

    // 将每个 marker 的拥堵等级转换为热力值
    // 拥堵等级越高，热力值越大，颜色越偏向红色
    const heatData = {
        max: 100,
        data: window.markers.map(m => {
            const level = m.congestionLevel || 0;
            // 拥堵等级 0~4 映射到热力值 10/40/70/90/100
            const val = [10, 40, 70, 90, 100][level] || 0;
            return {
                lat: m.getLatLng().lat,
                lng: m.getLatLng().lng,
                value: val
            };
        })
    };

    // 使用 Leaflet.heat 插件创建热力图层
    heatmap = L.heatLayer(heatData.data, {
        radius: 35,          // 每个热点的影响半径（像素）
        blur: 75,            // 模糊程度，越大越平滑
        maxZoom: 18,         // 最大缩放级别
        max: 100,            // 热力值最大值
        minOpacity: 0.6,     // 最小不透明度
        gradient: {
            0.2: 'green',    // 低值：绿色（畅通）
            0.5: 'yellow',   // 中值：黄色
            0.6: 'orange',   // 较高值：橙色
            0.9: 'red'       // 高值：红色（拥堵）
        }
    }).addTo(window.map);
}

/**
 * 隐藏热力图
 * 从地图上移除图层，但不销毁实例，以便下次快速复用
 */
function hideHeatmap() {
    if (heatmap) {
        window.map.removeLayer(heatmap);
    }
}

// 将切换函数暴露到全局，供 HTML 内联事件调用
window.toggleHeat = toggleHeat;
window._heatmapVisible = false;

/**
 * 更新热力图数据（时间步变化时调用）
 * 根据 timeStep 更新每个 marker 的拥堵等级并重绘热力图
 */
window.updateHeatmapData = function(timeStep) {
    if (!window._heatmapVisible || !heatmap) return;
    
    // 从历史数据更新 marker 的拥堵等级
    if (window._historyByDetector) {
        for (const [detId, marker] of Object.entries(window._baseMarkers || {})) {
            const detData = window._historyByDetector[detId];
            if (detData && detData[timeStep]) {
                const d = detData[timeStep];
                marker.congestionLevel = getCongestionLevelNum(d.speed);
            }
        }
    }
    
    // 重绘热力图
    if (window.markers && window.markers.length > 0) {
        const heatData = window.markers.map(m => {
            const level = m.congestionLevel || 0;
            const val = [10, 40, 70, 90, 100][level] || 0;
            return [m.getLatLng().lat, m.getLatLng().lng, val];
        });
        heatmap.setLatLngs(heatData);
    }
};

/**
 * 根据平均速度返回拥堵等级数字 (0-4)
 */
function getCongestionLevelNum(avgSpeed) {
    const speed = parseFloat(avgSpeed);
    if (isNaN(speed)) return 0;
    if (speed >= 60) return 0;
    if (speed >= 40) return 1;
    if (speed >= 25) return 2;
    if (speed >= 15) return 3;
    return 4;
}
