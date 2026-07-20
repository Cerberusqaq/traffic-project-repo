/**
 * routes/network.js
 * 路网操作代理路由
 * 
 * 将 /api/network/* 请求转发到 Python API 服务（端口 5001）
 * 
 * 功能：
 * - GET /api/network/stats - 获取路网统计信息
 * - POST /api/network/connection - 添加节点连接
 * - POST /api/network/check - 检查节点连接
 * - POST /api/network/remove - 移除节点连接
 * - POST /api/network/reset - 重置路网
 */

const express = require('express');
const router = express.Router();
const http = require('http');

const PYTHON_API_HOST = '127.0.0.1';
const PYTHON_API_PORT = parseInt(process.env.PYTHON_API_PORT || '5001', 10);

function proxyToPython(req, res) {
    const fullPath = req.originalUrl;
    const targetPath = '/api/python' + fullPath.replace(/^\/api\/network/, '/network');

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
        console.error('[Network Proxy] 连接失败:', err.message);
        res.status(502).json({ 
            error: 'Python API 服务不可用，请确认服务已启动',
            detail: err.message 
        });
    });

    if (req.body && Object.keys(req.body).length > 0) {
        proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
}

/**
 * GET /api/network/stats
 * 获取路网统计信息
 */
router.get('/stats', proxyToPython);

/**
 * POST /api/network/connection
 * 添加节点连接
 * 
 * 请求体: { node1: number, node2: number, weight: number }
 */
router.post('/connection', proxyToPython);

/**
 * POST /api/network/check
 * 检查节点连接
 * 
 * 请求体: { node1: number, node2: number }
 */
router.post('/check', proxyToPython);

/**
 * POST /api/network/remove
 * 移除节点连接
 * 
 * 请求体: { node1: number, node2: number }
 */
router.post('/remove', proxyToPython);

/**
 * POST /api/network/reset
 * 重置路网
 */
router.post('/reset', proxyToPython);

module.exports = router;