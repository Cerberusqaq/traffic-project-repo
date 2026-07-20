/**
 * routes/events.js
 * 突发事件模拟路由（预留）
 * 
 * 说明：
 * 突发事件模拟功能（ASTGNN）目前搁置。原计划从此路由接收前端传入的事件参数，
 * 调用 ASTGNN 模型进行模拟，并返回模拟后的预测流量 CSV。
 * 
 * 当前所有接口返回：{ message: "功能开发中" }
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/events/simulate
 * 预留：提交突发事件参数，获取模拟后的流量数据
 */
router.post('/simulate', (req, res) => {
    res.status(503).json({ message: '突发事件模拟功能开发中' });
});

/**
 * GET /api/events/status
 * 预留：查询 ASTGNN 模型服务状态
 */
router.get('/status', (req, res) => {
    res.json({ status: 'unavailable', message: '突发事件模拟功能开发中' });
});

module.exports = router;
