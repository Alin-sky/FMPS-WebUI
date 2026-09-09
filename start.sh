#!/usr/bin/env bash
# ============================================================
#   FMPS 可视化系统 - 一键启动 (Linux / macOS)
#   行为：自动下载 Node.js -> 自动安装依赖 -> 自动启动前后端
#   用法：bash start.sh   或   chmod +x start.sh && ./start.sh
# ============================================================
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="v22.22.2"
RUNTIME_DIR="$ROOT/.runtime"

# ---------- 1. 检测系统与架构 ----------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "[错误] 不支持的架构: $ARCH"; exit 1 ;;
esac

case "$OS" in
  Linux)  NODE_DIST="node-$NODE_VERSION-linux-$ARCH";  EXT="tar.xz" ;;
  Darwin) NODE_DIST="node-$NODE_VERSION-darwin-$ARCH"; EXT="tar.gz" ;;
  *) echo "[错误] 不支持的系统: $OS"; exit 1 ;;
esac

NODE_DIR="$RUNTIME_DIR/$NODE_DIST"
NODE_EXE="$NODE_DIR/bin/node"

# 下载工具选择
if command -v curl >/dev/null 2>&1; then
  dl() { curl -L --fail --retry 3 -s -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -q -O "$2" "$1"; }
else
  echo "[错误] 需要 curl 或 wget 才能下载 Node.js"; exit 1
fi

echo "============================================"
echo "   FMPS 可视化系统 - 一键启动"
echo "============================================"
echo

# ---------- 2. 确保 Node.js 就绪 ----------
if [ ! -x "$NODE_EXE" ]; then
  echo "[1/4] 未检测到本地 Node.js，正在下载 Node.js $NODE_VERSION ($OS-$ARCH)..."
  mkdir -p "$RUNTIME_DIR"
  ARCHIVE="$RUNTIME_DIR/$NODE_DIST.$EXT"
  echo "   下载: https://npmmirror.com/mirrors/node/$NODE_VERSION/$NODE_DIST.$EXT"
  if ! dl "https://npmmirror.com/mirrors/node/$NODE_VERSION/$NODE_DIST.$EXT" "$ARCHIVE"; then
    echo "   [重试] 镜像不可用，改用官方源 nodejs.org..."
    dl "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.$EXT" "$ARCHIVE"
  fi
  echo "   解压: $NODE_DIST.$EXT"
  tar -xf "$ARCHIVE" -C "$RUNTIME_DIR"
  rm -f "$ARCHIVE"
fi

export PATH="$NODE_DIR/bin:$PATH"
echo "[OK] 使用 Node.js: $(node -v)"
echo

# ---------- 3. 安装依赖（首次自动安装，之后跳过） ----------
echo "[2/4] 检查依赖..."
if [ ! -d "$ROOT/server/node_modules" ]; then
  echo "   正在安装后端依赖 (server)..."
  (cd "$ROOT/server" && npm install --no-audit --no-fund --registry=https://registry.npmmirror.com)
fi
if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "   正在安装前端依赖 (web)..."
  (cd "$ROOT/web" && npm install --no-audit --no-fund --registry=https://registry.npmmirror.com)
fi
echo "   依赖就绪。"
echo

# ---------- 4. 启动前后端 ----------
echo "[3/4] 启动后端  http://localhost:3000"
(cd "$ROOT/server" && node src/index.js) &
BACK_PID=$!

echo "[4/4] 启动前端  http://localhost:5173"
(cd "$ROOT/web" && npm run dev) &
FRONT_PID=$!

echo
echo "============================================"
echo "   启动完成！"
echo "   前端页面: http://localhost:5173"
echo "   后端接口: http://localhost:3000"
echo "   按 Ctrl+C 停止全部服务"
echo "============================================"
echo

wait
