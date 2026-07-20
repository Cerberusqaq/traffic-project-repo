/**
 * map.js
 * 地图初始化和事件绑定模块
 * 
 * 职责：
 * 1. 创建 Leaflet 地图实例，配置初始视角为香港地区
 * 2. 配置浅色/深色模式底图
 * 3. 绑定地图事件（缩放、拖拽、右键菜单）
 * 4. 禁用网页缩放（Ctrl+滚轮等）
 * 5. 深色模式切换功能
 */

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

window.map = map;

var baseOutline = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
    maxZoom: 19, opacity: 0.7
}).addTo(map);

var osmLight = L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {maxZoom: 19});
var osmDark = L.tileLayer('https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', {maxZoom: 19});

// ==================== 网页缩放禁用 ====================
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
    }
});
document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false });

// ==================== 地图事件绑定 ====================
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

map.on('zoomend', () => {
    document.getElementById('currentZoomLevel').innerHTML =
        `<span class="zoom-num">${map.getZoom()}</span><br><span class="zoom-text">缩放</span>`;
    syncParticlesScreenPos();
    if (!globalParticlePaused) {
        AppModules.updateAllLabels();
        AppModules.updateMarkerSizes();
    }
});

map.on('movestart', () => {
    if (globalParticlePaused) return;
    if (window.ParticleModule) window.ParticleModule.clear();
});

map.on('move', () => {
    syncParticlesScreenPos();
    if (!globalParticlePaused) {
        AppModules.updateAllLabels();
    }
});

map.on('moveend', () => {
    if (globalParticlePaused) return;
    if (window.ParticleModule) {
        window.ParticleModule.ensureAnimationRunning();
    }
});

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
        geoJsonLayer.eachLayer(layer => {
            layer.setStyle({ color: window.customBaseMapColor || (darkModeActive ? '#7d8282' : '#7d8282') });
        });
    }
}