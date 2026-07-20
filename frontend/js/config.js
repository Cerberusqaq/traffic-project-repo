/**
 * config.js
 * 全局配置常量和状态变量
 * 
 * 职责：
 * 1. 定义 Marker 渲染相关的配置常量
 * 2. 定义全局状态变量（深色模式、实时模式、地图图层等）
 * 3. 初始化核心全局对象，供其他模块访问
 */

// ==================== 全局配置常量 ====================
/** Marker 基础半径（像素） */
var MARKER_BASE_RADIUS = 3.5;
/** Marker 最小半径（缩放级别较低时使用） */
var MARKER_MIN_RADIUS = 3.5;
/** Marker 最大半径（缩放级别较高时使用） */
var MARKER_MAX_RADIUS = 4;
/** Marker hover 时的半径 */
var MARKER_HOVER_RADIUS = 5;

// ==================== 全局状态变量 ====================
/** 深色模式是否激活 */
var darkModeActive = true;
/** 实时模式是否激活 */
var realtimeModeActive = false;
/** 实时数据缓存 */
var realtimeTrafficData = null;
/** 预测模式是否激活 */
var predictionModeActive = false;
/** 当前时间（实时模式为爬取时间，历史模式为选择的日期时间） */
var currentDateTime = null;
/** GeoJSON 道路图层实例 */
var geoJsonLayer = null;
/** Marker 点集合图层 */
var pointLayer = null;
/** 所有 CircleMarker 实例数组 */
var markers = [];
/** 行号 -> Marker 映射 */
var rowToMarkerMap = {};
/** 当前加载的 CSV 数据二维数组 */
var csvData = [];
/** 箭头连接线图层 */
var arrowLayer = null;
/** 是否显示所有箭头 */
var showAllArrows = true;
/** 当前高亮的 Marker */
var currentHighlightedMarker = null;
/** 当前脉冲动画的 Marker 集合 */
var currentPulsingMarkers = new Set();
/** Connection1~5 的列索引数组 */
var globalConnCols = [];
/** 数据点是否可见 */
var markersVisible = true;

/** 可视化播放是否激活 */
var visualPlaybackActive = true;
/** 粒子动画是否暂停 */
var globalParticlePaused = false;
/** 累计暂停时长（毫秒），用于粒子运动时间补偿 */
var particlePauseTime = 0;
/** 本次暂停开始的时间戳 */
var lastPauseTimestamp = 0;
/** 路线规划模式时间步范围：{ startStep, endStep } 或 null */
var planTimeStepRange = null;

/** 当前激活的功能模式：null | 'history' */
var currentActiveMode = null;
/** 当前预测事件类型（用于显示） */
var currentPredictionEvent = null;