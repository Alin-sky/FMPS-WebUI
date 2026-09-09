// FMPS Web 后端入口
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { createRouter } from './routes.js';

// 进程级异常保护：Node 22 默认把未捕获的 Promise 拒绝视为致命错误直接退出进程，
// 这里改为记录日志并保活，避免单次异常把整个后端打死（前端会全部 500）。
process.on('unhandledRejection', (reason) => {
  console.error(`[unhandledRejection] ${reason && reason.stack || reason}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[uncaughtException] ${err && err.stack || err}`);
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// 请求日志中间件（方便定位问题）
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const flag = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✅';
    console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${flag} ${req.method} ${req.originalUrl} → ${status} (${ms}ms)`);
  });
  next();
});

app.use(createRouter());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`✅ FMPS Web 后端已启动: http://localhost:${config.port}`);
});
