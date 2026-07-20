/**
 * app.js
 * 灵动交通可视化平台 - 主应用入口
 */

window.App = window.App || {};

Object.defineProperty(window.App, 'planModeActive', {
    get: function() { return window.planModeActive || false; }
});

Object.defineProperty(window.App, 'historyModeActive', {
    get: function() { return currentActiveMode === 'history'; }
});

Object.defineProperty(window.App, 'predictModeActive', {
    get: function() { return currentActiveMode === 'predict'; }
});

window.App.predictionModeActive = false;

window.App.enterHistoryMode = enterHistoryMode;
window.App.enterPredictMode = enterPredictMode;
window.App.exitHistoryMode = exitHistoryMode;
window.App.exitPlanMode = exitPlanMode;
window.App.stopAllVisualizations = stopAllVisualizations;
window.App.updateModeLabel = updateModeLabel;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[App] 页面加载完成，开始初始化...');

    darkModeActive = true;
    document.body.classList.add('dark-mode');
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

    try { await loadBaseData(); console.log('[Init] loadBaseData 完成'); } catch(e) { console.error('[Init] loadBaseData 失败:', e); }
    try { AppModules.initGlobalFixedMenu(); console.log('[Init] initGlobalFixedMenu 完成'); } catch(e) { console.error('[Init] initGlobalFixedMenu 失败:', e); }
    try { document.getElementById('showMarkersBtn').classList.add('active'); } catch(e) { console.error('[Init] 激活数据点按钮失败:', e); }
    try { await fetchRealtimeData(); } catch(e) { console.error('[Init] 爬取实时数据失败:', e); }

    try { initTimeline(); } catch(e) { console.error('[Init] initTimeline 失败:', e); }
    try { initSidePanel(); } catch(e) { console.error('[Init] initSidePanel 失败:', e); }
    try { initColorEditMenu(); } catch(e) { console.error('[Init] initColorEditMenu 失败:', e); }
    try { initTooltips(); } catch(e) { console.error('[Init] initTooltips 失败:', e); }
    
    const planInput = document.getElementById('planInput');
    if (planInput) {
        planInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handlePlanRoute();
            }
        });
    }

    console.log('[App] 初始化完成！');
});