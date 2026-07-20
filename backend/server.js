/**
 * server.js
 * 灵动交通可视化平台后端入口文件
 * 
 * 职责：
 * 1. 创建 Express HTTP 服务器
 * 2. 托管前端静态资源（frontend/ 目录）
 * 3. 挂载各业务 API 路由（历史数据、预测、实时、事件、路线规划）
 * 4. 统一错误处理与日志记录
 * 
 * 启动方式：node server.js
 * 默认端口：3000
 * 访问地址：http://localhost:3000
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const http = require('http');

// 引入各业务路由模块
const historyRouter = require('./routes/history');
const predictRouter = require('./routes/predict');
const realtimeRouter = require('./routes/realtime');
const eventsRouter = require('./routes/events');
const planRouter = require('./routes/plan');
const emergencyRouter = require('./routes/emergency');
const networkRouter = require('./routes/network');

// 创建 Express 应用实例
const app = express();

// 启用跨域资源共享（CORS），允许前端页面调用本服务器 API
app.use(cors());

// 启用 gzip 压缩，大幅减小 GeoJSON 等大文件传输体积
app.use(compression());

// 解析 JSON 请求体（为后续 POST 接口预留）
app.use(express.json());

/**
 * 代理请求到 Python API 服务
 * 将 /api/realtime/fetch 请求转发到 Python 服务
 */
function proxyToPythonRealtime(req, res) {
    const PYTHON_API_HOST = '127.0.0.1';
    const PYTHON_API_PORT = parseInt(process.env.PYTHON_API_PORT || '5001', 10);
    
    const options = {
        hostname: PYTHON_API_HOST,
        port: PYTHON_API_PORT,
        path: '/api/python/realtime/fetch',
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
        console.error('[Python Proxy] 连接失败:', err.message);
        res.status(502).json({ 
            error: 'Python API 服务不可用，请确认服务已启动',
            detail: err.message 
        });
    });

    proxyReq.end();
}

// 挂载 API 路由，所有接口前缀为 /api
app.use('/api/history', historyRouter);
app.use('/api/predict', predictRouter);
app.use('/api/realtime', realtimeRouter);
app.use('/api/events', eventsRouter);
app.use('/api/plan', planRouter);
app.use('/api/emergency', emergencyRouter);
app.use('/api/network', networkRouter);

// Python API 代理路由（实时数据爬取）
app.use('/api/realtime/fetch', proxyToPythonRealtime);

// 托管数据静态资源：将 ../data 目录映射到 /data URL 路径
// 前端可通过 /data/monthly/YYYY-MM/fd_YYYY-MM-DD.csv 等方式直接读取数据文件
app.use('/data', express.static(path.join(__dirname, '..', 'data'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.csv')) {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        }
    }
}));

// 托管前端静态资源：将 ../frontend 目录作为网站根目录
// 访问 http://localhost:3000/ 即加载 frontend/index.html
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 兜底路由：若前端使用前端路由（单页应用），未匹配到的路径返回 index.html
// 目前项目以静态页面为主，此路由保证刷新页面不 404
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
    console.error('[服务器错误]', err.message);
    res.status(500).json({ error: '服务器内部错误', message: err.message });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=====================================================`);
    console.log(`  灵动交通可视化平台后端服务已启动`);
    console.log(`  访问地址: http://localhost:${PORT}`);
    console.log(`  API 前缀: /api`);
    console.log(`=====================================================`);
});
