/**
 * routes.js
 * 路线规划功能模块
 * 
 * 职责：
 * 1. 路线规划模式状态管理
 * 2. 路线规划请求处理（NLP解析）
 * 3. 路线绘制和匹配数据点高亮
 * 4. 路线粒子效果启动
 * 5. 时间窗口匹配和时间步范围计算
 */

// 路线规划状态
let planRouteLayer = null;
let planMatchedMarkers = [];
window.planModeActive = false;
let planMatchedData = null;

/**
 * 退出路线规划模式：清除路线、恢复数据点样式、关闭粒子
 */
function exitPlanMode() {
    console.log('[Plan] 退出规划模式');
    planTimeStepRange = null;

    if (planRouteLayer) {
        window.map.removeLayer(planRouteLayer);
        planRouteLayer = null;
    }

    planMatchedMarkers.forEach(m => {
        if (m._marker && window.map.hasLayer(m._marker)) {
            m._marker.setStyle({
                fillColor: m.originalColor,
                color: m.originalBorderColor || '#ffffff',
                weight: m.originalBorderWeight !== undefined ? m.originalBorderWeight : 2,
                radius: m.originalRadius
            });
            m._marker.off('mouseout');
            m._marker.on('mouseout', () => {
                m._marker.setStyle({ radius: m.originalRadius });
            });
        }
    });
    planMatchedMarkers = [];

    if (window.ParticleModule) {
        window.ParticleModule.setPlanMode(false, null);
    }

    const planResult = document.getElementById('planResult');
    const planStatus = document.getElementById('planStatus');
    if (planResult) { planResult.innerHTML = ''; planResult.classList.remove('show'); }
    if (planStatus) { planStatus.textContent = ''; planStatus.className = 'plan-status'; }

    window.planModeActive = false;
    planMatchedData = null;

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

        window.planModeActive = true;
        planMatchedData = data;

        planStatus.textContent = '规划成功！点击确认按钮可重新规划';
        planStatus.className = 'plan-status success';

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

    if (planRouteLayer) {
        window.map.removeLayer(planRouteLayer);
    }
    planMatchedMarkers.forEach(m => {
        if (m._marker && window.map.hasLayer(m._marker)) {
            m._marker.setStyle({
                fillColor: m.originalColor,
                color: m.originalBorderColor || '#ffffff',
                weight: m.originalBorderWeight !== undefined ? m.originalBorderWeight : 2,
                radius: m.originalRadius
            });
        }
    });
    planMatchedMarkers = [];

    if (data.route && data.route.full_polyline && data.route.full_polyline.length > 0) {
        const polylineCoords = data.route.full_polyline.map(p => [p.lat, p.lng]);

        planRouteLayer = L.polyline(polylineCoords, {
            color: '#007bff',
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 10'
        }).addTo(window.map);

        console.log('[Plan] 路线绘制完成，点数:', polylineCoords.length);

        window.map.fitBounds(planRouteLayer.getBounds(), {
            padding: [30, 30, 30, 280],
            maxZoom: 16
        });
        console.log('[Plan] 视野已调整到路线区域');
    }

    if (data.matched_detectors && data.matched_detectors.length > 0) {
        highlightMatchedDetectors(data.matched_detectors);
        startPlanParticles(data.matched_detectors, data.date, data.time);
    }
}

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

/**
 * 高亮显示匹配的数据点
 */
function highlightMatchedDetectors(matchedDetectors) {
    console.log('[Plan] 开始高亮匹配的数据点，数量:', matchedDetectors.length);

    const detectorIdSet = new Set(matchedDetectors.map(d => String(d.detector_id).trim()));

    markers.forEach((marker, idx) => {
        const markerDetId = marker.rowData?.detector_id;
        if (markerDetId && detectorIdSet.has(String(markerDetId).trim())) {
            const markerColor = '#ff5722';
            marker.setStyle({
                fillColor: markerColor,
                color: '#ffffff',
                weight: 3,
                radius: MARKER_HOVER_RADIUS
            });

            planMatchedMarkers.push({
                _marker: marker,
                originalColor: window.customMarkerColor || '#5ad2af',
                originalBorderColor: '#ffffff',
                originalBorderWeight: 2,
                originalRadius: MARKER_BASE_RADIUS
            });

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

    let hasTimeData = false;
    let targetTimeStep = 0;
    let loadedTimeWindowMap = {};
    let usePresetData = false;

    if (planDate) {
        const [year, month, day] = planDate.split('-');
        const originalYear = parseInt(year);

        if (originalYear !== 2024 && originalYear !== 2025) {
            usePresetData = true;
        }

        const targetDate = `2025-${month}-${day}`;
        const monthFolder = `2025-${month}`;
        const csvUrl = `/data/monthly/${monthFolder}/fd_${targetDate}.csv`;
        console.log('[Plan] 尝试加载日期数据 (原始:', planDate, '→ 目标:', targetDate, ')');

        try {
            const resp = await fetch(csvUrl);
            if (resp.ok) {
                const text = await resp.text();
                const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
                if (lines.length > 1) {
                    if (window.ParticleModule && window.ParticleModule.loadTrafficData) {
                        console.log('[Plan] 将日期数据传递给粒子模块');
                        const loadSuccess = window.ParticleModule.loadTrafficData(text);
                        if (!loadSuccess) {
                            console.warn('[Plan] 粒子模块加载数据失败，检测器ID可能不匹配');
                        }
                    }

                    const headers = AppModules.parseLine(lines[0]);
                    const twCol = AppModules.findCol(headers, ['time_window', 'Time_Window']);
                    const timeStepCol = AppModules.findCol(headers, ['time_step', 'Time_Step']);

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

                    if (planTime && twCol >= 0) {
                        const rawDuration = planMatchedData?.route?.duration || 0;
                        const routeDurationMin = rawDuration > 100 ? rawDuration / 60 : rawDuration;

                        const planTimeToMinute = (s) => {
                            if (!s) return null;
                            s = String(s).replace(/[:.]/g, '').trim();
                            if (s.length < 1) return null;
                            if (s.length <= 2) {
                                const hh = parseInt(s);
                                return isNaN(hh) || hh > 23 ? null : hh * 60;
                            }
                            if (s.length === 3) s = '0' + s;
                            const hh = parseInt(s.substring(0, 2));
                            const mm = parseInt(s.substring(2, 4));
                            if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) return null;
                            return hh * 60 + mm;
                        };

                        const timeWindowToMinute = (tw) => {
                            tw = String(tw).trim();
                            const spaceIdx = tw.lastIndexOf(' ');
                            let timePart;
                            if (spaceIdx >= 0) {
                                timePart = tw.substring(spaceIdx + 1);
                            } else if (tw.includes('-')) {
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

    const matchedIds = new Set(matchedDetectors.map(d => String(d.detector_id).trim()));

    const extendedDetectors = [...matchedDetectors];
    const extendedIds = new Set(matchedIds);
    const detectorMap = {};
    matchedDetectors.forEach(d => {
        detectorMap[String(d.detector_id).trim()] = d;
    });

    for (const d of matchedDetectors) {
        const connections = d.connections || [];
        for (const connId of connections) {
            const connIdStr = String(connId).trim();
            if (!extendedIds.has(connIdStr)) {
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

    const planEdges = [];
    const addedEdges = new Set();
    for (const d of extendedDetectors) {
        const detId = String(d.detector_id).trim();
        const connections = d.connections || [];
        for (const connId of connections) {
            const connIdStr = String(connId).trim();
            if (extendedIds.has(connIdStr)) {
                const edgeKey = detId + '->' + connIdStr;
                if (!addedEdges.has(edgeKey)) {
                    addedEdges.add(edgeKey);
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
    }

    console.log('[Plan] 路线关联边数:', planEdges.length);

    window.ParticleModule.setPlanMode(true, {
        matchedIds: extendedIds,
        planEdges: planEdges,
        matchedDetectors: extendedDetectors
    });

    if (planEdges.length === 0) {
        window.ParticleModule.setPlanMode(false, null);
        window.showToast('路线沿线的数据点之间暂无拓扑关联关系，无法显示粒子效果');
        return;
    }

    if (!hasTimeData && planDate) {
        window.ParticleModule.setPlanMode(false, null);
        const timeInfo = planTime ? `${planDate} ${planTime}` : planDate;
        window.showToast(`${timeInfo} 暂无交通数据，仅显示路线`);
        console.log('[Plan] 无时刻数据，不启动粒子');
        return;
    }

    if (!visualPlaybackActive) {
        toggleVisualPlayPause(true);
    }

    if (!window.ParticleModule.getParticleMode()) {
        if (hasTimeData && targetTimeStep >= 0) {
            window.ParticleModule.setCurrentTimeStep(targetTimeStep);
        }
        window.ParticleModule.start();
    } else {
        if (hasTimeData && targetTimeStep >= 0) {
            window.ParticleModule.setCurrentTimeStep(targetTimeStep);
        }
    }
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

    if (usePresetData) {
        window.showToast('暂无历史数据，已采用模型预测数据');
    }

    if (hasTimeData && targetTimeStep >= 0 && window.ParticleModule.setCurrentTimeStep) {
        window.ParticleModule.setCurrentTimeStep(targetTimeStep);
        updateBottomBar(targetTimeStep);
    }

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

window.App = window.App || {};
window.App.handlePlanRoute = handlePlanRoute;
window.App.displayPlannedRoute = displayPlannedRoute;
window.App.exitPlanMode = exitPlanMode;