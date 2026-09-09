# FMPS 可视化系统

FMPS（File Management and Processing Systems）的网页可视化版，一个**完全独立并行**的系统——不读、不写原 FMPS 项目，只借鉴其逻辑和 JSON 结构，自己爬取、自己存储、自己上传。

## 数据流

```
schaledb(DB) + gamekee 爬取
        ↓
独立生成 JSON（格式与 FMPS 一致）
        ↓
前端展示 → 管理员核对 → 补充
        ↓
新角色补头像
        ↓
红绿 diff 预览 → 密码认证 → 上传 COS
```

## 目录结构

```
fmps-web/
├── server/              # 后端（Node.js + Express）
│   ├── src/
│   │   ├── index.js     # Express 入口
│   │   ├── config.js    # 配置（数据目录、数据源）
│   │   ├── crawler.js   # schaledb 爬取（fetch）
│   │   ├── generator.js # 生成 JSON（移植 ba-plugin 逻辑）
│   │   ├── aggregate.js # 按 Id_db 聚合
│   │   ├── routes.js    # REST API
│   │   └── crawl.js     # 爬取脚本（命令行触发）
│   └── data/json/       # 系统自己的数据（生成的 JSON）
└── web/                 # 前端（Vue 3 + Vite + Element Plus）
    └── src/
        ├── App.vue      # 布局 + 主题切换
        ├── views/
        │   ├── StudentList.vue   # 学生列表
        │   └── StudentDetail.vue # 学生详情
        └── api/index.js
```

## 快速开始（便携版 · 一键启动）

> 无需预装 Node.js，也无需关心版本——脚本会自动下载与当前系统匹配的 Node.js（v22.22.2），
> 自动安装依赖（走 npmmirror 国内镜像），再自动启动前后端。

### Windows

双击 **`启动.bat`** 即可。

首次启动会自动完成以下几步，之后启动秒开：

1. 检测 CPU 架构（x64 / arm64）
2. 下载 Node.js v22.22.2 到 `.runtime/`（镜像不可用自动回退官方源）
3. 安装后端 / 前端依赖（走 `registry.npmmirror.com`）
4. 弹出两个窗口分别启动后端（`:3000`）与前端（`:5173`）

启动后浏览器访问 **http://localhost:5173**。

### Linux / macOS

```bash
bash start.sh          # 或 chmod +x start.sh && ./start.sh
```

### 首次使用提示

- 前端页面首次打开时，点击「**爬取更新**」按钮获取最新数据（漫画图片缓存未打包，需重新爬取）。
- 关闭启动窗口不会停止服务；在后端 / 前端窗口按 `Ctrl+C` 停止。
- 若 `3000` / `5173` 端口被占用，请先释放端口。

---

## 手动方式（开发者）

> 已安装 Node.js ≥ 18 的环境可手动操作。

### 1. 安装依赖

```bash
cd server && npm install
cd ../web && npm install
```

### 2. 爬取数据（首次必须）

```bash
cd server
npm run crawl
```

会从 schaledb 爬取 5 语言学生数据 + 道具，生成 6 个 JSON 到 `server/data/json/`。

### 3. 启动后端

```bash
cd server
npm start        # 或 npm run dev（热重载）
```

后端运行在 `http://localhost:3000`。

### 4. 启动前端

```bash
cd web
npm run dev
```

前端运行在 `http://localhost:5173`，会自动代理 `/api` 到后端。

## 重新打包

修改代码后想重新生成便携版压缩包，运行：

```bash
python 打包.py     # 生成 FMPS-便携版.zip 到上级目录
```

脚本自动排除 `node_modules`、`.runtime`、漫画图片缓存、日志、快照、开发截图。

## 已实现（P1）

- ✅ schaledb 爬取（5 语言学生 + 道具）
- ✅ 生成与 FMPS 结构一致的 JSON（sms_studata_main / toaro_stu / liwu / favor_stu_tap / favora_data / gacha_data）
- ✅ 按 Id_db 归一化聚合（Id_db / id / stuid 三种键名）
- ✅ 学生列表（网格 + 搜索 + 筛选 + 缺失标记）
- ✅ 学生详情（全字段 + 缺失高亮）
- ✅ 头像代理（绕过 schaledb Referer 限制）
- ✅ 浅色/深色主题 + 手机适配

## 待实现（P2 / P3）

- 红绿 diff 对比
- 新角色检测 + 补头像（第一头像自动爬 / 第二头像上传）
- 合并/删除 + 别名自动补充（修复待指认）
- 手动维护卡池 [0]
- 发布上传（密码认证 + hash + COS）
- 手动导入种子文件入口

## 技术栈

- 后端：Node.js + Express + pinyin-pro + chinese-s2t-pro
- 前端：Vue 3 + Vite + Element Plus + Vue Router
