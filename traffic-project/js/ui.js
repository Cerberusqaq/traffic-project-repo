/**
 * ui.js
 * 灵动交通可视化平台 - UI 交互与工具模块
 * 
 * 职责：
 * 1. 左下角功能按钮的菜单展开/收起逻辑
 * 2. 历史数据 / 模型预测的日历渲染与日期选择
 * 3. 地图上箭头层（连接关系）的构建与显示控制
 * 4. 数据标记（Marker）的标签、尺寸、高亮状态管理
 * 5. CSV 解析工具函数 parseLine、findCol
 * 6. 全局状态提示函数 showStatus
 * 
 * 依赖：
 * - 全局变量 map, markers, csvData, arrowLayer 等由 app.js 初始化并挂载到 window
 * - 日期选择后通过 window.App.enterHistoryMode(dateStr) 通知主应用切换模式
 */

const AppModules = {
    // ==================== 日历状态 ====================
    // 维护历史数据和预测数据两个日历的当前显示年月
    calendarState: {
        history: { year: 2024, month: 0 },   // month 为 0-based（0=一月）
        predict: { year: 2024, month: 0 }
    },

    // ==================== 全局固定菜单初始化 ====================
    /**
     * 初始化左下角五个功能按钮的二级菜单交互
     * 绑定按钮点击事件，控制菜单的弹出/收回，以及时间轴的显隐
     */
    initGlobalFixedMenu() {
        console.log('[DEBUG] initGlobalFixedMenu() called');
        // 获取所有带菜单目标的按钮（实时数据、历史数据、模型预测、突发事件、路线规划）
        const menuBtns = document.querySelectorAll('.left-fixed-btn-group button[data-menu-target]');
        // 获取所有二级菜单面板
        const allSubmenus = document.querySelectorAll('.fixed-submenu');
        // 底部时间轴容器（可能不存在于 DOM 中，需要空安全处理）
        const timelineEl = document.querySelector('.timeline-container');
        // 菜单容器（用于阻止点击冒泡）
        const menuBox = document.querySelector('.global-fixed-submenu-box');

        /**
         * 关闭所有已打开的二级菜单
         * 为正在显示的菜单添加 closing 动画类，动画结束后移除 active 和 closing
         * @param {boolean} keepModeActive - 如果为 true，保留按钮的 mode-active 样式（点击外部时用）
         */
        function closeAllMenus(keepModeActive) {
            allSubmenus.forEach(menu => {
                if (menu.classList.contains('active')) {
                    menu.classList.add('closing');
                    menu.addEventListener('animationend', function handler() {
                        menu.classList.remove('active', 'closing');
                        menu.removeEventListener('animationend', handler);
                    }, { once: true });
                }
            });
            // 移除所有按钮的菜单激活样式（但保留模式激活样式）
            menuBtns.forEach(btn => btn.classList.remove('active'));
        }

        /**
         * 关闭底部时间轴
         */
        function closeTimeline() {
            if (!timelineEl) return;
            if (!timelineEl.classList.contains('active')) return;
            timelineEl.classList.add('closing');
            timelineEl.addEventListener('animationend', () => {
                timelineEl.classList.remove('active', 'closing');
            }, { once: true });
        }

        /**
         * 显示底部时间轴
         */
        function showTimeline() {
            if (!timelineEl) return;
            timelineEl.classList.remove('closing');
            void timelineEl.offsetWidth; // 强制重绘，确保动画重新触发
            timelineEl.classList.add('active');
        }

        // 阻止时间轴内部的点击事件冒泡到 document（避免误关闭菜单）
        if (timelineEl) {
            timelineEl.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // 为每个功能按钮绑定点击事件
        menuBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetMenuId = btn.getAttribute('data-menu-target');
                const targetMenu = document.getElementById(targetMenuId);
                const isMenuActive = targetMenu.classList.contains('active');
                const isModeActive = btn.classList.contains('mode-active');
                const btnId = btn.id;

                // 判断当前按钮是否为历史数据或模型预测（这两个按钮需要显示日历+时间轴）
                const isCalendarBtn = (btnId === 'showHistoryBtn' || btnId === 'predictTrafficBtn');

                // ===== 模式已激活时再次点击按钮 → 退出模式 =====
                if (isModeActive) {
                    // 关闭菜单
                    closeAllMenus();
                    // 移除模式激活样式
                    btn.classList.remove('mode-active');

                    if (isCalendarBtn) {
                        // 历史/预测：再次点击退出模式
                        if (btnId === 'showHistoryBtn' && window.App && window.App.exitHistoryMode) {
                            window.App.exitHistoryMode();
                        }
                        // 预测暂无独立退出，走通用
                        if (btnId === 'predictTrafficBtn' && window.App && window.App.exitHistoryMode) {
                            window.App.exitHistoryMode();
                        }
                        closeTimeline();
                    } else if (btnId === 'realtimePlanBtn') {
                        if (window.App && window.App.exitPlanMode) {
                            window.App.exitPlanMode();
                        }
                    } else {
                        // 实时数据/自定义：退出模式
                        if (window.App && window.App.stopAllVisualizations) {
                            window.App.stopAllVisualizations();
                        }
                    }
                    return;
                }

                // ===== 菜单已打开但模式未激活（不应出现，防御性处理） =====
                if (isMenuActive) {
                    closeAllMenus();
                    return;
                }

                // ===== 点击不同按钮：先退出当前模式，再进入新模式 =====
                // 退出当前模式
                if (window.App && window.App.exitPlanMode && window.App.planModeActive) {
                    window.App.exitPlanMode();
                }
                if (window.App && window.App.exitHistoryMode && window.App.historyModeActive) {
                    window.App.exitHistoryMode();
                }
                if (window.App && window.App.stopAllVisualizations) {
                    window.App.stopAllVisualizations();
                }
                // 清除所有模式按钮的 mode-active
                menuBtns.forEach(b => b.classList.remove('mode-active'));
                closeAllMenus();

                // 标记当前按钮为模式激活
                btn.classList.add('mode-active');

                if (isCalendarBtn) {
                    // 历史/预测：渲染对应日历并显示时间轴
                    if (btnId === 'showHistoryBtn') {
                        if (window.App && window.App.enterHistoryMode) window.App.enterHistoryMode();
                        this.renderCalendar('historyCalendar', 'history');
                    } else if (btnId === 'predictTrafficBtn') {
                        if (window.App && window.App.enterHistoryMode) window.App.enterHistoryMode();
                        this.renderCalendar('predictCalendar', 'predict');
                    }
                    showTimeline();
                } else {
                    // 其他按钮：只开菜单，关闭时间轴
                    closeTimeline();
                }

                // 打开当前菜单并高亮按钮
                targetMenu.classList.remove('closing');
                void targetMenu.offsetWidth;
                targetMenu.classList.add('active');
                btn.classList.add('active');
            });
        });

        // 子菜单项点击：关闭全部菜单和时间轴
        // 注意：日历中的日期选择由 renderCalendar 生成的 onclick 处理，不走这里
        document.querySelectorAll('#realtimeMenu .submenu-item, #customizeMenu .submenu-item, #planMenu .submenu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // 关闭菜单（保留 mode-active）
                closeAllMenus();
                closeTimeline();
            });
        });

        // 点击菜单容器内部时不冒泡到 document（避免点击菜单时意外关闭）
        if (menuBox) {
            menuBox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // 点击菜单/按钮以外的区域：关闭所有菜单（保持模式激活，按钮 mode-active 保留）
        document.addEventListener('click', (e) => {
            // 如果点击目标在按钮组、菜单面板或路线规划面板内，不处理
            const btnGroup = document.querySelector('.left-fixed-btn-group');
            if (btnGroup && btnGroup.contains(e.target)) return;
            if (menuBox && menuBox.contains(e.target)) return;

            // 检查是否有打开的菜单
            const anyOpen = Array.from(allSubmenus).some(m => m.classList.contains('active'));
            if (!anyOpen) return;

            // 关闭所有菜单（保留 mode-active，再次点击按钮才退出模式）
            closeAllMenus();
        });
    },

    // ==================== 日历渲染 ====================
    /**
     * 渲染指定类型的日历到对应容器中
     * @param {string} containerId - 日历容器的 DOM id，如 'historyCalendar' 或 'predictCalendar'
     * @param {string} type - 日历类型，'history' 或 'predict'
     */
    renderCalendar(containerId, type) {
        const container = document.getElementById(containerId);
        const state = this.calendarState[type];
        const year = state.year;
        const month = state.month;

        // 计算当月第一天和最后一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay(); // 0=周日, 1=周一, ...
        const daysInMonth = lastDay.getDate();
        const prevLastDay = new Date(year, month, 0).getDate();

        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

        // 构建日历 HTML
        let html = `
            <div class="calendar-header">
                <button class="calendar-nav-btn" onclick="AppModules.changeMonth('${type}', -1)">&lt;</button>
                <span>${year}年${month + 1}月</span>
                <button class="calendar-nav-btn" onclick="AppModules.changeMonth('${type}', 1)">&gt;</button>
            </div>
            <div class="calendar-grid">
        `;

        // 星期头
        weekDays.forEach(day => {
            html += `<div class="calendar-day-header">${day}</div>`;
        });

        // 上月剩余天数（灰色显示）
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            html += `<div class="calendar-day other-month">${prevLastDay - i}</div>`;
        }

        // 当月天数
        const today = new Date();
        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === i;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            html += `<div class="calendar-day ${isToday ? 'today' : ''}" onclick="AppModules.selectDate('${dateStr}', '${type}')">${i}</div>`;
        }

        // 下月填充天数
        const totalCells = startDayOfWeek + daysInMonth;
        const remainingCells = (7 - (totalCells % 7)) % 7;
        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-day other-month">${i}</div>`;
        }

        html += '</div>';
        container.innerHTML = html;
    },

    // ==================== 月份切换 ====================
    /**
     * 切换日历显示的月份
     * @param {string} type - 'history' 或 'predict'
     * @param {number} delta - 月份变化量，+1 表示下月，-1 表示上月
     */
    changeMonth(type, delta) {
        this.calendarState[type].month += delta;
        if (this.calendarState[type].month > 11) {
            this.calendarState[type].month = 0;
            this.calendarState[type].year++;
        } else if (this.calendarState[type].month < 0) {
            this.calendarState[type].month = 11;
            this.calendarState[type].year--;
        }
        const containerId = type === 'history' ? 'historyCalendar' : 'predictCalendar';
        this.renderCalendar(containerId, type);
    },

    // ==================== 日期选择 ====================
    /**
     * 用户点击日历上的某个日期后触发
     * 对于历史数据，通知主应用进入历史数据模式并加载对应日期的 CSV
     * 对于预测数据，目前功能搁置，仅提示开发中
     * @param {string} dateStr - 日期字符串，格式 YYYY-MM-DD
     * @param {string} type - 'history' 或 'predict'
     */
    selectDate(dateStr, type) {
        if (type === 'history') {
            console.log(`[UI] 选择历史日期: ${dateStr}`);
            // 通过主应用暴露的接口进入历史数据模式，确保模式状态一致
            if (window.App && window.App.enterHistoryMode) {
                window.App.enterHistoryMode(dateStr);
            } else {
                console.error('[UI] 主应用未挂载 enterHistoryMode 方法');
            }
        } else if (type === 'predict') {
            console.log(`[UI] 选择预测日期: ${dateStr}（预测功能开发中）`);
            this.showStatus('模型预测功能开发中');
        }

        // 关闭所有菜单（但保持模式按钮的 mode-active 状态）
        const allSubmenus = document.querySelectorAll('.fixed-submenu');
        const menuBtns = document.querySelectorAll('.left-fixed-btn-group button[data-menu-target]');
        allSubmenus.forEach(menu => menu.classList.remove('active'));
        menuBtns.forEach(btn => btn.classList.remove('active'));

        // 时间轴：历史模式下保持显示，预测模式下关闭
        const timelineEl = document.querySelector('.timeline-container');
        if (type !== 'history' && timelineEl.classList.contains('active')) {
            timelineEl.classList.add('closing');
            timelineEl.addEventListener('animationend', () => {
                timelineEl.classList.remove('active', 'closing');
            }, { once: true });
        }
        // 历史模式下确保时间轴可见
        if (type === 'history' && timelineEl) {
            timelineEl.classList.add('active');
            timelineEl.classList.remove('closing');
        }
    },

    // ==================== 箭头层（道路连接关系）====================
    /**
     * 根据当前 csvData 和 markers 构建有向箭头层
     * 读取每个 marker 的 connCols（Connection1~5），在相连的两个点之间绘制带箭头的折线
     */
    buildArrowLayer() {
        // 移除旧箭头层（如果存在）
        if (window.arrowLayer) window.map.removeLayer(window.arrowLayer);
        window.arrowLayer = L.layerGroup();

        // 箭头颜色：优先使用用户自定义颜色，否则使用默认绿色
        let color = window.customArrowColor || '#5ad2af';

        for (let i = 0; i < window.csvData.length; i++) {
            const row = window.csvData[i];
            const m = window.markers[i];
            if (!m || !m.connCols) continue;

            // 遍历当前 marker 的所有连接列
            for (let j of m.connCols) {
                if (j === -1 || j >= row.length) continue;
                const v = (row[j] || '').trim();
                if (!v || v.toLowerCase() === 'others' || v.toLowerCase() === 'n/a') continue;

                // 连接值为目标 marker 的行号（从 2 开始计数）
                const r = parseInt(v, 10);
                if (isNaN(r) || r < 2 || r - 2 >= window.markers.length) continue;

                const cm = window.markers[r - 2];
                if (cm) {
                    const line = L.polyline([m.getLatLng(), cm.getLatLng()], {
                        color: 'transparent',
                        weight: 0,
                        opacity: 0
                    });
                    line.startMarker = m;
                    line.endMarker = cm;
                    window.arrowLayer.addLayer(line);
                }
            }
        }
        window.map.addLayer(window.arrowLayer);
    },

    /**
     * 更新所有箭头的显示/隐藏状态
     * 当 showAllArrows 为 false 时，将箭头透明度设为 0（隐藏但不移除）
     */
    updateArrowsDisplay() {
        if (window.arrowLayer) {
            window.arrowLayer.eachLayer(l => l.setStyle({ opacity: window.showAllArrows ? 0.8 : 0 }));
        }
    },

    /**
     * 彻底移除箭头层
     */
    clearArrowLayer() {
        if (window.arrowLayer) {
            window.map.removeLayer(window.arrowLayer);
            window.arrowLayer = null;
        }
    },

    // ==================== 标记高亮管理 ====================
    /**
     * 清除所有高亮状态
     * 包括当前 popup 打开的高亮标记和所有脉冲动画标记
     */
    clearAllHighlights() {
        if (window.currentHighlightedMarker) {
            window.currentHighlightedMarker.setStyle({ fillColor: '#5ad2af', color: '#ffffff', weight: 2 });
        }
        window.currentPulsingMarkers.forEach(m => {
            m.setStyle({ fillColor: '#5ad2af', color: '#ffffff', weight: 2 });
            const el = m.getElement();
            if (el) {
                el.classList.remove('pulse');
                el.style.transform = '';
            }
        });
        window.currentPulsingMarkers.clear();
        window.currentHighlightedMarker = null;
    },

    // ==================== 标记标签管理 ====================
    /**
     * 更新所有 marker 的数字标签位置
     * 当地图缩放 >= 15 且数据点可见时显示标签，否则隐藏
     */
    updateAllLabels() {
        const show = window.map.getZoom() >= 15 && window.markersVisible;
        window.markers.forEach(m => {
            if (m.labelElement) {
                const cp = window.map.latLngToContainerPoint(m.getLatLng());
                m.labelElement.style.left = `${cp.x}px`;
                m.labelElement.style.top = `${cp.y + 10}px`;
                m.labelElement.style.transform = 'translateX(-50%)';
                m.labelElement.style.display = show ? 'block' : 'none';
                m.labelElement.classList.toggle('visible', show);
            }
        });
    },

    // ==================== 标记尺寸管理 ====================
    /**
     * 根据当前地图缩放级别更新所有 marker 的半径大小
     * 缩放 < 12：最小半径；缩放 > 16：最大半径；中间：基础半径
     * 不修改正在 hover 或高亮的标记
     */
    updateMarkerSizes() {
        const zoom = window.map.getZoom();
        let currentRadius = window.MARKER_BASE_RADIUS;
        if (zoom < 12) currentRadius = window.MARKER_MIN_RADIUS;
        if (zoom > 16) currentRadius = window.MARKER_MAX_RADIUS;

        window.markers.forEach(marker => {
            if (!marker._hovered && marker !== window.currentHighlightedMarker) {
                marker.setRadius(currentRadius);
            }
        });
    },

    // ==================== CSV 解析工具 ====================
    /**
     * 解析单行 CSV 文本，正确处理引号包裹的字段和内部逗号
     * @param {string} line - 一行 CSV 文本
     * @returns {string[]} - 解析后的字段数组
     */
    parseLine(line) {
        const f = [];
        let c = '', q = false;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') {
                // 处理转义引号（两个连续引号表示一个真实引号）
                if (q && line[i + 1] === '"') { c += '"'; i++; } else q = !q;
            } else if (line[i] === ',' && !q) {
                f.push(c);
                c = '';
            } else c += line[i];
        }
        f.push(c);
        return f;
    },

    /**
     * 在表头数组中查找目标列的索引
     * 支持多候选名称（大小写不敏感）和部分匹配
     * @param {string[]} cols - 表头数组
     * @param {string[]} cands - 候选名称数组
     * @returns {number} - 列索引，未找到返回 -1
     */
    findCol(cols, cands) {
        const n = cols.map(h => (h || '').toLowerCase());
        for (let c of cands) {
            let i = n.indexOf(c);
            if (i > -1) return i;
            i = n.findIndex(x => x.includes(c));
            if (i > -1) return i;
        }
        return -1;
    },

    // ==================== 状态提示 ====================
    /**
     * 在页面顶部中央显示一条临时状态提示消息
     * @param {string} msg - 要显示的文本
     * @param {boolean} err - 是否为错误消息（决定背景颜色）
     */
    showStatus(msg, err = false) {
        const s = document.getElementById('status');
        if (!s) return;
        s.textContent = msg;
        s.className = `status ${err ? 'error' : 'loading'}`;
        s.classList.remove('hide');
        s.classList.add('show');
        s.style.display = 'block';
        // 3 秒后自动消失
        setTimeout(() => {
            s.classList.remove('show');
            s.classList.add('hide');
            setTimeout(() => {
                s.style.display = 'none';
                s.classList.remove('hide');
            }, 300);
        }, 3000);
    }
};

// 将 UI 模块挂载到全局，供 HTML 内联事件和其他脚本调用
window.AppModules = AppModules;
