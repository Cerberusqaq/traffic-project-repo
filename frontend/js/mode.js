/**
 * mode.js
 * 功能模式状态机模块
 * 
 * 职责：
 * 1. 历史数据模式（进入/退出）
 * 2. 流量预测模式（进入）
 * 3. 实时数据模式（进入/退出）
 * 4. 模式切换通用清理
 * 5. 顶部时间显示和模式标签更新
 * 6. 检测器数据表格更新
 */

// ==================== 功能模式状态机 ====================
/**
 * 进入历史数据展示模式
 * @param {string} dateStr - 选择的日期 YYYY-MM-DD
 */
function enterHistoryMode(dateStr) {
    if (!dateStr) return;

    if (realtimeModeActive) {
        exitRealtimeMode();
    }

    stopAllVisualizations();

    currentActiveMode = 'history';
    console.log(`[Mode] 进入历史数据模式: ${dateStr}`);

    window._currentHistoryDate = dateStr;

    currentDateTime = new Date(`${dateStr}T08:00:00`);
    console.log('[Mode] 当前时间设置为历史日期:', currentDateTime);

    const header = document.getElementById('realtimeHeader');
    if (header) header.style.display = 'flex';

    updateRealtimeClock();

    loadCsvByDate(dateStr);
    setTimelineDate(dateStr);
}

/**
 * 查找指定日期之后最近的有数据的日期
 * @param {string} targetDate - 目标日期 YYYY-MM-DD
 * @param {Array} availableDates - 可用日期数组
 * @returns {string|null} - 最近的有数据日期
 */
function findNearestAvailableDate(targetDate, availableDates) {
    if (!availableDates || availableDates.length === 0) {
        return null;
    }

    const target = new Date(targetDate);
    let nearestDate = null;
    let minDiff = Infinity;

    for (const dateStr of availableDates) {
        const date = new Date(dateStr);
        const diff = date.getTime() - target.getTime();
        if (diff >= 0 && diff < minDiff) {
            minDiff = diff;
            nearestDate = dateStr;
            break;
        }
    }

    if (!nearestDate && availableDates.length > 0) {
        nearestDate = availableDates[availableDates.length - 1];
    }

    return nearestDate;
}

/**
 * 进入流量预测模式（锁定2025年 + 精准匹配）
 * @param {string} dateStr - 用户选择的原始日期 YYYY-MM-DD
 */
function enterPredictMode(dateStr) {
    console.log('[Mode] ========== 进入流量预测模式 ==========');
    console.log('[Mode] 输入参数 dateStr:', dateStr);

    if (!dateStr) {
        console.error('[Mode] 错误：日期参数为空');
        return;
    }

    if (realtimeModeActive) {
        console.log('[Mode] 退出实时模式');
        exitRealtimeMode();
    }

    stopAllVisualizations();

    currentActiveMode = 'predict';
    console.log('[Mode] 设置当前模式为 predict');
    console.log(`[Mode] 进入流量预测模式: ${dateStr}`);

    const dateParts = dateStr.split('-');
    const year = '2025';
    const month = dateParts[1];
    const day = dateParts[2];
    const targetDate = `${year}-${month}-${day}`;
    console.log(`[Mode] 转换为2025年目标日期: ${dateStr} -> ${targetDate}`);

    window._currentHistoryDate = dateStr;
    window._currentPredictDataDate = targetDate;

    currentDateTime = new Date(`${dateStr}T08:00:00`);

    const header = document.getElementById('realtimeHeader');
    if (header) {
        header.style.display = 'flex';
        console.log('[Mode] 已显示顶部时间区域');
    }

    updateRealtimeClock();

    console.log('[Mode] 精准加载2025年对应日期数据:', targetDate);
    loadCsvByDate(targetDate);

    window._currentHistoryDate = dateStr;
    currentDateTime = new Date(`${dateStr}T08:00:00`);
    updateRealtimeClock();

    setTimelineDate(dateStr);

    console.log('[Mode] ========== 流量预测模式初始化完成 ==========');
}

/**
 * 退出历史数据展示模式
 */
function exitHistoryMode() {
    if (currentActiveMode !== 'history' && currentActiveMode !== 'predict') return;
    const modeName = currentActiveMode === 'history' ? '历史数据' : '流量预测';
    currentActiveMode = null;
    currentPredictionEvent = null;
    console.log(`[Mode] 退出${modeName}模式`);

    const header = document.getElementById('realtimeHeader');
    if (header) header.style.display = 'none';

    stopAllVisualizations();

    const btnIds = ['showHistoryBtn', 'predictTrafficBtn'];
    btnIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('mode-active');
    });

    const sliderContainer = document.getElementById('timeSliderContainer');
    if (sliderContainer) sliderContainer.style.display = 'none';

    const exitBtn = document.getElementById('exitHistoryBtn');
    if (exitBtn) exitBtn.classList.remove('visible');

    const slider = document.getElementById('timeStepSlider');
    const timeEl = document.getElementById('bottomBarTime');
    const sepEl = document.getElementById('bottomBarSep');
    if (slider) slider.style.display = 'none';
    if (timeEl) { timeEl.style.display = 'none'; timeEl.textContent = ''; }
    if (sepEl) sepEl.style.display = 'none';

    const barEl = document.getElementById('bottomBar');
    if (barEl) barEl.classList.remove('visible');

    const dateEl = document.getElementById('bottomBarDate');
    if (dateEl) dateEl.textContent = '';

    window._historyByDetector = null;
    window._currentHistoryDate = null;
    window._historyTimeSteps = null;
    window._historyTimeWindowMap = null;
    window._currentPredictDataDate = null;

    stopTimelinePlay();

    console.log('[Mode] 已退出历史数据模式');
}

/**
 * 退出实时数据模式
 */
function exitRealtimeMode() {
    if (!realtimeModeActive) return;

    realtimeModeActive = false;
    realtimeTrafficData = null;

    if (window._realtimeClockInterval) {
        clearInterval(window._realtimeClockInterval);
        window._realtimeClockInterval = null;
        console.log('[Mode] 实时时钟定时器已停止');
    }

    if (window.ParticleModule) {
        window.ParticleModule.stop();
    }

    console.log('[Mode] 已退出实时模式');
}

/**
 * 进入实时数据模式
 * @param {Object} trafficData - 爬取的实时交通数据
 */
function enterRealtimeMode(trafficData) {
    console.log('[Mode] enterRealtimeMode 被调用，数据:', trafficData);
    realtimeModeActive = true;
    realtimeTrafficData = trafficData;

    currentDateTime = new Date();
    console.log('[Mode] 当前时间设置为爬取时间:', currentDateTime);

    currentPredictionEvent = null;

    const header = document.getElementById('realtimeHeader');
    console.log('[Mode] 实时头部元素:', header);
    if (header) header.style.display = 'flex';
    else console.warn('[Mode] 找不到 realtimeHeader 元素');

    updateRealtimeClock();
    window._realtimeClockInterval = setInterval(updateRealtimeClock, 1000);
    console.log('[Mode] 时钟定时器已启动');

    globalParticlePaused = false;
    visualPlaybackActive = true;
    console.log('[Mode] 设置 globalParticlePaused=false, visualPlaybackActive=true');

    console.log('[Mode] 准备调用 processRealtimeData');
    processRealtimeData(trafficData);

    console.log('[Mode] 进入实时模式完成');
}

/**
 * 退出当前任何激活的模式
 * 作为模式切换前的通用清理入口
 */
function exitCurrentMode() {
    if (currentActiveMode === 'history' || currentActiveMode === 'predict') {
        exitHistoryMode();
    }
    if (planModeActive) {
        exitPlanMode();
    }
    currentActiveMode = null;
}

/**
 * 更新顶部时间显示
 */
function updateRealtimeClock() {
    const displayTime = currentDateTime || new Date();
    const timeStr = displayTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const timeEl = document.getElementById('currentTimeDisplay');
    if (timeEl) timeEl.textContent = timeStr;

    updateModeLabel();
}

/**
 * 更新模式标签显示
 */
function updateModeLabel() {
    const labelEl = document.getElementById('currentModeLabel');
    if (!labelEl) return;

    let labelText = '';
    let labelClass = '';

    if (currentPredictionEvent) {
        labelText = `预测: ${currentPredictionEvent}`;
        labelClass = 'mode-prediction';
    } else if (currentActiveMode === 'predict') {
        labelText = '流量预测';
        labelClass = 'mode-predict';
    } else if (predictionModeActive) {
        labelText = '模型预测';
        labelClass = 'mode-prediction';
    } else if (currentActiveMode === 'history') {
        labelText = '历史数据';
        labelClass = 'mode-history';
    } else if (realtimeModeActive) {
        labelText = '实时数据';
        labelClass = 'mode-realtime';
    }

    labelEl.textContent = labelText;
    labelEl.className = 'mode-label ' + labelClass;
}

/**
 * 更新右侧面板中的检测器数据表格
 */
function updateDetectorDataTable() {
    const tableBody = document.getElementById('detectorTableBody');
    if (!tableBody) return;

    const detectorData = [];

    if (window._historyByDetector && window._currentTimeStep !== undefined) {
        const timeStep = window._currentTimeStep;
        for (const [detId, detData] of Object.entries(window._historyByDetector)) {
            if (detData && detData[timeStep]) {
                detectorData.push({
                    id: detId,
                    speed: parseFloat(detData[timeStep].speed.toFixed(1))
                });
            }
        }
    } else if (realtimeTrafficData && realtimeTrafficData.records) {
        const detectorMap = {};
        for (const rec of realtimeTrafficData.records) {
            const id = String(rec.detector_id).trim();
            if (!detectorMap[id]) {
                detectorMap[id] = [];
            }
            detectorMap[id].push(rec.speed);
        }
        for (const [id, speeds] of Object.entries(detectorMap)) {
            const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            detectorData.push({
                id,
                speed: parseFloat(avgSpeed.toFixed(1))
            });
        }
    }

    detectorData.sort((a, b) => {
        const numA = parseInt(a.id);
        const numB = parseInt(b.id);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.id.localeCompare(b.id);
    });

    if (detectorData.length === 0) {
        tableBody.innerHTML = '<div class="table-empty">暂无数据</div>';
        return;
    }

    let html = '';
    for (const item of detectorData) {
        html += `
            <div class="table-row">
                <span class="col-id">${item.id}</span>
                <span class="col-speed">${item.speed}</span>
            </div>
        `;
    }
    tableBody.innerHTML = html;
}

/**
 * 处理实时数据并启动粒子动画
 * @param {Object} trafficData - 实时交通数据
 */
function processRealtimeData(trafficData) {
    console.log('[Mode] processRealtimeData 被调用');
    console.log('[Mode] 原始trafficData:', trafficData);
    if (!trafficData || !trafficData.records || trafficData.records.length === 0) {
        console.warn('[Mode] 实时数据为空');
        return;
    }

    console.log('[Mode] 原始records前10条:', trafficData.records.slice(0, 10));

    const detectorMap = {};
    for (const rec of trafficData.records) {
        const id = rec.detector_id;
        if (!detectorMap[id]) {
            detectorMap[id] = { speeds: [], volumes: [] };
        }
        detectorMap[id].speeds.push(rec.speed);
        detectorMap[id].volumes.push(rec.volume);
    }
    console.log('[Mode] 检测器映射（前10个）:', Object.entries(detectorMap).slice(0, 10));

    const processedData = {};
    for (const [id, data] of Object.entries(detectorMap)) {
        const avgSpeed = data.speeds.reduce((a, b) => a + b, 0) / data.speeds.length;
        const totalVolume = data.volumes.reduce((a, b) => a + b, 0);
        processedData[id] = { speed: avgSpeed, volume: totalVolume };
    }
    console.log('[Mode] 处理后的数据（前10个）:', Object.entries(processedData).slice(0, 10));
    console.log('[Mode] 处理后数据所有keys:', Object.keys(processedData));
    console.log('[Mode] 处理后数据key数量:', Object.keys(processedData).length);

    console.log('[Mode] window.markers:', window.markers);
    if (window.markers && window.markers.length > 0) {
        console.log('[Mode] marker[0].rowData:', window.markers[0].rowData);
        console.log('[Mode] marker[0].rowData.AID_ID_Number:', 
                    JSON.stringify(window.markers[0].rowData.AID_ID_Number));
        console.log('[Mode] marker[0].rowData.detector_id:', 
                    JSON.stringify(window.markers[0].rowData.detector_id));
    }

    console.log('[Mode] 对比 - externalData第一个key:', Object.keys(processedData)[0], 
                'marker[0].AID_ID_Number:', window.markers[0].rowData.AID_ID_Number);

    console.log('[Mode] ParticleModule 是否存在:', !!window.ParticleModule);
    if (window.ParticleModule) {
        console.log('[Mode] 调用 resetTrafficData');
        window.ParticleModule.resetTrafficData(processedData);
        console.log('[Mode] 调用 ParticleModule.start');
        window.ParticleModule.start();
    } else {
        console.error('[Mode] ParticleModule 未定义！');
    }

    console.log(`[Mode] 实时数据处理完成，共 ${Object.keys(processedData).length} 个检测器`);

    updateDetectorDataTable();
}

// ==================== 全局挂载 ====================
window.App = window.App || {};
window.App.enterHistoryMode = enterHistoryMode;
window.App.enterPredictMode = enterPredictMode;
window.App.exitHistoryMode = exitHistoryMode;
window.App.updateModeLabel = updateModeLabel;