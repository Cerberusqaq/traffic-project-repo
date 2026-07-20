/**
 * dataService.js
 * 数据服务层
 * 
 * 职责：
 * 封装对本地 CSV、GeoJSON 文件的读取逻辑，为上层路由提供统一的数据访问接口。
 * 所有文件路径均基于项目根目录计算，避免相对路径混乱。
 * 
 * 当前支持：
 * - 按日期读取历史交通流量 CSV（data/monthly/YYYY-MM/fd_YYYY-MM-DD.csv）
 * - 读取基础检测器信息 CSV（data/base/hk_data_new.csv）
 * - 读取道路路网 GeoJSON（data/geojson/HK_RoadCentreline_260310.geojson）
 */

const fs = require('fs');
const path = require('path');

// 项目根目录：backend/services -> backend -> HK
const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * 根据日期字符串读取对应的历史流量 CSV 文件内容
 * @param {string} dateStr - 日期，格式 "YYYY-MM-DD"
 * @returns {string|null} - 文件文本内容；若文件不存在则返回 null
 */
function readHistoryCSV(dateStr) {
    // 从日期中提取年月，构建文件夹路径
    const [year, month] = dateStr.split('-');
    const monthFolder = `${year}-${month}`;
    const fileName = `fd_${dateStr}.csv`;
    const filePath = path.join(PROJECT_ROOT, 'data', 'monthly', monthFolder, fileName);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        return null;
    }

    // 以 UTF-8 编码读取文件内容
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        console.error(`[dataService] 读取文件失败: ${filePath}`, err.message);
        return null;
    }
}

/**
 * 读取基础检测器信息 CSV
 * @returns {string|null} - 文件文本内容
 */
function readBaseCSV() {
    const filePath = path.join(PROJECT_ROOT, 'data', 'base', 'hk_data_new.csv');
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        console.error(`[dataService] 读取基础数据失败: ${filePath}`, err.message);
        return null;
    }
}

/**
 * 读取道路路网 GeoJSON 文件内容
 * @returns {string|null} - 文件文本内容（JSON 字符串）
 */
function readGeoJSON() {
    const filePath = path.join(PROJECT_ROOT, 'data', 'geojson', 'HK_RoadCentreline_260310.geojson');
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        console.error(`[dataService] 读取 GeoJSON 失败: ${filePath}`, err.message);
        return null;
    }
}

/**
 * 检查指定日期的历史数据文件是否存在
 * @param {string} dateStr - 日期，格式 "YYYY-MM-DD"
 * @returns {boolean}
 */
function historyExists(dateStr) {
    const [year, month] = dateStr.split('-');
    const monthFolder = `${year}-${month}`;
    const fileName = `fd_${dateStr}.csv`;
    const filePath = path.join(PROJECT_ROOT, 'data', 'monthly', monthFolder, fileName);
    return fs.existsSync(filePath);
}

/**
 * 获取所有有数据的日期列表
 * 遍历 data/monthly/YYYY-MM/ 目录下的所有 CSV 文件
 * @returns {string[]} - 日期列表，格式为 YYYY-MM-DD
 */
function getAvailableDates() {
    const dates = [];
    const monthlyDir = path.join(PROJECT_ROOT, 'data', 'monthly');
    
    // 检查 monthly 目录是否存在
    if (!fs.existsSync(monthlyDir)) {
        console.warn('[dataService] monthly 目录不存在:', monthlyDir);
        return dates;
    }
    
    try {
        // 遍历所有月份文件夹
        const monthFolders = fs.readdirSync(monthlyDir);
        
        for (const monthFolder of monthFolders) {
            // 检查是否为 YYYY-MM 格式的文件夹
            if (!/^\d{4}-\d{2}$/.test(monthFolder)) {
                continue;
            }
            
            const monthPath = path.join(monthlyDir, monthFolder);
            
            // 检查是否为目录
            if (!fs.statSync(monthPath).isDirectory()) {
                continue;
            }
            
            // 遍历该月份下的所有文件
            const files = fs.readdirSync(monthPath);
            
            for (const file of files) {
                // 匹配 fd_YYYY-MM-DD.csv 格式的文件
                const match = file.match(/^fd_(\d{4}-\d{2}-\d{2})\.csv$/);
                if (match) {
                    dates.push(match[1]);
                }
            }
        }
        
        // 按日期排序
        dates.sort();
        
        console.log(`[dataService] 找到 ${dates.length} 个有数据的日期`);
        return dates;
        
    } catch (err) {
        console.error('[dataService] 获取可用日期失败:', err.message);
        return dates;
    }
}

// 导出接口供路由层使用
module.exports = {
    readHistoryCSV,
    readBaseCSV,
    readGeoJSON,
    historyExists,
    getAvailableDates
};
