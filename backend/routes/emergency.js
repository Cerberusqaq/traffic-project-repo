/**
 * routes/emergency.js
 * 突发事件模拟代理路由
 * 
 * 将 /api/emergency/* 请求转发到 Python API 服务（端口 5001）
 * 
 * 功能：
 * - POST /api/emergency/simulate - 突发事件模拟
 * 
 * 字段映射（前端 → Python API）：
 * - event_type → type
 * - predict_steps → num_steps
 * - start_time → start_datetime
 */

const express = require('express');
const router = express.Router();
const http = require('http');

const PYTHON_API_HOST = '127.0.0.1';
const PYTHON_API_PORT = parseInt(process.env.PYTHON_API_PORT || '5001', 10);

function proxyToPython(req, res) {
    const fullPath = req.originalUrl;
    const targetPath = '/api/python' + fullPath.replace(/^\/api\/emergency/, '/emergency');

    let body = req.body;
    if (body) {
        body = {
            ...body,
            type: body.event_type || body.type,
            num_steps: body.predict_steps || body.num_steps,
            start_datetime: body.start_time || body.start_datetime,
            node_ids: body.node_ids
        };
        delete body.event_type;
        delete body.predict_steps;
        delete body.start_time;
        delete body.custom_connections;
    }

    const options = {
        hostname: PYTHON_API_HOST,
        port: PYTHON_API_PORT,
        path: targetPath,
        method: req.method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        let responseBody = '';
        proxyRes.on('data', (chunk) => { responseBody += chunk; });
        proxyRes.on('end', () => {
            res.status(proxyRes.statusCode);
            res.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
            res.send(responseBody);
        });
    });

    proxyReq.on('error', (err) => {
        console.error('[Emergency Proxy] 连接失败:', err.message);
        res.status(502).json({ 
            error: 'Python API 服务不可用，请确认服务已启动',
            detail: err.message 
        });
    });

    if (body && Object.keys(body).length > 0) {
        proxyReq.write(JSON.stringify(body));
    }
    proxyReq.end();
}

/**
 * POST /api/emergency/simulate
 * 突发事件模拟接口
 * 
 * 请求体: {
 *   event_type: string,
 *   node_ids: number[],
 *   severity: number,
 *   predict_steps: number,
 *   start_time: string,
 *   current_datetime: string
 * }
 * 
 * 返回: Python API 响应
 */
router.post('/simulate', proxyToPython);

module.exports = router;