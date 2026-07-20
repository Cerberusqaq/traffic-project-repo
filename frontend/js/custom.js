/**
 * custom.js
 * 自定义路径和突发事件模拟模块
 * 
 * 职责：
 * 1. 自定义路径功能（节点选择、连接添加/移除、权重设置）
 * 2. 突发事件模拟（节点选择、事件类型、严重程度、提交模拟）
 * 3. 模拟结果展示和预测数据处理
 * 4. 地图点击事件拦截（节点选择模式）
 */

// ==================== 全局状态 ====================

window.customConnections = [];
window.pathSelectedNodes = [];
window.isPathSelectMode = false;
let pathSelectCallback = null;
let customConnectionLayer = null;

window.isNodeSelectMode = false;
window.selectedEmergencyNodes = [];
let emergencySimData = null;

const WILLINGNESS_MAP = {
    'low': 0.2,
    'medium-low': 1.0,
    'medium-high': 3.0,
    'high': 10.0
};
let currentWillingness = 'medium-low';
let confirmWillingness = 'medium-low';

// ==================== 自定义路径功能 ====================

window.selectWillingness = function(level) {
    currentWillingness = level;
    document.querySelectorAll('#willingnessBtns .willingness-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.level === level);
    });
    const slider = document.getElementById('pathWeight');
    if (slider) {
        slider.value = WILLINGNESS_MAP[level];
        const valEl = document.getElementById('pathWeightValue');
        if (valEl) valEl.textContent = WILLINGNESS_MAP[level].toFixed(1);
    }
};

window.toggleAdvancedWeight = function() {
    const panel = document.getElementById('advancedWeightPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('pathWeight');
    if (slider) {
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            const valEl = document.getElementById('pathWeightValue');
            if (valEl) valEl.textContent = val.toFixed(1);
            document.querySelectorAll('#willingnessBtns .willingness-btn').forEach(b => b.classList.remove('active'));
        });
    }
    const confirmSlider = document.getElementById('pathConfirmWeight');
    if (confirmSlider) {
        confirmSlider.addEventListener('input', () => {
            const val = parseFloat(confirmSlider.value);
            const valEl = document.getElementById('pathConfirmWeightValue');
            if (valEl) valEl.textContent = val.toFixed(1);
        });
    }
});

window.startPathSelection = function() {
    const mode = document.getElementById('pathMode').value;
    window.isPathSelectMode = true;
    window.pathSelectedNodes = [];

    const btn = document.getElementById('startPathBtn');
    if (btn) {
        btn.textContent = mode === 'add' ? '点击节点添加连接' : '点击节点移除连接';
        btn.classList.add('active');
    }

    const display = document.getElementById('pathNodesDisplay');
    if (display) display.textContent = '请在地图上点击两个节点...';

    const status = document.getElementById('pathStatus');
    if (status) status.textContent = '';

    const confirmBar = document.getElementById('pathConfirmBar');
    if (confirmBar) confirmBar.style.display = 'none';
};

window.undoPathNode = function() {
    if (window.pathSelectedNodes.length > 0) {
        window.pathSelectedNodes.pop();
        updatePathNodesDisplay();
    }
};

function updatePathNodesDisplay() {
    const display = document.getElementById('pathNodesDisplay');
    if (!display) return;

    if (window.pathSelectedNodes.length === 0) {
        display.textContent = '请在地图上点击节点...';
    } else {
        display.innerHTML = window.pathSelectedNodes.map(id =>
            `<span class="node-tag">${id}</span>`
        ).join(' → ');
    }
}

window.confirmPathOperation = function() {
    const mode = document.getElementById('pathMode').value;
    if (window.pathSelectedNodes.length < 2) {
        window.showToast('请至少选择两个节点');
        return;
    }

    const from = window.pathSelectedNodes[0];
    const to = window.pathSelectedNodes[1];

    let weight = 1.0;
    const confirmWeightSlider = document.getElementById('pathConfirmWeight');
    const confirmAdvancedPanel = document.getElementById('confirmAdvancedPanel');
    if (confirmAdvancedPanel && confirmAdvancedPanel.style.display !== 'none' && confirmWeightSlider) {
        weight = parseFloat(confirmWeightSlider.value);
    } else {
        weight = WILLINGNESS_MAP[confirmWillingness] || 1.0;
    }

    if (mode === 'add') {
        const exists = window.customConnections.some(c => c.from === from && c.to === to);
        if (exists) {
            window.showToast('该连接已存在');
            return;
        }
        window.customConnections.push({ from, to, weight });
        window.showToast(`已添加连接: ${from} → ${to} (权重: ${weight.toFixed(1)})`);
    } else {
        const idx = window.customConnections.findIndex(c => c.from === from && c.to === to);
        if (idx >= 0) {
            window.customConnections.splice(idx, 1);
            window.showToast(`已移除连接: ${from} → ${to}`);
        } else {
            window.showToast('未找到该连接');
        }
    }

    window.isPathSelectMode = false;
    window.pathSelectedNodes = [];
    updatePathNodesDisplay();
    updateConnectionList();
    updateCustomConnectionsDisplay();

    const btn = document.getElementById('startPathBtn');
    if (btn) {
        btn.textContent = '开始选择节点';
        btn.classList.remove('active');
    }
    const undoBtn = document.getElementById('undoPathBtn');
    if (undoBtn) undoBtn.style.display = 'none';
    const confirmBar = document.getElementById('pathConfirmBar');
    if (confirmBar) confirmBar.style.display = 'none';
    const status = document.getElementById('pathStatus');
    if (status) status.textContent = '';
};

window.cancelPathConfirm = function() {
    window.isPathSelectMode = true;
    const confirmBar = document.getElementById('pathConfirmBar');
    if (confirmBar) confirmBar.style.display = 'none';
    const status = document.getElementById('pathStatus');
    if (status) status.textContent = '继续选择节点...';
};

window.selectConfirmWillingness = function(level) {
    confirmWillingness = level;
    document.querySelectorAll('#confirmWillingnessBtns .willingness-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.level === level);
    });
    const slider = document.getElementById('pathConfirmWeight');
    if (slider) {
        slider.value = WILLINGNESS_MAP[level];
        const valEl = document.getElementById('pathConfirmWeightValue');
        if (valEl) valEl.textContent = WILLINGNESS_MAP[level].toFixed(1);
    }
};

window.toggleConfirmAdvanced = function() {
    const panel = document.getElementById('confirmAdvancedPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

function updateConnectionList() {
    const list = document.getElementById('connectionList');
    const count = document.getElementById('connectionCount');
    if (!list) return;

    if (count) count.textContent = window.customConnections.length;

    if (window.customConnections.length === 0) {
        list.innerHTML = '<div class="connection-empty">暂无自定义连接</div>';
        return;
    }

    list.innerHTML = window.customConnections.map((c, i) => `
        <div class="connection-item">
            <div class="conn-info">
                <span class="conn-node">${c.from}</span>
                <span class="conn-arrow">→</span>
                <span class="conn-node">${c.to}</span>
                <span class="conn-weight">×${c.weight.toFixed(1)}</span>
            </div>
            <button class="conn-remove" onclick="removeConnection(${i})">×</button>
        </div>
    `).join('');
}

window.removeConnection = function(index) {
    window.customConnections.splice(index, 1);
    updateConnectionList();
    updateCustomConnectionsDisplay();
};

window.resetNetwork = function() {
    window.customConnections = [];
    updateConnectionList();
    updateCustomConnectionsDisplay();
    window.showToast('路网已重置');
};

function updateCustomConnectionsDisplay() {
    if (!window.map) return;

    if (customConnectionLayer) {
        window.map.removeLayer(customConnectionLayer);
    }

    customConnectionLayer = L.layerGroup();

    for (const conn of window.customConnections) {
        const fromMarker = findMarkerByRowId(conn.from);
        const toMarker = findMarkerByRowId(conn.to);

        if (fromMarker && toMarker) {
            const line = L.polyline([fromMarker.getLatLng(), toMarker.getLatLng()], {
                color: '#22c55e',
                weight: 4,
                opacity: 0.8,
                dashArray: '8,4'
            });
            line.addTo(customConnectionLayer);
        }
    }

    customConnectionLayer.addTo(window.map);
}

// ==================== 突发事件模拟功能 ====================

window.toggleNodeSelection = function() {
    window.isNodeSelectMode = !window.isNodeSelectMode;
    const btn = document.getElementById('nodeSelectBtn');
    if (btn) btn.classList.toggle('active', window.isNodeSelectMode);

    if (window.isNodeSelectMode) {
        window.showToast('点击地图上的数据点选择受影响节点');
    }
};

window.removeEmergencyNode = function(nodeId) {
    window.selectedEmergencyNodes = window.selectedEmergencyNodes.filter(n => n !== nodeId);
    updateEmergencyNodesDisplay();
    syncEmergencyNodesInput();
};

function updateEmergencyNodesDisplay() {
    const display = document.getElementById('selectedNodesDisplay');
    if (!display) return;
    display.innerHTML = window.selectedEmergencyNodes.map(id =>
        `<span class="node-tag">${id}<span class="remove-node" onclick="removeEmergencyNode('${id}')">×</span></span>`
    ).join('');
}

function syncEmergencyNodesInput() {
    const input = document.getElementById('emergencyNodes');
    if (input) input.value = window.selectedEmergencyNodes.join(',');
}

function updateEmergencyParams() {
    const type = document.getElementById('emergencyType').value;
    const label = document.getElementById('severityLabel');
    const valSpan = document.getElementById('severityValue');
    const slider = document.getElementById('emergencySeverity');

    switch (type) {
        case 'lane_reduction':
            slider.min = '0'; slider.max = '1'; slider.step = '0.05'; slider.value = '0.5';
            if (label) label.innerHTML = `车道减少比例: <span id="severityValue">${Math.round(parseFloat(slider.value) * 100)}</span>%`;
            break;
        case 'speed_limit':
            slider.min = '0'; slider.max = '1'; slider.step = '0.05'; slider.value = '0.5';
            if (label) label.innerHTML = `限速比例: <span id="severityValue">${Math.round(parseFloat(slider.value) * 100)}</span>%`;
            break;
        case 'traffic_surge':
            slider.min = '1'; slider.max = '5'; slider.step = '0.1'; slider.value = '1.5';
            if (label) label.innerHTML = `流量增加倍数: <span id="severityValue">${parseFloat(slider.value).toFixed(1)}</span>x`;
            break;
        case 'road_block':
            if (label) label.innerHTML = `道路封闭: <span id="severityValue">完全封闭</span>`;
            break;
    }
}

window.submitEmergencySimulation = async function() {
    const type = document.getElementById('emergencyType').value;
    const nodesStr = document.getElementById('emergencyNodes').value.trim();
    const severity = parseFloat(document.getElementById('emergencySeverity').value);
    const steps = parseInt(document.getElementById('emergencySteps').value);

    let nodeIds = nodesStr.split(',').map(s => s.trim()).filter(Boolean);
    if (window.selectedEmergencyNodes.length > 0) {
        const set = new Set([...nodeIds, ...window.selectedEmergencyNodes.map(String)]);
        nodeIds = Array.from(set);
    }

    if (nodeIds.length === 0) {
        window.showToast('请输入或选择受影响节点');
        return;
    }

    const validIds = nodeIds.filter(id => {
        const n = parseInt(id);
        return !isNaN(n) && n >= 2 && n <= 1006;
    });
    if (validIds.length === 0) {
        window.showToast('没有有效的节点ID（范围2~1006）');
        return;
    }

    const statusEl = document.getElementById('emergencyStatus');
    const submitBtn = document.getElementById('emergencySubmitBtn');
    if (statusEl) statusEl.textContent = '正在执行模拟...';
    if (submitBtn) submitBtn.disabled = true;

    try {
        const startTimeStr = currentDateTime ? currentDateTime.toISOString() : new Date().toISOString();

        const requestBody = {
            node_ids: validIds.map(Number),
            event_type: type,
            severity: severity,
            predict_steps: steps,
            start_time: startTimeStr,
            custom_connections: window.customConnections,
            current_datetime: currentDateTime ? currentDateTime.toISOString() : null
        };

        const response = await fetch('/api/emergency/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            window.showToast(data.error);
            if (statusEl) statusEl.textContent = '模拟失败';
            return;
        }

        emergencySimData = data;
        if (statusEl) statusEl.textContent = '模拟完成，正在展示结果...';

        if (data.predictions && data.predictions.length > 0) {
            displayEmergencyResults(data);
        } else {
            if (statusEl) statusEl.textContent = '模拟完成（无预测数据返回）';
        }

    } catch (err) {
        console.error('[Emergency] 模拟失败:', err);
        window.showToast('模拟请求失败: ' + err.message);
        if (statusEl) statusEl.textContent = '模拟失败';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
};

function savePredictionDataToCSV(predictions, timeStepMinutes, eventType) {
    try {
        let csvContent = 'time_step,node_id,speed_change,flow,occupancy\n';

        predictions.forEach((stepData, stepIdx) => {
            const timeStep = stepIdx * timeStepMinutes;
            stepData.forEach(pred => {
                const nodeId = pred.node_id;
                const speedChange = pred.speed;
                const flow = pred.flow || 0;
                const occupancy = pred.occupancy || 0;
                csvContent += `${timeStep},${nodeId},${speedChange},${flow},${occupancy}\n`;
            });
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `prediction_results_${eventType}_${timestamp}.csv`;

        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log(`[Emergency] 预测数据已保存为CSV: ${fileName}`);
        window.showToast(`预测数据已保存到下载目录: ${fileName}`);
    } catch (error) {
        console.error('[Emergency] 保存CSV失败:', error);
    }
}

function displayEmergencyResults(data) {
    const emergencyEvent = data.emergency_event || {};
    const eventType = emergencyEvent.type || emergencyEvent.event_type || 'unknown';
    const eventTypeMap = {
        'lane_reduction': '车道缩减',
        'speed_limit': '限速',
        'accident': '交通事故',
        'road_block': '道路封闭',
        'traffic_surge': '流量激增',
        'construction': '施工',
        'fire': '火灾',
        'weather': '天气影响',
        'holiday': '节假日',
        'concert': '大型活动',
        'emergency': '紧急事件',
        'unknown': '未知事件',
        'default': '突发事件',
        'congestion': '拥堵',
        'slow': '缓行',
        'jam': '严重拥堵',
        'traffic': '交通事件',
        'incident': '意外事件',
        'road_work': '道路施工',
        'lane_closed': '车道封闭',
        'bridge_closed': '桥梁封闭',
        'tunnel_closed': '隧道封闭',
        'flood': '洪水',
        'storm': '暴风雨',
        'snow': '雪天',
        'accidental': '意外事故',
        'collision': '碰撞事故',
        'vehicle_fire': '车辆起火',
        'breakdown': '车辆抛锚',
        'road_rage': '路怒事件',
        'protest': '抗议活动',
        'parade': '游行',
        'festival': '节日活动',
        'sports_event': '体育赛事',
        'conference': '大型会议'
    };
    currentPredictionEvent = eventTypeMap[eventType] || eventTypeMap['default'] || '突发事件';

    const header = document.getElementById('realtimeHeader');
    if (header) {
        header.style.display = 'flex';
    }

    const hintOverlay = document.getElementById('emergencyHintOverlay');
    if (hintOverlay) {
        hintOverlay.style.display = 'flex';
    }

    if (!currentDateTime) {
        currentDateTime = new Date();
    }
    updateRealtimeClock();

    console.log('[Emergency] 设置预测事件:', currentPredictionEvent);

    const nodeIds = (emergencyEvent.node_ids || []).map(Number);

    clearEmergencyHighlights();

    const predSteps = data.steps || 0;
    const timeStepMinutes = data.time_step || 10;
    if (predSteps > 0 && data.predictions && data.predictions.length > 0) {
        const statusEl = document.getElementById('emergencyStatus');
        if (statusEl) statusEl.textContent = `模拟完成: ${predSteps} 步预测 (每步 ${timeStepMinutes} 分钟)`;

        window.showToast(`突发事件模拟完成，影响 ${nodeIds.length} 个节点，预测 ${predSteps} 步`);

        window._predictionData = data.predictions;
        window._predictionTimeStep = timeStepMinutes;

        initPredictionTimeSlider(predSteps, timeStepMinutes);

        startEmergencyParticleSimulation(nodeIds, data.predictions, 0);
    }

    if (data.network_info) {
        console.log('[Emergency] 网络信息:', data.network_info);
    }
}

function initPredictionTimeSlider(steps, timeStepMinutes) {
    const sliderContainer = document.getElementById('timeSliderContainer');
    const slider = document.getElementById('timeSlider');
    const sliderLabel = document.getElementById('timeSliderLabel');

    if (slider && sliderContainer && sliderLabel) {
        const bottomBar = document.getElementById('bottomBar');
        if (bottomBar) bottomBar.classList.add('visible');

        const bottomBarDate = document.getElementById('bottomBarDate');
        if (bottomBarDate) bottomBarDate.textContent = '拖动滑块修改预测时间间隔';

        slider.min = 0;
        slider.max = steps - 1;
        slider.value = 0;
        sliderContainer.style.display = 'flex';

        sliderLabel.textContent = formatPredictionTime(0, timeStepMinutes);

        slider.oninput = function() {
            const stepIdx = parseInt(this.value);
            sliderLabel.textContent = formatPredictionTime(stepIdx, timeStepMinutes);

            const hintOverlay = document.getElementById('emergencyHintOverlay');
            if (hintOverlay && hintOverlay.style.display === 'flex') {
                hintOverlay.style.display = 'none';
            }

            if (window._predictionData && window.ParticleModule) {
                updatePredictionStep(stepIdx);
            }
        };
    }
}

function formatPredictionTime(stepIdx, timeStepMinutes) {
    const totalMinutes = stepIdx * timeStepMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `预测 +${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function updatePredictionStep(stepIdx) {
    if (!window._predictionData || stepIdx < 0 || stepIdx >= window._predictionData.length) {
        return;
    }

    const predictions = window._predictionData;
    const stepData = predictions[stepIdx];

    const predictionDataMap = {};
    stepData.forEach(pred => {
        if (pred.node_id !== undefined && pred.speed !== undefined) {
            const nodeId = parseInt(pred.node_id);
            if (!isNaN(nodeId)) {
                predictionDataMap[nodeId] = {
                    speed: pred.speed,
                    flow: pred.flow
                };
            }
        }
    });

    const newTrafficData = {};
    if (window.markers) {
        const detectorMap = {};
        if (realtimeTrafficData && realtimeTrafficData.records) {
            for (const rec of realtimeTrafficData.records) {
                const id = rec.detector_id;
                if (!detectorMap[id]) {
                    detectorMap[id] = { speeds: [], volumes: [] };
                }
                detectorMap[id].speeds.push(rec.speed);
                detectorMap[id].volumes.push(rec.volume);
            }
        }

        window.markers.forEach(marker => {
            const rowData = marker.csvRowData || marker.rowData;
            if (marker && rowData) {
                const rowId = parseInt(rowData[0]);

                if (rowId && !isNaN(rowId)) {
                    const detId = String(marker.rowData?.detector_id).trim();

                    let baseSpeed = 0;
                    let baseVolume = 0;
                    if (detectorMap[detId]) {
                        const data = detectorMap[detId];
                        baseSpeed = data.speeds.reduce((a, b) => a + b, 0) / data.speeds.length;
                        baseVolume = data.volumes.reduce((a, b) => a + b, 0);
                    }

                    let predictSpeed = 0;
                    let predictFlow = 0;
                    if (predictionDataMap[rowId] !== undefined) {
                        predictSpeed = predictionDataMap[rowId].speed;
                        predictFlow = predictionDataMap[rowId].flow;
                    }

                    if (baseSpeed > 0 || predictSpeed !== undefined) {
                        newTrafficData[rowId] = {
                            speed: baseSpeed + predictSpeed,
                            volume: baseVolume > 0 ? baseVolume : predictFlow
                        };
                    }
                }
            }
        });
    }

    if (window.ParticleModule) {
        window.ParticleModule.resetTrafficData(newTrafficData);
        window.ParticleModule.rebuildRoutes();
        window.ParticleModule.start();
    }

    console.log(`[Emergency] 切换到预测时间步 ${stepIdx}`);
}

function startEmergencyParticleSimulation(nodeIds, predictions, stepIdx = 0) {
    if (!window.ParticleModule) {
        console.error('[Emergency] ParticleModule 未定义');
        return;
    }
    window.ParticleModule.init();

    window.ParticleModule.stop(false);

    window.ParticleModule.ensureAnimationRunning();

    globalParticlePaused = false;
    particlePauseTime = 0;

    const predictionDataMap = {};
    if (predictions && predictions.length > 0 && stepIdx >= 0 && stepIdx < predictions.length) {
        const stepData = predictions[stepIdx];
        stepData.forEach(pred => {
            if (pred.node_id !== undefined && pred.speed !== undefined) {
                const nodeId = parseInt(pred.node_id);
                if (!isNaN(nodeId)) {
                    predictionDataMap[nodeId] = {
                        speed: pred.speed,
                        flow: pred.flow,
                        occupancy: pred.occupancy
                    };
                }
            }
        });
    }
    console.log('[Emergency] 预测数据映射大小:', Object.keys(predictionDataMap).length);
    console.log('[Emergency] 预测数据示例:', JSON.stringify(Object.entries(predictionDataMap).slice(0, 5)));

    if (window.ParticleModule && window.markers && window.markers.length > 0) {
        const newTrafficData = {};

        const detectorMap = {};
        if (realtimeTrafficData && realtimeTrafficData.records) {
            for (const rec of realtimeTrafficData.records) {
                const id = rec.detector_id;
                if (!detectorMap[id]) {
                    detectorMap[id] = { speeds: [], volumes: [] };
                }
                detectorMap[id].speeds.push(rec.speed);
                detectorMap[id].volumes.push(rec.volume);
            }
        }

        window.markers.forEach(marker => {
            const rowData = marker.csvRowData || marker.rowData;
            if (marker && rowData) {
                const rowId = parseInt(rowData[0]);

                if (rowId && !isNaN(rowId)) {
                    const detId = String(marker.rowData?.detector_id).trim();

                    let baseSpeed = 0;
                    let baseVolume = 0;
                    if (detectorMap[detId]) {
                        const data = detectorMap[detId];
                        baseSpeed = data.speeds.reduce((a, b) => a + b, 0) / data.speeds.length;
                        baseVolume = data.volumes.reduce((a, b) => a + b, 0);
                    }

                    let predictSpeed = 0;
                    let predictFlow = 0;
                    if (predictionDataMap[rowId] !== undefined) {
                        predictSpeed = predictionDataMap[rowId].speed - 45;
                        predictFlow = predictionDataMap[rowId].flow;
                    }

                    if (baseSpeed > 0 || predictSpeed !== undefined) {
                        newTrafficData[rowId] = {
                            speed: baseSpeed + predictSpeed,
                            volume: baseVolume > 0 ? baseVolume : predictFlow
                        };
                    }
                }
            }
        });

        console.log('[Emergency] 构建的newTrafficData大小:', Object.keys(newTrafficData).length);
        console.log('[Emergency] newTrafficData示例:', JSON.stringify(Object.entries(newTrafficData).slice(0, 5)));

        window.ParticleModule.resetTrafficData(newTrafficData);

        window.ParticleModule.rebuildRoutes();
        console.log('[Emergency] 路线已收集');

        window.ParticleModule.start();
    }

    setTimeout(() => {
        nodeIds.forEach(nodeId => {
            const marker = findMarkerByRowId(nodeId);
            if (marker && window.ParticleModule) {
                let speed = 30;
                if (predictions && predictions.length > 0 && stepIdx >= 0 && stepIdx < predictions.length) {
                    const stepData = predictions[stepIdx];
                    const pred = stepData.find(p => p.node_id === nodeId);
                    if (pred && pred.speed !== undefined) {
                        speed = pred.speed;
                    }
                }

                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        window.ParticleModule.forceEmit(marker, speed);
                    }, i * 300);
                }
            } else {
                console.warn('[Emergency] 未找到节点 marker:', nodeId);
            }
        });
    }, 800);
}

function highlightEmergencyNodes(nodeIds) {
    clearEmergencyHighlights();

    nodeIds.forEach(id => {
        const marker = findMarkerByRowId(id);
        if (marker) {
            const el = marker.getElement();
            if (el) el.classList.add('node-marker-selected');
            currentPulsingMarkers.add(marker);
        }
    });
}

function clearEmergencyHighlights() {
    currentPulsingMarkers.forEach(marker => {
        const el = marker.getElement();
        if (el) el.classList.remove('node-marker-selected');
    });
    currentPulsingMarkers.clear();
}

function findMarkerByRowId(rowId) {
    const idx = rowId - 2;
    if (idx >= 0 && idx < markers.length) {
        return markers[idx];
    }
    return markers.find(m => {
        const data = m.csvRowData;
        return data && data[0] == rowId;
    });
}

// ==================== 地图点击事件：拦截节点选择 ====================

function handleMarkerNodeSelect(marker) {
    const rowData = marker.csvRowData;
    if (!rowData) return false;
    const nodeId = rowData[0];

    if (window.isPathSelectMode) {
        window.pathSelectedNodes.push(nodeId);
        updatePathNodesDisplay();

        const undoBtn = document.getElementById('undoPathBtn');
        if (undoBtn) undoBtn.style.display = 'inline-block';

        const status = document.getElementById('pathStatus');
        if (status) status.textContent = `已选 ${window.pathSelectedNodes.length} 个节点`;

        if (window.pathSelectedNodes.length >= 2) {
            const confirmBar = document.getElementById('pathConfirmBar');
            const confirmText = document.getElementById('pathConfirmText');
            const mode = document.getElementById('pathMode').value;
            const action = mode === 'add' ? '添加连接' : '移除连接';
            if (confirmText) confirmText.textContent = `${action}: ${window.pathSelectedNodes[0]} → ${window.pathSelectedNodes[1]}`;

            const weightGroup = document.getElementById('pathConfirmWeightGroup');
            if (weightGroup) weightGroup.style.display = mode === 'add' ? 'block' : 'none';

            if (confirmBar) confirmBar.style.display = 'block';
            if (status) status.textContent = '请确认或取消操作';

            const btn = document.getElementById('startPathBtn');
            if (btn) {
                btn.textContent = '开始选择节点';
                btn.classList.remove('active');
            }
        }
        return true;
    }

    if (window.isNodeSelectMode) {
        if (!window.selectedEmergencyNodes.includes(nodeId)) {
            window.selectedEmergencyNodes.push(nodeId);
            updateEmergencyNodesDisplay();
            syncEmergencyNodesInput();
        }
        return true;
    }

    return false;
}

window.handleMarkerNodeSelect = handleMarkerNodeSelect;
window.clearEmergencyHighlights = clearEmergencyHighlights;

// ==================== 初始化突发事件表单监听 ====================
document.addEventListener('DOMContentLoaded', () => {
    const typeSelect = document.getElementById('emergencyType');
    if (typeSelect) {
        typeSelect.addEventListener('change', updateEmergencyParams);
    }

    const severitySlider = document.getElementById('emergencySeverity');
    if (severitySlider) {
        severitySlider.addEventListener('input', () => {
            const valSpan = document.getElementById('severityValue');
            if (valSpan) {
                const type = document.getElementById('emergencyType').value;
                if (type === 'traffic_surge') {
                    valSpan.textContent = parseFloat(severitySlider.value).toFixed(1);
                } else {
                    valSpan.textContent = Math.round(parseFloat(severitySlider.value) * 100);
                }
            }
        });
    }

    const stepsSlider = document.getElementById('emergencySteps');
    if (stepsSlider) {
        stepsSlider.addEventListener('input', () => {
            const valSpan = document.getElementById('stepsValue');
            if (valSpan) valSpan.textContent = stepsSlider.value;
        });
    }

    const nodesInput = document.getElementById('emergencyNodes');
    if (nodesInput) {
        nodesInput.addEventListener('input', () => {
            const ids = nodesInput.value.split(',').map(s => s.trim()).filter(Boolean);
            window.selectedEmergencyNodes = ids;
            updateEmergencyNodesDisplay();
        });
    }
});

// ==================== 全局挂载 ====================
window.clearEmergencyHighlights = clearEmergencyHighlights;