/**
 * utils.js
 * 工具函数模块
 * 
 * 职责：
 * 1. CSV 编码解码（处理 GBK/GB2312 中文编码）
 * 2. 状态提示函数
 * 3. 统一通知弹窗（红色毛玻璃样式）
 * 4. 可视化清理函数
 */

// ==================== 编码处理工具函数 ====================
/**
 * 解码CSV文本，处理GBK/GB2312编码的中文
 * @param {Blob} blob - CSV文件的Blob对象
 * @returns {Promise<string>} - 解码后的文本
 */
async function decodeCSVText(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // 检查是否有BOM
    const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const hasGbkBom = bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF;
    
    if (hasUtf8Bom) {
        return new TextDecoder('utf-8').decode(bytes.slice(3));
    }
    
    if (hasGbkBom) {
        return new TextDecoder('gbk').decode(bytes.slice(2));
    }
    
    // 尝试用UTF-8解码
    let text = new TextDecoder('utf-8').decode(bytes);
    
    // 检查是否有乱码（黑色问号菱形）
    if (text.includes('\uFFFD')) {
        // UTF-8解码失败，尝试GBK
        try {
            text = new TextDecoder('gbk').decode(bytes);
            console.log('[Utils] CSV文件使用GBK编码');
        } catch (e) {
            console.log('[Utils] CSV编码检测失败，使用UTF-8');
        }
    }
    
    return text;
}

// ==================== 实时数据爬取 ====================
/**
 * 爬取实时交通数据
 */
async function fetchRealtimeData() {
    const modal = document.getElementById('fetchingModal');
    if (modal) modal.style.display = 'flex';
    
    try {
        console.log('[Utils] 开始爬取实时数据...');
        const response = await fetch('/api/realtime/fetch');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.records && data.records.length > 0) {
            console.log(`[Utils] 爬取成功，共 ${data.records.length} 条记录`);
            enterRealtimeMode(data);
        } else {
            console.warn('[Utils] 爬取失败或无数据:', data.error || '未知错误');
        }
    } catch (e) {
        console.error('[Utils] 爬取异常:', e);
    } finally {
        if (modal) modal.style.display = 'none';
    }
}

// ==================== 状态提示函数 ====================
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
    toast.style.display = 'flex';

    const closeToast = () => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.style.display = 'none';
            toast.style.opacity = '1';
        }, 300);
    };

    const dur = duration || 3000;
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(closeToast, dur);

    toast.onclick = () => {
        clearTimeout(window._toastTimer);
        closeToast();
    };
};

// ==================== 统一可视化清理函数 ====================
/**
 * 停止所有可视化效果（粒子、热力图）并清空状态
 * 不影响基础数据和地图图层
 */
function stopAllVisualizations() {
    // 停止粒子动画
    const pm = window.ParticleModule;
    if (pm && pm.stopParticleAnimation) {
        pm.stopParticleAnimation();
    }
    if (pm && pm.clear) {
        pm.clear();
    }

    // 关闭粒子模式按钮状态
    const particleBtn = document.getElementById('particleBtn');
    if (particleBtn) {
        particleBtn.classList.remove('active');
    }

    // 停止热力图
    const hm = window.HeatmapModule;
    if (hm && hm.clearHeatmap) {
        hm.clearHeatmap();
    }

    // 关闭热力图按钮状态
    const heatBtn = document.getElementById('showHeatBtn');
    if (heatBtn) {
        heatBtn.classList.remove('active');
    }

    // 暂停可视化播放（时间步推进）
    toggleVisualPlayPause(false);

    // 重置全局暂停状态
    globalParticlePaused = true;
}

// ==================== 全局挂载 ====================
window.App = window.App || {};
window.App.stopAllVisualizations = stopAllVisualizations;
window.fetchRealtimeData = fetchRealtimeData;