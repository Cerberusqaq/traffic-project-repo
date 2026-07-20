/**
 * visualization.js
 * 可视化控制模块
 * 
 * 职责：
 * 1. 播放/暂停控制（时间步推进）
 * 2. 时间轴控制
 * 3. 搜索功能
 * 4. 颜色编辑菜单
 * 5. 按钮悬浮提示
 * 6. 数据点显示切换
 * 7. 底部信息条更新
 */

// ==================== 可视化播放 / 暂停控制 ====================
/**
 * 切换可视化全局播放/暂停状态
 * 仅控制时间步推进（影响粒子、热力图、底部栏等所有可视化元素）
 * 粒子/热力图的显隐由各自的按钮独立控制
 */
function toggleVisualPlayPause(forceState) {
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
        if (lastPauseTimestamp > 0) {
            particlePauseTime += Date.now() - lastPauseTimestamp;
            lastPauseTimestamp = 0;
        }
        if (pm && pm.getParticleMode && pm.getParticleMode()) {
            if (pm.scheduleRandomEmissions) pm.scheduleRandomEmissions();
        }
        console.log('[播放] 已恢复');
    } else {
        lastPauseTimestamp = Date.now();
        if (pm && pm.clearPendingTimers) pm.clearPendingTimers();
        console.log('[播放] 已暂停');
    }
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

// ==================== 底部信息条更新 ====================
/**
 * 更新底部信息条：日期 + 实际时刻
 */
function updateBottomBar(step) {
    const dateEl = document.getElementById('bottomBarDate');
    const timeEl = document.getElementById('bottomBarTime');
    const sepEl = document.getElementById('bottomBarSep');
    const barEl = document.getElementById('bottomBar');

    const dateStr = window._currentHistoryDate || '';

    let timeStr = '';
    const pm = window.ParticleModule;
    if (pm && pm.getTimeWindowMap) {
        const twMap = pm.getTimeWindowMap();
        timeStr = (twMap instanceof Map ? twMap.get(String(step)) : twMap[step]) || '';
        if (timeStr) {
            const parts = timeStr.split(' ');
            timeStr = parts.length > 1 ? parts[1] : timeStr;
        }
    }

    const hasContent = dateStr || timeStr;

    if (dateEl) dateEl.textContent = dateStr || '';
    if (timeEl) timeEl.textContent = timeStr ? timeStr : (step !== undefined ? `Step ${step}` : '');
    if (sepEl) sepEl.style.display = (dateStr && timeStr) ? 'inline' : 'none';
    if (timeEl) timeEl.style.display = timeStr ? 'inline' : 'none';

    if (barEl) {
        if (hasContent) {
            barEl.classList.add('visible');
        } else {
            barEl.classList.remove('visible');
        }
    }
}

// ==================== 全局挂载 ====================
window.toggleVisualPlayPause = toggleVisualPlayPause;