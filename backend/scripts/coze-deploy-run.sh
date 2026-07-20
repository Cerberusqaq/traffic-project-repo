#!/usr/bin/env bash
set -euo pipefail

# 基于脚本位置定位项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 清理端口残留进程
fuser -k 5000/tcp 2>/dev/null || true
fuser -k 5001/tcp 2>/dev/null || true
sleep 1

# 启动 Python API 服务（后台运行）
export PYTHON_API_PORT=5001
nohup python3 python_api.py > /app/work/logs/bypass/python_api.log 2>&1 &
echo "[INFO] Python API server starting on port 5001, PID: $!"

# 等待 Python 服务就绪
for i in $(seq 1 15); do
    if curl -s http://127.0.0.1:5001/api/python/health > /dev/null 2>&1; then
        echo "[INFO] Python API server is ready"
        break
    fi
    echo "[INFO] Waiting for Python API server... ($i/15)"
    sleep 1
done

# 启动后端服务（固定端口 5000）
export PORT=5000
exec node server.js
