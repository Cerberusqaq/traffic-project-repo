/**
 * routes/predict.js
 * 模型预测数据路由（预留）
 * 
 * 说明：
 * 目前模型预测功能（LGBM）尚未打包接入，本路由仅作为骨架预留。
 * 后续接入模型后，可在此提供预测数据查询接口。
 * 
 * 当前所有接口返回：{ message: "功能开发中" }
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/predict/:date
 * 预留：获取指定日期的模型预测流量数据
 */
router.get('/:date', (req, res) => {
    res.status(503).json({ message: '模型预测功能开发中', date: req.params.date });
});

/**
 * GET /api/predict/status
 * 预留：查询模型预测服务状态
 */
router.get('/status', (req, res) => {
    res.json({ status: 'unavailable', message: '模型预测功能开发中' });
});

module.exports = router;
