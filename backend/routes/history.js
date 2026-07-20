/**
 * routes/history.js
 * 历史数据查询路由
 * 
 * 提供接口：
 * GET /api/history/:date      - 获取指定日期的交通流量 CSV 原始文本
 * GET /api/history/:date/exists - 检查指定日期的数据是否存在
 * GET /api/history/base       - 获取基础检测器信息 CSV
 * 
 * 日期格式：YYYY-MM-DD
 * 数据来源：data/monthly/YYYY-MM/fd_YYYY-MM-DD.csv
 */

const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');

/**
 * GET /api/history/:date
 * 返回指定日期的历史交通流量 CSV 文本
 * 示例：/api/history/2024-01-01
 */
router.get('/:date', (req, res) => {
    const { date } = req.params;

    // 简单的日期格式校验
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: '日期格式错误，应为 YYYY-MM-DD' });
    }

    const content = dataService.readHistoryCSV(date);
    if (content === null) {
        return res.status(404).json({ error: `未找到 ${date} 的历史数据` });
    }

    // 直接返回 CSV 文本，前端负责解析
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
});

/**
 * GET /api/history/:date/exists
 * 检查指定日期的数据文件是否存在
 * 返回 JSON：{ exists: true/false }
 */
router.get('/:date/exists', (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: '日期格式错误，应为 YYYY-MM-DD' });
    }
    res.json({ exists: dataService.historyExists(date) });
});

/**
 * GET /api/history/base
 * 返回基础检测器信息 CSV（hk_data_new.csv）
 */
router.get('/base', (req, res) => {
    const content = dataService.readBaseCSV();
    if (content === null) {
        return res.status(404).json({ error: '未找到基础检测器数据' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
});

/**
 * GET /api/history/available
 * 返回所有有数据的日期列表
 * 遍历 data/monthly/YYYY-MM/ 目录下的所有 CSV 文件
 */
router.get('/available', (req, res) => {
    const dates = dataService.getAvailableDates();
    res.json({ dates });
});

module.exports = router;
