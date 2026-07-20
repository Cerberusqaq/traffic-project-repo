/**
 * data.js
 * 数据加载和处理模块
 * 
 * 职责：
 * 1. 加载基础地理数据（GeoJSON 路网 + 检测器 CSV）
 * 2. 加载历史数据（按日期从 CSV 文件读取）
 * 3. 时间滑块显示和时间步变化处理
 * 4. Marker 颜色更新（根据速度数据）
 * 5. 拥堵等级判断
 */

// ==================== 核心函数：加载基础数据 ====================
async function loadBaseData() {
    console.log('[Data] 开始加载基础数据...');
    try {
        document.querySelectorAll('.marker-label').forEach(el => el.remove());

        // ---------- 1. 加载道路路网 GeoJSON ----------
        console.log('[Data] 正在加载 GeoJSON 路网...');
        const geoResp = await fetch('/data/geojson/HK_RoadCentreline_260310.geojson');
        if (!geoResp.ok) {
            console.error('[Data] GeoJSON 加载失败，HTTP状态:', geoResp.status);
            window.showStatus('路网数据加载失败', true);
        } else {
            const geoData = await geoResp.json();
            console.log('[Data] GeoJSON 加载成功，特征数量:', geoData.features?.length || 0);
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
        console.log('[Data] 正在加载检测器基础信息 CSV...');
        const csvResp = await fetch('/data/base/hk_data_new.csv');
        if (!csvResp.ok) {
            console.error('[Data] 基础 CSV 加载失败，HTTP状态:', csvResp.status);
            window.showStatus('基础数据加载失败', true);
            return;
        }
        const blob = await csvResp.blob();
        const text = await decodeCSVText(blob);
        const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
        console.log('[Data] CSV 行数:', lines.length);
        const headers = AppModules.parseLine(lines[0]);
        console.log('[Data] CSV 表头:', headers);

        const latCol = AppModules.findCol(headers, ['Latitude', 'latitude', 'Lat', 'lat', '纬度']);
        const lngCol = AppModules.findCol(headers, ['Longitude', 'longitude', 'Lng', 'lng', '经度']);
        const detectorIdCol = AppModules.findCol(headers, ['detector_id', 'Detector_ID', 'id', 'ID']);
        const aidIdCol = AppModules.findCol(headers, ['AID_ID_Number', 'AID', 'aid_id', 'aidId']);
        console.log('[Data] 列索引 - lat:', latCol, 'lng:', lngCol, 'detectorId:', detectorIdCol, 'AID_ID:', aidIdCol);

        if (latCol === -1 || lngCol === -1) {
            console.error('[Data] 未找到经纬度列！');
            window.showStatus('数据格式错误：未找到坐标列', true);
            return;
        }

        globalConnCols = [];
        for (let i = 1; i <= 5; i++) {
            globalConnCols.push(headers.findIndex((h) => h.toLowerCase() === `connection${i}`.toLowerCase()));
        }
        console.log('[Data] 连接关系列:', globalConnCols);

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

            const roadEnIdx = headers.indexOf('Road_EN');
            const roadTcIdx = headers.indexOf('Road_TC');
            const roadEnValue = roadEnIdx > -1 ? (cells[roadEnIdx] || '').trim() : '';
            const roadTcValue = roadTcIdx > -1 ? (cells[roadTcIdx] || '').trim() : '';
            const isVirtual = roadEnValue === '' || roadTcValue === '';
            const congColIndex = headers.indexOf('Congestion_Level');
            const congLevel = congColIndex !== -1 ? cells[congColIndex] || 0 : 0;
            
            let popup = '<table style="font-size:10px;">';
            if (isVirtual) {
                popup += '<tr><td colspan="2" style="text-align:center;color:#999;">虚拟点 无信息</td></tr>';
            } else {
                ['AID_ID_Number', 'Road_EN', 'Road_TC', 'Direction', 'Speed_kmh'].forEach((h) => {
                    const idx = headers.indexOf(h);
                    let value = '';
                    if (idx > -1 && cells[idx]) {
                        value = typeof cells[idx] === 'string' ? 
                            cells[idx].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : 
                            cells[idx];
                    }
                    popup += `<tr><td><b>${h}:</b></td><td>${value || ''}</td></tr>`;
                });
                const congDesc = ['畅通无阻', '基本畅通', '缓行', '拥堵', '极端拥堵'];
                popup += `<tr><td><b>拥堵等级:</b></td><td>${congLevel} (${congDesc[congLevel]})</td></tr>`;
            }
            popup += '</table>';
            marker.bindPopup(popup, { zIndexOffset: 9999 });

            marker.congestionLevel = parseInt(congLevel);

            marker.csvRowData = cells;
            marker.on('click', function(e) {
                if (window.handleMarkerNodeSelect && window.handleMarkerNodeSelect(this)) {
                    L.DomEvent.preventDefault(e);
                    L.DomEvent.stopPropagation(e);
                }
            });
            marker.on('popupopen', function(e) {
                if (window.isPathSelectMode || window.isNodeSelectMode) {
                    this.closePopup();
                }
            });

            marker._hovered = false;
            marker.on('mouseover', () => {
                marker._hovered = true;
                marker.setRadius(MARKER_HOVER_RADIUS);
            });
            marker.on('mouseout', () => {
                marker._hovered = false;
                AppModules.updateMarkerSizes();
            });

            const label = document.createElement('div');
            label.className = 'marker-label';
            label.textContent = `#${i + 2}`;
            label.style.cssText = 'position: absolute; z-index: 100; pointer-events: none; transform: translateX(-50%);';
            document.body.appendChild(label);
            marker.labelElement = label;

            marker.on('popupopen', function () {
                if (currentHighlightedMarker && currentHighlightedMarker !== this) AppModules.clearAllHighlights();
                currentHighlightedMarker = this;
                this.setStyle({ fillColor: '#fac373', color: '#fac373', weight: 3 });
                AppModules.updateArrowsDisplay();
                const particleContainer = document.getElementById('particleContainer');
                if (particleContainer) particleContainer.style.display = 'none';
            });
            marker.on('popupclose', () => {
                AppModules.clearAllHighlights();
                AppModules.updateArrowsDisplay();
                const particleContainer = document.getElementById('particleContainer');
                if (particleContainer) particleContainer.style.display = 'block';
            });

            marker.rowNumber = i + 2;
            marker.rowData = cells;
            if (detectorIdCol !== -1) {
                marker.rowData.detector_id = cells[detectorIdCol];
            }
            if (aidIdCol !== -1) {
                marker.rowData.AID_ID_Number = cells[aidIdCol];
            }
            marker.connCols = globalConnCols;

            markers.push(marker);
            rowToMarkerMap[i + 2] = marker;
            marker.addTo(pointLayer);
            csvData.push(cells);
            validMarkers++;
        }
        console.log('[Data] 成功创建', validMarkers, '个有效 Marker');

        if (pointLayer.getBounds && pointLayer.getBounds().isValid()) {
            map.fitBounds(pointLayer.getBounds());
            console.log('[Data] 地图视野已调整');
        } else {
            console.warn('[Data] 无法获取有效边界，保持默认视野');
        }

        AppModules.updateAllLabels();
        AppModules.buildArrowLayer();
        AppModules.updateMarkerSizes();

        if (window.ParticleModule) {
            console.log('[Data] 初始化粒子模块...');
            window.ParticleModule.init();
            window.ParticleModule.rebuildRoutes();
            window.AppModules.particle = window.ParticleModule;
        } else {
            console.warn('[Data] 粒子模块未就绪');
        }

        window.showStatus('基础数据加载完成');
        console.log('[Data] 基础数据加载成功！');
    } catch (e) {
        console.error('[Data] 基础数据加载失败:', e);
        window.showStatus('基础数据加载失败', true);
    }
}

// ==================== 核心函数：加载历史数据 ====================
async function loadCsvByDate(dateStr) {
    console.log('[Data] 开始加载历史数据:', dateStr);
    try {
        document.querySelectorAll('.marker-label').forEach(el => el.remove());

        const [year, month, day] = dateStr.split('-');
        const monthFolder = `${year}-${month}`;
        const csvFileName = `fd_${dateStr}.csv`;
        const csvUrl = `/data/monthly/${monthFolder}/${csvFileName}`;
        console.log('[Data] 请求历史数据 URL:', csvUrl);

        const resp = await fetch(csvUrl);
        if (!resp.ok) {
            console.error('[Data] 历史数据加载失败，HTTP状态:', resp.status);
            window.showToast('当前日期数据缺失，抱歉！');
            exitHistoryMode();
            return;
        }
        window.showStatus(`正在加载 ${dateStr} ...`);
        const blob = await resp.blob();
        const text = await decodeCSVText(blob);
        const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');
        if (lines.length <= 1) {
            console.error('[Data] 历史数据为空');
            window.showToast('当前日期数据缺失，抱歉！');
            exitHistoryMode();
            return;
        }
        console.log('[Data] 历史数据行数:', lines.length - 1);

        const headers = AppModules.parseLine(lines[0]);
        const detectorIdCol = AppModules.findCol(headers, ['detector_id', 'Detector_ID']);
        const timeStepCol = AppModules.findCol(headers, ['time_step', 'Time_Step']);
        const totalVolumeCol = AppModules.findCol(headers, ['total_volume', 'Total_Volume']);
        const avgSpeedCol = AppModules.findCol(headers, ['avg_speed', 'Avg_Speed']);
        const avgOccupancyCol = AppModules.findCol(headers, ['avg_occupancy', 'Avg_Occupancy']);
        console.log('[Data] 历史数据列索引:', { detectorIdCol, timeStepCol, totalVolumeCol, avgSpeedCol, avgOccupancyCol });

        if (detectorIdCol < 0) {
            console.error('[Data] 未找到 detector_id 列');
            window.showToast('当前日期数据缺失，抱歉！');
            exitHistoryMode();
            return;
        }

        const historyByDetector = {};
        const timeWindowMap = {};
        const twCol = AppModules.findCol(headers, ['time_window', 'Time_Window']);
        for (let i = 1; i < lines.length; i++) {
            const cells = AppModules.parseLine(lines[i]);
            if (!cells || cells.length === 0) continue;
            const detId = cells[detectorIdCol] ? String(cells[detectorIdCol]).trim() : '';
            if (!detId) continue;
            const ts = timeStepCol >= 0 ? parseInt(cells[timeStepCol]) || 0 : 0;
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
        window._timeWindowMap = timeWindowMap;
        const detectorCount = Object.keys(historyByDetector).length;
        console.log(`[Data] 历史数据解析完成: ${detectorCount} 个检测器, ${lines.length - 1} 条记录`);

        if (arrowLayer) { map.removeLayer(arrowLayer); arrowLayer = null; }

        let matchedCount = 0;
        markers.forEach(marker => {
            const detId = marker.rowData?.detector_id ? String(marker.rowData.detector_id).trim() : '';
            const histData = historyByDetector[detId];
            if (histData) {
                marker.historyData = histData;
                marker.isMatched = true;
                matchedCount++;
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
        console.log(`[Data] 历史数据匹配: ${matchedCount}/${markers.length} 个检测器`);

        if (matchedCount === 0) {
            window.showToast(`未找到 ${dateStr} 与现有数据点匹配的历史数据`);
            exitHistoryMode();
            return;
        }

        window._historyByDetector = historyByDetector;
        if (currentActiveMode !== 'predict') {
            window._currentHistoryDate = dateStr;
        }

        if (window.ParticleModule) {
            console.log('[Data] 初始化粒子模块并加载流量数据...');
            window.ParticleModule.init();
            window.ParticleModule.rebuildRoutes();
            window.ParticleModule.loadTrafficData(text);
            window.ParticleModule.setCurrentTimeStep(0);
            window.ParticleModule.start();
            if (!visualPlaybackActive) {
                toggleVisualPlayPause(true);
            }
        }

        showTimeSlider(historyByDetector, timeWindowMap);

        console.log(`[Data] 成功加载 ${dateStr} 历史数据`);
    } catch (error) {
        console.error('[Data] 历史数据加载失败：', error);
        window.showToast('历史数据加载失败: ' + error.message);
        exitHistoryMode();
    }
}

/**
 * 显示时间滑块，基于历史数据的 time_window
 */
function showTimeSlider(historyByDetector, timeWindowMap) {
    const timeEl = document.getElementById('bottomBarTime');
    const sepEl = document.getElementById('bottomBarSep');
    if (timeEl) timeEl.style.display = 'inline';
    if (sepEl) sepEl.style.display = 'inline';

    const exitBtn = document.getElementById('exitHistoryBtn');
    if (exitBtn) exitBtn.classList.add('visible');

    const steps = Object.keys(timeWindowMap).map(Number).sort((a, b) => a - b);
    if (steps.length === 0) {
        const tsSet = new Set();
        for (const det of Object.values(historyByDetector)) {
            for (const ts of Object.keys(det)) tsSet.add(Number(ts));
        }
        const sortedSteps = [...tsSet].sort((a, b) => a - b);
        if (sortedSteps.length === 0) return;
        sortedSteps.forEach(ts => { timeWindowMap[ts] = `Step ${ts}`; });
        steps.push(...sortedSteps);
    }

    window._historyTimeSteps = steps;
    window._historyTimeWindowMap = timeWindowMap;

    const sliderContainer = document.getElementById('timeSliderContainer');
    const slider = document.getElementById('timeSlider');
    const sliderLabel = document.getElementById('timeSliderLabel');
    
    if (slider && sliderContainer && sliderLabel) {
        slider.min = 0;
        slider.max = steps.length - 1;
        slider.value = 0;
        sliderContainer.style.display = 'flex';
        
        const startStep = steps[0];
        const tw = timeWindowMap[startStep] || `Step ${startStep}`;
        sliderLabel.textContent = formatTimeWindow(tw);
        
        slider.oninput = function() {
            const idx = parseInt(this.value);
            const timeStep = steps[idx];
            const tw = timeWindowMap[timeStep] || `Step ${timeStep}`;
            sliderLabel.textContent = formatTimeWindow(tw);
            
            if (window.ParticleModule) {
                window.ParticleModule.setCurrentTimeStep(timeStep);
            }
            updateBottomBar(timeStep);
            
            if (window.onTimeStepChange) {
                window.onTimeStepChange(timeStep);
            }
        };
    }

    const startStep = steps[0];
    if (window.ParticleModule) {
        window.ParticleModule.setCurrentTimeStep(startStep);
    }
    updateBottomBar(startStep);
    
    if (window.onTimeStepChange) {
        window.onTimeStepChange(startStep);
    }

    console.log(`[Data] 时间信息已就绪: ${steps.length} 个时间步`);
}

/**
 * 格式化时间窗口显示
 */
function formatTimeWindow(tw) {
    const match = tw.match(/(\d{1,2}):(\d{2})/);
    if (match) {
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
    const stepMatch = tw.match(/Step\s*(\d+)/);
    if (stepMatch) {
        const step = parseInt(stepMatch[1]);
        const hour = Math.floor(step / 6);
        const minute = (step % 6) * 10;
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    return tw;
}

/**
 * 粒子模块时间步变化回调
 */
window.onTimeStepChange = function(timeStep) {
    window._currentTimeStep = timeStep;
    
    updateBottomBar(timeStep);
    
    if ((currentActiveMode === 'history' || currentActiveMode === 'predict') && window._currentHistoryDate) {
        const baseTime = new Date(`${window._currentHistoryDate}T00:00:00`);
        const timeMinutes = timeStep * 10;
        currentDateTime = new Date(baseTime.getTime() + timeMinutes * 60 * 1000);
        console.log('[Data] 当前时间更新为:', currentDateTime);
        updateRealtimeClock();
    }

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

    if (window._heatmapVisible && window.updateHeatmapData) {
        window.updateHeatmapData(timeStep);
    }

    if (window._historyByDetector) {
        updateMarkerColors(timeStep);
    }

    try {
        if (window.ParticleModule && window.ParticleModule.updateColors) {
            window.ParticleModule.updateColors();
        }
    } catch (e) {
        console.error('[Data] 更新粒子颜色失败:', e);
    }

    if (planTimeStepRange && timeStep > planTimeStepRange.endStep) {
        window.ParticleModule.setCurrentTimeStep(planTimeStepRange.startStep);
    }

    updateDetectorDataTable();
};

/**
 * 更新所有 marker 的颜色（根据当前时间步的速度数据）
 */
function updateMarkerColors(timeStep) {
    console.log('[Data] updateMarkerColors 被调用, timeStep=' + timeStep);
    
    for (const marker of markers) {
        const detId = marker.rowData?.detector_id ? String(marker.rowData.detector_id).trim() : '';
        const histData = window._historyByDetector?.[detId];
        
        if (histData && histData[timeStep]) {
            const speed = histData[timeStep].speed;
            const color = getMarkerColorBySpeed(speed);
            marker.setStyle({ fillColor: color, fillOpacity: 1 });
        } else if (marker.isMatched) {
            marker.setStyle({ fillColor: '#5ad2af', fillOpacity: 1 });
        }
    }
    console.log('[Data] updateMarkerColors 完成');
}

/**
 * 根据速度获取 marker 颜色
 */
function getMarkerColorBySpeed(speed) {
    if (speed >= 60) return '#5ad2af';
    if (speed >= 40) return '#a8d8ea';
    if (speed >= 20) return '#ffd369';
    if (speed >= 10) return '#ff9f43';
    return '#ee5a24';
}

/**
 * 根据平均速度返回拥堵状态描述文本
 */
function getCongestionLevel(avgSpeed) {
    const speed = parseFloat(avgSpeed);
    if (isNaN(speed)) return '未知状态';
    if (speed >= 60) return '✅ 畅通';
    if (speed >= 40) return '⚠️ 缓行';
    if (speed >= 20) return '🔴 拥堵';
    return '🟤 严重拥堵';
}