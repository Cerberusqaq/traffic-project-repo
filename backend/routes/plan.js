/**
 * routes/plan.js
 * LLM 自然语言路线规划模块
 * 
 * 功能：
 * 1. 接收用户自然语言输入（如"明天早上8点从香港大学到中环"）
 * 2. 调用 DeepSeek LLM 解析出起点、终点、日期、时间
 * 3. 调用腾讯地图进行地址解析和路线规划
 * 4. 将规划路线沿线的数据点匹配并返回
 * 
 * 依赖：
 * - dotenv: 读取环境变量
 * - csv: 解析本地数据点 CSV
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const router = express.Router();
const fs = require('fs');
const dataService = require('../services/dataService');
const https = require('https');

// ========== 坐标转换函数 (GCJ02 <-> WGS84) ==========
const PI = 3.1415926535897932384626;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
    return !(73.66 < lng < 135.05 && 3.86 < lat < 53.55);
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
}

/**
 * GCJ02 (腾讯/高德坐标) 转 WGS84 (GPS坐标)
 */
function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) {
        return [lng, lat];
    }
    const dlat = transformLat(lng - 105.0, lat - 35.0);
    const dlng = transformLng(lng - 105.0, lat - 35.0);
    const radlat = lat / 180.0 * PI;
    let magic = Math.sin(radlat);
    magic = 1 - EE * magic * magic;
    const sqrtmagic = Math.sqrt(magic);
    const dlatFinal = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
    const dlngFinal = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
    return [lng - dlngFinal, lat - dlatFinal];
}

// ========== 腾讯地图 Polyline 解压算法 ==========
/**
 * 腾讯地图驾车路线 polyline 解压
 * @param {number[]} coords - 压缩后的坐标数组
 * @returns {Array<{lat: number, lng: number}>}
 */
function decodeTencentPolyline(coords) {
    if (!coords || !Array.isArray(coords) || coords.length < 2) {
        return [];
    }
    
    const KR = 1000000.0;
    const decoded = [];
    for (let i = 0; i < coords.length; i++) {
        if (i < 2) {
            decoded.push(coords[i]);
        } else {
            decoded.push(decoded[i - 2] + coords[i] / KR);
        }
    }
    
    const points = [];
    for (let i = 0; i < decoded.length; i += 2) {
        const lat = decoded[i];
        const lng = decoded[i + 1];
        points.push({ lat, lng });
    }
    
    return points;
}

// ========== 加载本地数据点 ==========
let DATA_POINTS = [];

function loadDataPoints() {
    const csvPath = path.join(__dirname, '..', '..', 'data', 'base', 'hk_data_new.csv');
    console.log('[Plan] 加载数据点文件:', csvPath);
    
    const encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb2312', 'latin-1'];
    
    for (const enc of encodings) {
        try {
            const content = fs.readFileSync(csvPath, enc);
            const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim());
            
            if (lines.length === 0) continue;
            
            const headers = lines[0].split(',').map(h => h.trim().replace(/^\ufeff/, ''));
            
            const latCol = headers.findIndex(h => /latitude|lat|lat$/i.test(h));
            const lngCol = headers.findIndex(h => /longitude|lng|lon$/i.test(h));
            const detIdCol = headers.findIndex(h => /detector_id/i.test(h));
            
            if (latCol === -1 || lngCol === -1) {
                console.warn('[Plan] 未找到经纬度列');
                continue;
            }
            
            DATA_POINTS = [];
            for (let i = 1; i < lines.length; i++) {
                const cells = lines[i].split(',').map(c => c.trim());
                const detId = cells[detIdCol] || '';
                if (!detId) continue;
                
                DATA_POINTS.push({
                    detector_id: detId,
                    lat: parseFloat(cells[latCol]) || 0,
                    lng: parseFloat(cells[lngCol]) || 0,
                    connections: headers
                        .map((h, idx) => ({ h, idx }))
                        .filter(({ h }) => /^connection\d+$/i.test(h))
                        .map(({ idx }) => cells[idx] || '')
                        .filter(v => v),
                    road_en: cells[headers.findIndex(h => /^road_en$/i.test(h))] || '',
                    road_sc: cells[headers.findIndex(h => /^road_sc$/i.test(h))] || '',
                });
            }
            
            console.log(`[Plan] 使用编码 ${enc} 成功加载 ${DATA_POINTS.length} 个数据点`);
            return true;
        } catch (e) {
            console.log(`[Plan] 编码 ${enc} 失败:`, e.message);
        }
    }
    
    console.error('[Plan] 所有编码尝试均失败');
    return false;
}

// 启动时加载数据点
loadDataPoints();

// ========== 工具函数 ==========

/**
 * 从文本中提取 JSON 对象
 */
function extractJsonFromText(text) {
    try {
        let jsonStr = text;
        if (text.includes('```json')) {
            jsonStr = text.split('```json')[1].split('```')[0];
        } else if (text.includes('```')) {
            jsonStr = text.split('```')[1].split('```')[0];
        }
        const start = jsonStr.indexOf('{');
        const end = jsonStr.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(jsonStr.slice(start, end + 1));
        }
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('[Plan] JSON 解析失败:', e.message);
        return null;
    }
}

/**
 * 计算两点间的 Haversine 距离（米）
 */
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dphi = (lat2 - lat1) * Math.PI / 180;
    const dlambda = (lng2 - lng1) * Math.PI / 180;
    
    const a = Math.sin(dphi / 2) ** 2 +
              Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 路线坐标点插值加密
 * 对相邻点间距 > interval(米) 的线段，按 interval 间隔插入中间点
 */
function interpolateRoute(points, interval = 20) {
    if (!points || points.length < 2) return points || [];
    
    const result = [points[0]];
    
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const dist = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
        
        if (dist > interval) {
            const steps = Math.ceil(dist / interval);
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                result.push({
                    lat: prev.lat + (curr.lat - prev.lat) * t,
                    lng: prev.lng + (curr.lng - prev.lng) * t,
                });
            }
        }
        result.push(curr);
    }
    
    return result;
}

/**
 * 将路线上的数据点匹配到最近的路线点
 * @param {Array<{lat: number, lng: number}>} routePoints - 路线点
 * @param {number} threshold - 匹配阈值（米）
 * @returns {Array}
 */
function matchDetectorsToRoute(routePoints, threshold = 50) {
    if (!routePoints || routePoints.length === 0 || DATA_POINTS.length === 0) {
        return [];
    }
    
    // 先用 50m 匹配，如果匹配太少则逐步放宽到 150m
    let matched = [];
    const tryThresholds = [50, 100, 150];
    for (const t of tryThresholds) {
        matched = matchDetectorsToRouteInner(routePoints, t);
        if (matched.length > 0) {
            console.log(`[Plan] 阈值${t}米匹配到${matched.length}个数据点`);
            break;
        }
    }
    if (matched.length === 0) {
        console.log('[Plan] 所有阈值均未匹配到数据点，路线可能不经过检测路段');
    }
    return matched;
}

function matchDetectorsToRouteInner(routePoints, threshold) {
    const matched = [];
    
    for (const dp of DATA_POINTS) {
        let minDist = Infinity;
        let closestIdx = 0;
        
        for (let i = 0; i < routePoints.length; i++) {
            const rp = routePoints[i];
            const dist = haversine(dp.lat, dp.lng, rp.lat, rp.lng);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }
        
        if (minDist < threshold) {
            matched.push({
                ...dp,
                minDist: Math.round(minDist),
                closestIdx,
            });
        }
    }
    
    matched.sort((a, b) => a.closestIdx - b.closestIdx);
    console.log(`[Plan] 匹配到 ${matched.length} 个数据点（阈值${threshold}米）`);
    return matched;
}

/**
 * 解析历史流量 CSV 文本为对象数组
 * CSV 列：detector_id, time_window, time_step, total_volume, avg_speed
 */
function parseHistoryCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^\ufeff/, ''));
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length < headers.length) continue;
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx].trim(); });
        results.push({
            detector_id: row.detector_id,
            time_window: row.time_window || '',
            time_step: parseInt(row.time_step) || 0,
            total_volume: parseFloat(row.total_volume) || 0,
            avg_speed: parseFloat(row.avg_speed) || 0
        });
    }
    return results;
}

/**
 * 将时间字符串 (HH:MM) 转为 time_step（每半小时一步，0~47）
 */
function timeToStep(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length < 2) return 0;
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    // 每半小时一个 step：0:00→0, 0:30→1, 1:00→2, ...
    return hours * 2 + (minutes >= 30 ? 1 : 0);
}

// ========== DeepSeek API 调用 ==========

/**
 * 调用 DeepSeek API
 * DeepSeek 兼容 OpenAI 格式，调用简单
 * @param {string} userMessage - 用户消息
 * @returns {Promise<string>} - 返回完整的助手回复
 */
function callDeepSeekApi(userMessage) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        
        if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
            reject(new Error('未配置 DeepSeek API 密钥，请在 .env 文件中设置 DEEPSEEK_API_KEY'));
            return;
        }
        
        const systemPrompt = `你是一个香港交通路线规划助手。请从用户的输入中提取起点、终点、日期和时间，并严格以JSON格式返回，不要包含任何其他文字。

JSON格式要求：
{
    "origin": "起点名称（中文）",
    "destination": "终点名称（中文）",
    "date": "YYYY-MM-DD格式的日期，如果用户没有指定日期则为空字符串",
    "time": "HH:MM格式的时间，如果用户没有指定时间则为空字符串"
}

示例：
用户输入："明天早上8点从旺角到中环"
输出：{"origin":"旺角","destination":"中环","date":"2024-01-15","time":"08:00"}

用户输入："从香港大学到铜锣湾"
输出：{"origin":"香港大学","destination":"铜锣湾","date":"","time":""}`;
        
        const payload = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            stream: false
        };
        
        const options = {
            hostname: 'api.deepseek.com',
            path: '/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        };
        
        console.log('[Plan] 正在调用 DeepSeek API...');
        
        const req = https.request(options, (res) => {
            let fullAnswer = '';
            
            res.on('data', (chunk) => {
                fullAnswer += chunk.toString();
            });
            
            res.on('end', () => {
                try {
                    const data = JSON.parse(fullAnswer);
                    if (data.choices && data.choices.length > 0) {
                        const reply = data.choices[0].message?.content || '';
                        console.log('[Plan] DeepSeek API 响应成功，长度:', reply.length);
                        resolve(reply);
                    } else {
                        reject(new Error('未收到助手回复'));
                    }
                } catch (e) {
                    console.error('[Plan] DeepSeek API 响应解析失败:', e.message);
                    reject(new Error('API 响应解析失败'));
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('[Plan] DeepSeek API 请求失败:', e.message);
            reject(e);
        });
        
        req.setTimeout(90000, () => {
            req.destroy();
            reject(new Error('DeepSeek API 请求超时'));
        });
        
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// ========== 腾讯地图 API ==========

/**
 * 腾讯地图地址解析
 */
function geocode(address) {
    return new Promise((resolve, reject) => {
        const ak = process.env.TENCENT_MAP_AK;
        
        if (!ak || ak === 'your_tencent_map_ak_here') {
            reject(new Error('未配置腾讯地图 API 密钥，请在 .env 文件中设置 TENCENT_MAP_AK'));
            return;
        }
        
        // 确保地址包含"香港"
        const fullAddress = address.includes('香港') ? address : '香港' + address;
        const encodedAddress = encodeURIComponent(fullAddress);
        const url = `https://apis.map.qq.com/ws/geocoder/v1/?address=${encodedAddress}&key=${ak}`;
        
        console.log('[Plan] 正在解析地址:', fullAddress);
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.status === 0) {
                        const loc = result.result.location;
                        console.log(`[Plan] 地址解析成功: ${fullAddress} -> (${loc.lng}, ${loc.lat})`);
                        resolve({ lat: loc.lat, lng: loc.lng });
                    } else {
                        console.error('[Plan] 地址解析失败:', result.message);
                        resolve(null);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

/**
 * 腾讯地图路线规划
 */
function getDrivingRoute(from, to) {
    return new Promise((resolve, reject) => {
        const ak = process.env.TENCENT_MAP_AK;
        
        if (!ak || ak === 'your_tencent_map_ak_here') {
            reject(new Error('未配置腾讯地图 API 密钥'));
            return;
        }
        
        const url = `https://apis.map.qq.com/ws/direction/v1/driving/?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}&key=${ak}&output=json`;
        const safeUrl = url.replace(ak, '***');
        console.log('[Plan] 路线规划请求:', safeUrl);
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.status === 0 && result.result && result.result.routes && result.result.routes.length > 0) {
                        console.log('[Plan] 路线规划成功');
                        resolve(result.result);
                    } else {
                        console.error('[Plan] 路线规划失败:', result.message);
                        resolve(null);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// ========== API 路由 ==========

/**
 * POST /api/plan/nlp
 * 自然语言路线规划接口
 * 
 * 请求体: { user_text: string }
 * 
 * 返回: {
 *   success: boolean,
 *   date?: string,
 *   time?: string,
 *   origin_text?: string,
 *   dest_text?: string,
 *   route?: { full_polyline, distance, duration, steps },
 *   matched_detectors: array,
 *   error?: string
 * }
 */
router.post('/nlp', async (req, res) => {
    console.log('[Plan] 收到路线规划请求:', req.body);
    
    try {
        const { user_text } = req.body;
        
        if (!user_text || typeof user_text !== 'string') {
            return res.status(400).json({
                success: false,
                error: '请提供有效的文本输入'
            });
        }
        
        // 1. 调用 LLM 解析
        let parsed;
        try {
            const rawContent = await callDeepSeekApi(user_text);
            console.log('[Plan] LLM 原始回复:', rawContent.slice(0, 500));
            parsed = extractJsonFromText(rawContent);
        } catch (e) {
            console.error('[Plan] LLM 调用失败:', e.message);
            return res.status(500).json({
                success: false,
                error: `LLM 调用失败: ${e.message}。请检查 .env 文件中的 COZE_BOT_ID 和 COZE_ACCESS_TOKEN 配置。`
            });
        }
        
        if (!parsed || parsed.error) {
            return res.status(400).json({
                success: false,
                error: parsed?.error || 'LLM 无法解析您的输入'
            });
        }
        
        const originText = parsed.origin;
        const destText = parsed.destination;
        const date = parsed.date;
        const timeVal = parsed.time;
        
        if (!originText || !destText) {
            return res.status(400).json({
                success: false,
                error: '未提取到有效的起点和终点'
            });
        }
        
        // 判断日期是过去还是未来
        let isPastDate = false;
        let dateCheckInfo = '';
        if (date) {
            const now = new Date();
            const reqDate = new Date(date + (timeVal ? 'T' + timeVal : 'T00:00:00'));
            if (isNaN(reqDate.getTime())) {
                dateCheckInfo = '日期格式无法识别';
            } else if (reqDate <= now) {
                isPastDate = true;
                dateCheckInfo = '历史日期';
            } else {
                dateCheckInfo = '未来日期';
            }
        } else {
            // 没有日期，默认当作实时
            dateCheckInfo = '未指定日期，视为当前';
        }
        console.log('[Plan] 日期判断:', date, timeVal, '→', dateCheckInfo);
        
        if (!originText || !destText) {
            return res.status(400).json({
                success: false,
                error: '未提取到有效的起点和终点。请确保输入包含出发地和目的地，例如"从XX到XX"'
            });
        }
        
        // 2. 腾讯地图地址解析
        let originCoords, destCoords;
        try {
            [originCoords, destCoords] = await Promise.all([
                geocode(originText),
                geocode(destText)
            ]);
        } catch (e) {
            console.error('[Plan] 地址解析失败:', e.message);
            return res.status(500).json({
                success: false,
                error: `地址解析失败: ${e.message}。请检查 .env 文件中的 TENCENT_MAP_AK 配置。`
            });
        }
        
        if (!originCoords || !destCoords) {
            return res.status(400).json({
                success: false,
                error: '地址解析失败，请检查地名是否正确'
            });
        }
        
        // 3. 路线规划
        let routeResult;
        try {
            routeResult = await getDrivingRoute(originCoords, destCoords);
        } catch (e) {
            console.error('[Plan] 路线规划失败:', e.message);
            return res.status(500).json({
                success: false,
                error: `路线规划失败: ${e.message}`
            });
        }
        
        if (!routeResult) {
            return res.status(400).json({
                success: false,
                error: '路线规划失败，请稍后重试'
            });
        }
        
        // 4. 解析路线 polyline (GCJ02 -> WGS84)
        const route = routeResult.routes[0];
        const rawPolyline = route.polyline || [];
        const routePointsGcj02 = decodeTencentPolyline(rawPolyline);
        
        // 转换为 WGS84
        const routePointsWgs84 = routePointsGcj02.map(pt => {
            const [lng, lat] = gcj02ToWgs84(pt.lng, pt.lat);
            return { lat, lng };
        });
        
        console.log('[Plan] 解压路线点数量:', routePointsWgs84.length);
        
        // 插值加密：相邻点间距 > 20m 时，按 20m 间隔插入中间点
        const interpolated = interpolateRoute(routePointsWgs84, 20);
        console.log('[Plan] 插值后路线点数量:', interpolated.length);
        
        // 5. 匹配数据点
        const matched = matchDetectorsToRoute(interpolated);
        
        // 6. 查询历史/预测数据
        let trafficData = null;
        let predictionAvailable = false;
        let dataMessage = '';
        
        if (isPastDate && date) {
            // 历史日期：查找对应日期的数据
            const historyContent = dataService.readHistoryCSV(date);
            if (historyContent) {
                trafficData = parseHistoryCSV(historyContent);
                console.log('[Plan] 找到历史数据:', date, '记录数:', trafficData.length);
                
                // 将交通数据关联到匹配的检测器
                const trafficMap = new Map();
                trafficData.forEach(row => {
                    const key = row.detector_id + '_' + row.time_step;
                    trafficMap.set(key, row);
                });
                
                matched.forEach(det => {
                    const timeStep = timeVal ? timeToStep(timeVal) : 0;
                    const key = det.detector_id + '_' + timeStep;
                    const traffic = trafficMap.get(key);
                    if (traffic) {
                        det.total_volume = traffic.total_volume;
                        det.avg_speed = traffic.avg_speed;
                        det.time_window = traffic.time_window;
                    }
                });
                
                dataMessage = `已加载 ${date} 的历史交通数据`;
                predictionAvailable = true;
            } else {
                dataMessage = `未找到 ${date} 的历史数据`;
            }
        } else if (date && !isPastDate) {
            // 未来日期：预测数据尚未就绪
            dataMessage = '预测数据功能开发中，当前仅显示路线规划';
        } else {
            dataMessage = '未指定日期，仅显示路线规划';
        }
        
        // 7. 返回结果
        return res.json({
            success: true,
            date: date || null,
            time: timeVal || null,
            is_past_date: isPastDate,
            origin_text: originText,
            dest_text: destText,
            origin_coords: originCoords,
            dest_coords: destCoords,
            route: {
                full_polyline: routePointsWgs84,
                distance: route.distance,
                duration: route.duration, // 腾讯地图返回的是分钟
                steps: route.steps
            },
            matched_detectors: matched,
            prediction_available: predictionAvailable,
            data_message: dataMessage
        });
        
    } catch (error) {
        console.error('[Plan] 路线规划异常:', error);
        return res.status(500).json({
            success: false,
            error: `服务器错误: ${error.message}`
        });
    }
});

/**
 * GET /api/plan/health
 * 健康检查接口
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        points_count: DATA_POINTS.length,
        coze_configured: process.env.COZE_BOT_ID && process.env.COZE_BOT_ID !== 'your_coze_bot_id_here',
        tencent_configured: process.env.TENCENT_MAP_AK && process.env.TENCENT_MAP_AK !== 'your_tencent_map_ak_here'
    });
});

module.exports = router;
