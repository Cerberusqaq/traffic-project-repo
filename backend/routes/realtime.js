/**
 * routes/realtime.js
 * 实时数据路由（预留）
 * 
 * 说明：
 * 实时数据功能目前搁置。原计划从此路由提供从外部网站爬取的实时交通数据。
 * 后续接入爬虫后，可在此提供 WebSocket 或轮询接口。
 * 
 * 当前所有接口返回：{ message: "功能开发中" }
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/realtime/current
 * 预留：获取当前实时交通流量快照
 */
router.get('/current', (req, res) => {
    res.status(503).json({ message: '实时数据功能开发中' });
});

/**
 * GET /api/realtime/status
 * 预留：查询实时数据服务状态
 */
router.get('/status', (req, res) => {
    res.json({ status: 'unavailable', message: '实时数据功能开发中' });
});

module.exports = router;
