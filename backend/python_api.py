"""
python_api.py - ASTGNN 模型 API 服务
运行在 5001 端口，提供突发事件模拟和路网操作 API
由 Node.js 后端通过代理转发请求访问
"""

import os
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
from lxml import etree
from datetime import datetime
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), 'data')

app = Flask(__name__)
CORS(app)

# ==================== 可选依赖：torch ====================
TORCH_AVAILABLE = False
try:
    import torch
    TORCH_AVAILABLE = True
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    print("[INFO] PyTorch loaded, device:", DEVICE)
except ImportError:
    print("[WARNING] PyTorch not installed — prediction APIs will return errors")
    DEVICE = "cpu"

NUM_NODES = 1007

# ==================== 模型定义与加载（需要 torch） ====================
model = None
adj_matrix = None

if TORCH_AVAILABLE:
    class AdaptiveGraphConv(torch.nn.Module):
        def __init__(self, in_features, out_features):
            super(AdaptiveGraphConv, self).__init__()
            self.W = torch.nn.Linear(in_features, out_features)
            self.alpha = torch.nn.Parameter(torch.tensor(0.5))

        def forward(self, X, A):
            X_transformed = self.W(X)
            output = self.alpha * torch.matmul(A, X_transformed) + (1 - self.alpha) * X_transformed
            return output

    class ASTGNN(torch.nn.Module):
        def __init__(self, num_nodes, in_features=3, hidden_features=32, out_features=3):
            super(ASTGNN, self).__init__()
            self.gcn1 = AdaptiveGraphConv(in_features, hidden_features)
            self.gru = torch.nn.GRU(hidden_features, hidden_features, batch_first=True)
            self.fc = torch.nn.Linear(hidden_features, out_features)

        def forward(self, X, A):
            batch_size, num_nodes, _ = X.shape
            X = self.gcn1(X, A)
            X = X.permute(1, 0, 2)
            X, _ = self.gru(X)
            X = X.permute(1, 0, 2)
            output = self.fc(X)
            return output

    model = ASTGNN(num_nodes=NUM_NODES)
    model_path = os.path.join(BASE_DIR, "astgnn.pth")

    try:
        if os.path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=DEVICE, weights_only=False)
            if 'model' in checkpoint:
                model.load_state_dict(checkpoint['model'])
            elif 'state_dict' in checkpoint:
                model.load_state_dict(checkpoint['state_dict'])
            else:
                model.load_state_dict(checkpoint)
            model.to(DEVICE)
            model.eval()
            print("[OK] Loaded model:", model_path)
        else:
            print("[WARNING] Model file not found, using random weights")
            model.to(DEVICE)
            model.eval()
    except Exception as e:
        print("[ERROR] Failed to load model:", e)
        model.to(DEVICE)
        model.eval()

    adj_matrix_path = os.path.join(BASE_DIR, "adj_matrix.npy")
    if os.path.exists(adj_matrix_path):
        adj_matrix = torch.tensor(np.load(adj_matrix_path)).float().to(DEVICE)
    else:
        adj_matrix = torch.eye(NUM_NODES).float().to(DEVICE)
        print("[WARNING] Using identity matrix as adjacency")

# ==================== 加载有效检测器 ID 集合 ====================
VALID_DETECTOR_IDS = set()
_detector_csv_path = os.path.join(DATA_DIR, "base", "hk_data_new.csv")
if os.path.exists(_detector_csv_path):
    try:
        import pandas as pd
        _df = pd.read_csv(_detector_csv_path, encoding='latin-1')
        if 'detector_id' in _df.columns:
            VALID_DETECTOR_IDS = set(int(v) for v in _df['detector_id'].dropna().unique())
            print(f"[OK] Loaded {len(VALID_DETECTOR_IDS)} valid detector IDs")
    except Exception as e:
        print(f"[WARNING] Failed to load detector IDs: {e}")
        # Fallback: generate range-based IDs
        VALID_DETECTOR_IDS = set(range(2, 1007))

# ==================== 加载节点特征数据 ====================
NODE_FEATURES = None
_node_features_path = os.path.join(BASE_DIR, "node_features.csv")
if os.path.exists(_node_features_path):
    try:
        import pandas as pd
        _nf_df = pd.read_csv(_node_features_path)
        NODE_FEATURES = {}
        for _, row in _nf_df.iterrows():
            NODE_FEATURES[int(row['node_id'])] = {
                'latitude': row['Latitude'],
                'longitude': row['Longitude'],
                'district': row['District'],
                'direction': row['Direction'],
                'lane_num': row['Lane_Num']
            }
        print(f"[OK] Loaded {len(NODE_FEATURES)} node features")
    except Exception as e:
        print(f"[WARNING] Failed to load node features: {e}")
        NODE_FEATURES = None

# ==================== 加载边列表数据 ====================
EDGE_LIST = []
_edge_list_path = os.path.join(BASE_DIR, "edge_list.csv")
if os.path.exists(_edge_list_path):
    try:
        import pandas as pd
        _el_df = pd.read_csv(_edge_list_path)
        for _, row in _el_df.iterrows():
            EDGE_LIST.append({
                'from': int(row['from_node']),
                'to': int(row['to_node']),
                'distance': row['distance_km']
            })
        print(f"[OK] Loaded {len(EDGE_LIST)} edges")
    except Exception as e:
        print(f"[WARNING] Failed to load edge list: {e}")
        EDGE_LIST = []

# ==================== 构建路网图结构（用于虚拟节点填充） ====================
ROAD_GRAPH = defaultdict(list)
DISTANCE_MAP = {}
ALL_NODES = set()

for edge in EDGE_LIST:
    f = edge['from']
    t = edge['to']
    d = edge['distance']
    ROAD_GRAPH[f].append(t)
    ROAD_GRAPH[t].append(f)
    DISTANCE_MAP[(f, t)] = d
    DISTANCE_MAP[(t, f)] = d
    ALL_NODES.add(f)
    ALL_NODES.add(t)

print(f"[OK] Built road graph with {len(ALL_NODES)} nodes")

# ==================== 加载 ID 映射表 ====================
ID_MAP = {}  # AID -> Number
NUMBER_MAP = {}  # Number -> AID
ID_TO_NUMBER_PATH = os.path.join(BASE_DIR, "ID_to_Number.csv")
if os.path.exists(ID_TO_NUMBER_PATH):
    try:
        import pandas as pd
        _id_df = pd.read_csv(ID_TO_NUMBER_PATH)
        for _, row in _id_df.iterrows():
            ID_MAP[str(row['ID']).strip()] = int(row['Number'])
            NUMBER_MAP[int(row['Number'])] = str(row['ID']).strip()
        print(f"[OK] Loaded {len(ID_MAP)} ID mappings")
    except Exception as e:
        print(f"[WARNING] Failed to load ID mapping: {e}")
        ID_MAP = {}
        NUMBER_MAP = {}

REAL_NODES = set(NUMBER_MAP.keys())
VIRTUAL_NODES = sorted([n for n in ALL_NODES if n not in REAL_NODES])
print(f"[OK] Real nodes: {len(REAL_NODES)}, Virtual nodes: {len(VIRTUAL_NODES)}")


def find_nearest_real_nodes(start_node, real_nodes, graph, distance):
    """查找距离虚拟节点最近的两个真实节点"""
    if start_node in real_nodes:
        return start_node, start_node, 0.0, 0.0
    
    visited = set()
    queue = [(start_node, 0.0)]
    found = []
    
    while queue and len(found) < 2:
        node, dist = queue.pop(0)
        if node in visited:
            continue
        visited.add(node)
        
        if node in real_nodes:
            found.append((node, dist))
            continue
        
        for neighbor in graph[node]:
            if neighbor not in visited:
                new_dist = dist + distance.get((node, neighbor), 1.0)
                queue.append((neighbor, new_dist))
    
    if len(found) == 2:
        return found[0][0], found[1][0], found[0][1], found[1][1]
    elif len(found) == 1:
        return found[0][0], found[0][0], found[0][1], found[0][1]
    else:
        return None, None, None, None


def interpolate_value(real1_val, real2_val, dist1, dist2):
    """根据距离加权插值计算虚拟节点的值"""
    if np.isnan(real1_val) and np.isnan(real2_val):
        return np.nan
    if np.isnan(real1_val):
        return real2_val
    if np.isnan(real2_val):
        return real1_val
    if dist1 <= 0:
        return real1_val
    if dist2 <= 0:
        return real2_val
    
    w1 = 1.0 / dist1
    w2 = 1.0 / dist2
    return (real1_val * w1 + real2_val * w2) / (w1 + w2)


def fill_all_missing_nodes(input_data):
    """
    填充所有缺失节点的数据（包括真实节点和虚拟节点）
    :param input_data: dict, {detector_id: {speed, volume}}
    :return: dict, 包含所有1005个节点的完整数据
    """
    # 创建已填充数据的集合（所有有数据的节点）
    filled_nodes = set(input_data.keys())
    
    # 创建所有需要处理的节点集合（真实节点 + 虚拟节点）
    all_required_nodes = ALL_NODES
    
    # 记录缺失的真实节点
    missing_real_nodes = REAL_NODES - filled_nodes
    if missing_real_nodes:
        print(f"[WARNING] {len(missing_real_nodes)} 个真实节点没有数据，需要填充")
    
    # 开始迭代填充，直到所有节点都有数据或无法继续填充
    current_data = input_data.copy()
    iteration = 0
    max_iterations = 10  # 最大迭代次数
    
    while iteration < max_iterations:
        filled_in_this_iteration = 0
        available_nodes = set(current_data.keys())
        
        # 遍历所有需要填充的节点
        for node in all_required_nodes:
            if node in available_nodes:
                continue  # 已经有数据了
            
            # 找到最近的两个有数据的节点
            n1, n2, d1, d2 = find_nearest_real_nodes(node, available_nodes, ROAD_GRAPH, DISTANCE_MAP)
            if n1 is None:
                continue
            
            # 获取相邻节点的数据
            data1 = current_data.get(n1, {'speed': np.nan, 'volume': np.nan})
            data2 = current_data.get(n2, {'speed': np.nan, 'volume': np.nan})
            
            # 插值计算
            speed = interpolate_value(data1['speed'], data2['speed'], d1, d2)
            volume = interpolate_value(data1['volume'], data2['volume'], d1, d2)
            
            if not np.isnan(speed) and not np.isnan(volume):
                current_data[node] = {
                    'speed': float(speed),
                    'volume': int(round(volume))
                }
                filled_in_this_iteration += 1
        
        if filled_in_this_iteration == 0:
            break  # 没有新节点被填充，停止迭代
        
        print(f"[INFO] 迭代 {iteration + 1}: 填充了 {filled_in_this_iteration} 个节点")
        iteration += 1
    
    # 检查是否还有未填充的节点
    still_missing = all_required_nodes - set(current_data.keys())
    if still_missing:
        print(f"[WARNING] 仍有 {len(still_missing)} 个节点无法填充，使用默认值")
        # 使用全局平均值作为默认值
        speeds = [d['speed'] for d in current_data.values()]
        volumes = [d['volume'] for d in current_data.values()]
        avg_speed = sum(speeds) / len(speeds) if speeds else 50
        avg_volume = int(sum(volumes) / len(volumes)) if volumes else 50
        
        for node in still_missing:
            current_data[node] = {
                'speed': avg_speed,
                'volume': avg_volume
            }
    
    print(f"[INFO] 填充完成，总节点数: {len(current_data)}")
    return current_data


# ==================== 实时数据爬取 ====================
REALTIME_API_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"

def fetch_realtime_data():
    """从香港运输署API爬取实时交通数据"""
    try:
        print("[INFO] 开始爬取实时数据...")
        resp = requests.get(REALTIME_API_URL, timeout=15)
        resp.raise_for_status()
        xml_data = resp.content
        
        print(f"[DEBUG] API响应长度: {len(xml_data)} 字节")
        
        root = etree.fromstring(xml_data)
        records = []
        
        date = root.findtext("date")  # 全局日期
        print(f"[DEBUG] 日期: {date}")
        
        periods = root.findall(".//period")
        print(f"[DEBUG] 找到 {len(periods)} 个时间段")
        
        for period in periods:
            period_time = period.findtext("period_from")
            if not date or not period_time:
                continue
            
            timestamp = datetime.strptime(f"{date} {period_time}", "%Y-%m-%d %H:%M:%S")
            
            detectors = period.findall(".//detector")
            for detector in detectors:
                detector_id = detector.findtext("detector_id")
                
                for lane in detector.findall(".//lane"):
                    try:
                        speed = float(lane.findtext("speed") or 0)
                        volume = int(lane.findtext("volume") or 0)
                        records.append({
                            'detector_id': detector_id,
                            'timestamp': timestamp.isoformat(),
                            'speed': speed,
                            'volume': volume
                        })
                    except Exception as e:
                        pass
        
        print(f"[INFO] 爬取成功，共 {len(records)} 条原始记录")
        if records:
            print(f"[DEBUG] 第一条记录: {records[0]}")
            print(f"[DEBUG] 检测器ID示例: {[r['detector_id'] for r in records[:5]]}")
        
        # 按 detector_id 聚合数据（合并车道）
        aggregated_data = defaultdict(lambda: {'speeds': [], 'volumes': []})
        for record in records:
            det_id = record['detector_id']
            aggregated_data[det_id]['speeds'].append(record['speed'])
            aggregated_data[det_id]['volumes'].append(record['volume'])
        
        # 计算平均值和总和
        real_data = {}
        unmatched_detectors = []
        
        for det_id, data in aggregated_data.items():
            avg_speed = sum(data['speeds']) / len(data['speeds']) if data['speeds'] else 0
            total_volume = sum(data['volumes']) if data['volumes'] else 0
            
            # 尝试将 AID 格式转换为数字格式
            if det_id in ID_MAP:
                num_id = ID_MAP[det_id]
                # 只保存数字ID格式
                real_data[num_id] = {'speed': avg_speed, 'volume': total_volume}
            else:
                # 尝试直接作为数字处理
                try:
                    num_id = int(det_id)
                    real_data[num_id] = {'speed': avg_speed, 'volume': total_volume}
                except:
                    # 无法转换的ID跳过
                    unmatched_detectors.append(det_id)
        
        if unmatched_detectors:
            print(f"[WARNING] {len(unmatched_detectors)} 个检测器ID未在映射表中找到并跳过: {unmatched_detectors[:10]}...")
        
        print(f"[INFO] 聚合后真实节点数据: {len(real_data)} 个检测器（仅数字ID）")
        
        # 填充所有缺失节点数据（包括真实节点和虚拟节点）
        filled_data = fill_all_missing_nodes(real_data)
        print(f"[INFO] 填充后总数据: {len(filled_data)} 个节点（目标: {len(ALL_NODES)}）")
        
        # 转换为记录格式
        final_records = []
        for det_id, data in filled_data.items():
            final_records.append({
                'detector_id': det_id,
                'timestamp': timestamp.isoformat() if records else None,
                'speed': data['speed'],
                'volume': data['volume']
            })
        
        return {
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'data_time': timestamp.isoformat() if records else None,
            'records': final_records,
            'real_nodes': len(real_data),
            'virtual_nodes_filled': len(filled_data) - len(real_data)
        }
    except Exception as e:
        print(f"[ERROR] 爬取失败: {e}")
        import traceback
        print(f"[ERROR] 堆栈: {traceback.format_exc()}")
        return {
            'success': False,
            'error': str(e),
            'records': []
        }

# ==================== 路由定义 ====================

@app.route('/api/python/realtime/fetch', methods=['GET'])
def fetch_realtime():
    """爬取实时交通数据"""
    result = fetch_realtime_data()
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@app.route('/api/python/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'message': 'Python API is running',
        'torch_available': TORCH_AVAILABLE
    })


@app.route('/api/python/network/stats', methods=['GET'])
def get_network_stats():
    if not TORCH_AVAILABLE:
        return jsonify({'error': 'PyTorch not installed'}), 503
    return jsonify({
        'total_nodes': NUM_NODES,
        'edges': int(torch.sum(adj_matrix).item() / 2),
        'model_loaded': os.path.exists(os.path.join(BASE_DIR, "astgnn.pth")),
        'device': DEVICE
    })


@app.route('/api/python/network/connection', methods=['POST'])
def add_connection():
    if not TORCH_AVAILABLE:
        return jsonify({'error': 'PyTorch not installed'}), 503
    data = request.json
    node1 = data.get('node1')
    node2 = data.get('node2')
    weight = data.get('weight', 2.0)

    if node1 is None or node2 is None:
        return jsonify({'error': 'node1 and node2 are required'}), 400

    if int(node1) not in VALID_DETECTOR_IDS or int(node2) not in VALID_DETECTOR_IDS:
        return jsonify({'error': f'无效的节点ID，有效范围: {min(VALID_DETECTOR_IDS)}~{max(VALID_DETECTOR_IDS)}'}), 400

    global adj_matrix
    adj_matrix[node1, node2] = weight
    adj_matrix[node2, node1] = weight

    return jsonify({
        'success': True,
        'message': f'已添加连接: {node1} ↔ {node2}, 权重: {weight}'
    })


@app.route('/api/python/network/check', methods=['POST'])
def check_connection():
    """检查两个节点之间是否存在连接"""
    data = request.json
    node1 = data.get('node1')
    node2 = data.get('node2')
    if node1 is None or node2 is None:
        return jsonify({'error': '缺少节点参数'}), 400
    node1, node2 = int(node1), int(node2)
    if node1 not in VALID_DETECTOR_IDS or node2 not in VALID_DETECTOR_IDS:
        return jsonify({'error': '无效的节点ID', 'connected': False}), 400
    if node1 >= NUM_NODES or node2 >= NUM_NODES:
        return jsonify({'error': '节点ID超出范围', 'connected': False}), 400
    weight = float(adj_matrix[node1, node2])
    return jsonify({
        'connected': weight > 0,
        'weight': weight if weight > 0 else 0
    })


@app.route('/api/python/network/remove', methods=['POST'])
def remove_connection():
    if not TORCH_AVAILABLE:
        return jsonify({'error': 'PyTorch not installed'}), 503
    data = request.json
    node1 = data.get('node1')
    node2 = data.get('node2')

    if node1 is None or node2 is None:
        return jsonify({'error': 'node1 and node2 are required'}), 400

    if int(node1) not in VALID_DETECTOR_IDS or int(node2) not in VALID_DETECTOR_IDS:
        return jsonify({'error': f'无效的节点ID，有效范围: {min(VALID_DETECTOR_IDS)}~{max(VALID_DETECTOR_IDS)}'}), 400

    global adj_matrix
    if adj_matrix[node1, node2] == 0 and adj_matrix[node2, node1] == 0:
        return jsonify({'error': f'节点 {node1} 和 {node2} 之间没有连接'}), 400

    adj_matrix[node1, node2] = 0
    adj_matrix[node2, node1] = 0

    return jsonify({
        'success': True,
        'message': f'已移除连接: {node1} ↔ {node2}'
    })


@app.route('/api/python/network/reset', methods=['POST'])
def reset_network():
    if not TORCH_AVAILABLE:
        return jsonify({'error': 'PyTorch not installed'}), 503
    global adj_matrix
    if os.path.exists(os.path.join(BASE_DIR, "adj_matrix.npy")):
        adj_matrix = torch.tensor(np.load(os.path.join(BASE_DIR, "adj_matrix.npy"))).float().to(DEVICE)
    else:
        adj_matrix = torch.eye(NUM_NODES).float().to(DEVICE)

    return jsonify({'success': True, 'message': '路网已重置为原始状态'})


def load_initial_data_from_csv(current_datetime):
    """
    根据当前时间从 CSV 文件读取初始数据
    :param current_datetime: datetime 对象，当前时间
    :return: np.ndarray 形状为 (NUM_NODES, 3)，包含流量、速度、占用率；如果没有找到数据返回 None
    """
    if current_datetime is None:
        return None
    
    try:
        # 构建 CSV 文件路径
        date_str = current_datetime.strftime('%Y-%m-%d')
        month_str = current_datetime.strftime('%Y-%m')
        csv_path = os.path.join(DATA_DIR, 'monthly', month_str, f'fd_{date_str}.csv')
        
        if not os.path.exists(csv_path):
            print(f"[INFO] CSV 文件不存在: {csv_path}")
            return None
        
        print(f"[INFO] 正在读取 CSV 文件: {csv_path}")
        
        # 计算时间步（每10分钟一个数据点，从00:00开始）
        minutes_since_midnight = current_datetime.hour * 60 + current_datetime.minute
        time_step = int(minutes_since_midnight / 10)
        
        print(f"[INFO] 当前时间步: {time_step} (对应 {current_datetime.strftime('%H:%M')})")
        
        # 读取 CSV 文件
        initial_data = np.zeros((NUM_NODES, 3))
        with open(csv_path, 'r', encoding='utf-8') as f:
            # 读取表头
            header = f.readline().strip().split(',')
            
            # 找到所需列的索引
            detector_id_idx = -1
            flow_idx = -1
            speed_idx = -1
            occupancy_idx = -1
            
            for i, col in enumerate(header):
                if 'detector_id' in col.lower() or 'detectorid' in col.lower():
                    detector_id_idx = i
                elif 'flow' in col.lower() or 'volume' in col.lower():
                    flow_idx = i
                elif 'speed' in col.lower():
                    speed_idx = i
                elif 'occupancy' in col.lower():
                    occupancy_idx = i
            
            if detector_id_idx == -1 or flow_idx == -1 or speed_idx == -1:
                print("[WARNING] CSV 文件格式不正确，缺少必要的列")
                return None
            
            # 读取数据行
            for line in f:
                parts = line.strip().split(',')
                if len(parts) <= max(detector_id_idx, flow_idx, speed_idx, occupancy_idx):
                    continue
                
                try:
                    detector_id = int(parts[detector_id_idx].strip())
                    flow = float(parts[flow_idx].strip()) if parts[flow_idx].strip() else 0.0
                    speed = float(parts[speed_idx].strip()) if parts[speed_idx].strip() else 0.0
                    occupancy = float(parts[occupancy_idx].strip()) if parts[occupancy_idx].strip() else 0.0
                    
                    if 0 < detector_id < NUM_NODES:
                        # 将数据放入对应位置（假设 CSV 中每行是一个检测器在所有时间步的数据）
                        # 需要根据时间步索引获取对应数据
                        # 这里简化处理，直接使用检测器的基础数据
                        initial_data[detector_id, 0] = flow
                        initial_data[detector_id, 1] = speed
                        initial_data[detector_id, 2] = occupancy / 100.0  # 转换为比例
                except ValueError:
                    continue
        
        print(f"[INFO] 成功从 CSV 加载 {np.count_nonzero(initial_data[:, 0])} 个检测器的数据")
        return initial_data
        
    except Exception as e:
        print(f"[ERROR] 读取 CSV 数据失败: {str(e)}")
        return None


@app.route('/api/python/emergency/simulate', methods=['POST'])
def emergency_simulate():
    if not TORCH_AVAILABLE:
        return jsonify({'error': 'PyTorch not installed'}), 503
    try:
        data = request.json

        event_type = data.get('type', 'lane_reduction')
        node_ids = data.get('node_ids', [])
        severity = data.get('severity', 0.5)
        num_steps = data.get('num_steps', 36)
        start_datetime = data.get('start_datetime', '2024-01-15 08:00:00')
        
        # 获取当前时间（用于读取对应时刻的历史数据）
        current_datetime_str = data.get('current_datetime')
        current_datetime = None
        if current_datetime_str:
            try:
                current_datetime = datetime.fromisoformat(current_datetime_str.replace('Z', '+00:00'))
                print(f"[INFO] 使用当前时间: {current_datetime}")
            except:
                print("[WARNING] 解析 current_datetime 失败，使用默认数据")

        # 验证节点 ID 是否为有效检测器
        if not node_ids:
            return jsonify({'error': '请至少选择一个受影响节点'}), 400

        invalid_ids = [nid for nid in node_ids if int(nid) not in VALID_DETECTOR_IDS]
        if invalid_ids:
            return jsonify({'error': f'无效的节点ID: {invalid_ids}，请选择地图上存在的检测器节点'}), 400

        # 尝试从 CSV 文件读取初始数据
        initial_data = load_initial_data_from_csv(current_datetime)
        
        # 如果没有读取到数据，使用随机生成的默认数据
        if initial_data is None:
            print("[INFO] 未找到对应时间的CSV数据，使用默认随机数据")
            initial_data = np.zeros((NUM_NODES, 3))
            for i in range(NUM_NODES):
                if NODE_FEATURES and i in NODE_FEATURES:
                    lane_num = NODE_FEATURES[i].get('lane_num', 2)
                    initial_data[i, 0] = 50 + lane_num * 20 + np.random.rand() * 30  
                    initial_data[i, 1] = 40 + np.random.rand() * 20  
                    initial_data[i, 2] = 0.3 + np.random.rand() * 0.4  
                else:
                    initial_data[i, 0] = 50 + np.random.rand() * 50
                    initial_data[i, 1] = 40 + np.random.rand() * 30
                    initial_data[i, 2] = 0.3 + np.random.rand() * 0.4

        modified_data = initial_data.copy()

        for node_id in node_ids:
            if node_id < NUM_NODES:
                if event_type == 'lane_reduction':
                    modified_data[node_id, 0] *= (1 - severity * 0.6)
                    modified_data[node_id, 1] *= (1 - severity * 0.4)
                elif event_type == 'speed_limit':
                    modified_data[node_id, 1] *= (1 - severity * 0.7)
                elif event_type == 'traffic_surge':
                    modified_data[node_id, 0] *= (1 + severity * 0.8)
                    modified_data[node_id, 1] *= (1 - severity * 0.3)
                elif event_type == 'road_block':
                    modified_data[node_id, 0] = 0
                    modified_data[node_id, 1] = 0

        initial_tensor = torch.tensor(modified_data).float().to(DEVICE)

        predictions = []
        current_features = initial_tensor.clone()

        for _ in range(num_steps):
            with torch.no_grad():
                output = model(current_features.unsqueeze(0), adj_matrix)
            predictions.append(output.squeeze(0).cpu().numpy())
            current_features = output.squeeze(0).clone()

        # 返回所有节点的预测数据（整个路网）
        all_preds = []
        for step_pred in predictions:
            step_all = []
            for nid in range(NUM_NODES):
                step_all.append({
                    'node_id': nid,
                    'flow': float(step_pred[nid, 0]),
                    'speed': float(step_pred[nid, 1]),
                    'occupancy': float(step_pred[nid, 2])
                })
            all_preds.append(step_all)

        return jsonify({
            'success': True,
            'steps': num_steps,
            'time_step': 10,
            'time_range_minutes': num_steps * 10,
            'emergency_event': {
                'type': event_type,
                'node_ids': node_ids,
                'severity': severity
            },
            'features': ['flow', 'speed', 'occupancy'],
            'predictions': all_preds,
            'shape': [num_steps, NUM_NODES, 3]
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PYTHON_API_PORT', 5001))
    print(f"[INFO] Starting Python API server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
