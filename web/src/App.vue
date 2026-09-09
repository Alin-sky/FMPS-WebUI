<template>
  <div class="app">
    <header class="topbar">
      <div class="brand" @click="$router.push('/')">
        <span class="logo">F</span>
        <span class="brand-text">
          <span class="name">FMPS数据更新系统</span>
          <span class="subtitle">File Management &amp; Processing System</span>
        </span>
      </div>
      <div class="actions">
        <el-button text @click="$router.push('/alias-config')">
          <el-icon><Setting /></el-icon><span class="cfg-label">别名配置</span>
        </el-button>
        <el-button text @click="$router.push('/skip-config')">
          <el-icon><CircleClose /></el-icon><span class="cfg-label">跳过配置</span>
        </el-button>
        <el-button text @click="$router.push('/revisions-config')">
          <el-icon><EditPen /></el-icon><span class="cfg-label">匹配修正</span>
        </el-button>
        <el-button text @click="$router.push('/versions')">
          <el-icon><Clock /></el-icon><span class="cfg-label">版本管理</span>
        </el-button>
        <el-tooltip :content="isDark ? '切换到浅色' : '切换到深色'" placement="bottom">
          <el-switch
            v-model="isDark"
            :active-action-icon="Moon"
            :inactive-action-icon="Sunny"
            @change="toggleTheme"
          />
        </el-tooltip>
      </div>
    </header>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Moon, Sunny, Setting, CircleClose, EditPen, Clock } from '@element-plus/icons-vue';

const isDark = ref(false);

function toggleTheme(v) {
  document.documentElement.classList.toggle('dark', v);
  localStorage.setItem('fmps-theme', v ? 'dark' : 'light');
}

onMounted(() => {
  const saved = localStorage.getItem('fmps-theme');
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  isDark.value = dark;
  document.documentElement.classList.toggle('dark', dark);
});
</script>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 20px;
  background:
    radial-gradient(1200px 600px at 15% -10%, rgba(91, 141, 239, 0.14), transparent 60%),
    radial-gradient(1000px 500px at 100% 0%, rgba(122, 111, 240, 0.12), transparent 55%),
    var(--el-bg-color-page);
  background-attachment: fixed;
}
/* 深色模式：背景调浅，偏蓝紫而非纯黑 */
html.dark {
  --el-bg-color: #1e1f2b;
  --el-bg-color-page: #151620;
  --el-bg-color-overlay: #272834;
  --el-fill-color: #262734;
  --el-fill-color-light: #2b2c3a;
  --el-fill-color-lighter: #212230;
  --el-fill-color-blank: #1e1f2b;
  --el-border-color: #3b3c4c;
  --el-border-color-light: #343542;
  --el-border-color-lighter: #2c2d3b;
}
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 56px;
  background: rgba(30, 31, 43, 0.6);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
html:not(.dark) .topbar {
  background: rgba(255, 255, 255, 0.65);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, #5b8def, #7a6ff0);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  box-shadow: 0 2px 6px rgba(90, 120, 230, 0.35);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.name {
  font-size: 18px;
  font-weight: 700;
}
.subtitle {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.02em;
}
.content {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 16px;
  box-sizing: border-box;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cfg-label { margin-left: 2px; }
/* 毛玻璃面板（透光） */
.glass {
  background: rgba(30, 31, 43, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
}
html:not(.dark) .glass {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 8px 28px rgba(30, 50, 90, 0.08);
}
/* 液态玻璃按钮 */
.el-button {
  border-radius: 10px;
  font-weight: 500;
  transition: all 0.2s ease;
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}
.el-button--default,
.el-button.is-plain,
.el-button--text {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 3px 12px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(255, 255, 255, 0.05);
}
html:not(.dark) .el-button--default,
html:not(.dark) .el-button.is-plain,
html:not(.dark) .el-button--text {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.5));
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow:
    0 3px 12px rgba(30, 50, 90, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 1),
    inset 0 -1px 0 rgba(120, 140, 200, 0.15);
}
.el-button--primary,
.el-button--success,
.el-button--warning,
.el-button--danger {
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -2px 0 rgba(0, 0, 0, 0.12);
}
/* 深色模式：按钮泛光效果（调低） */
html.dark .el-button--primary {
  box-shadow: 0 4px 14px rgba(64, 158, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
html.dark .el-button--success {
  box-shadow: 0 4px 14px rgba(74, 222, 128, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
html.dark .el-button--warning {
  box-shadow: 0 4px 14px rgba(251, 191, 36, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
html.dark .el-button--danger {
  box-shadow: 0 4px 14px rgba(248, 113, 113, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
html.dark .el-button--default,
html.dark .el-button.is-plain {
  box-shadow: 0 2px 8px rgba(120, 140, 240, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.el-button:hover {
  transform: translateY(-2px);
  filter: brightness(1.06);
}
/* 标签美化 */
.el-tag {
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.15s;
}
.el-tag--plain {
  backdrop-filter: blur(8px);
}
.el-tag:hover {
  filter: brightness(1.05);
}

/* ===== 全局滚动条 ===== */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(140, 150, 220, 0.35);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(140, 150, 220, 0.6);
  background-clip: content-box;
}
html:not(.dark) ::-webkit-scrollbar-thumb {
  background: rgba(100, 120, 190, 0.3);
  background-clip: content-box;
}

/* ===== 弹窗美化 ===== */
.el-dialog {
  border-radius: 18px !important;
  overflow: hidden;
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow: 0 24px 70px rgba(10, 14, 40, 0.45) !important;
}
html:not(.dark) .el-dialog {
  box-shadow: 0 24px 70px rgba(40, 60, 130, 0.22) !important;
}
.el-dialog__header {
  padding: 18px 22px 12px !important;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(135deg, rgba(91, 141, 239, 0.08), transparent 70%);
}
html.dark .el-dialog__header {
  background: linear-gradient(135deg, rgba(122, 111, 240, 0.14), transparent 70%);
}
.el-dialog__title {
  font-weight: 700;
  font-size: 18px;
}
.el-dialog__body {
  padding: 20px 22px !important;
}
.el-dialog__footer {
  padding: 12px 22px 18px !important;
}
.el-overlay {
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* ===== 输入框 / 选择器圆角 ===== */
.el-input__wrapper,
.el-select .el-input__wrapper,
.el-textarea__inner {
  border-radius: 10px !important;
  box-shadow: 0 0 0 1px var(--el-border-color) inset;
  transition: box-shadow 0.2s;
}
.el-input__wrapper:hover,
.el-textarea__inner:hover {
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
}
.el-input__wrapper.is-focus,
.el-textarea__inner:focus {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset, 0 0 0 4px rgba(64, 158, 255, 0.12);
}

/* ===== 卡片 / 单选边框模式 ===== */
.el-radio.is-bordered,
.el-checkbox.is-bordered {
  border-radius: 12px !important;
  height: auto !important;
}
.el-radio.is-bordered.is-checked {
  background: rgba(64, 158, 255, 0.08);
}

/* ===== 空状态 ===== */
.el-empty__description p {
  color: var(--el-text-color-secondary);
}

/* ===== 消息提示 ===== */
.el-message {
  border-radius: 12px !important;
  backdrop-filter: blur(16px);
}

/* ===== 顶栏入口图标悬停 ===== */
.actions .el-button {
  padding: 8px 12px;
}
.actions .el-button:hover .el-icon {
  transform: scale(1.12);
}
.actions .el-button .el-icon {
  transition: transform 0.18s ease;
}

/* ===== 页面入场动画 ===== */
/* 注意：必须用 backwards 而不是 both —— both 会在动画结束后永久保留
   to 关键帧的 transform: translateY(0)，使 .content > * 成为 fixed 定位的
   包含块，导致滚动页面后 el-dialog/el-overlay（position:fixed）相对整个
   页面而非视口定位，弹窗飞到视口外（不可见）。backwards 只在动画期间
   应用 from 帧，结束后不残留 transform，视觉效果完全一致。 */
.content > * {
  animation: fadeUp 0.35s ease backwards;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ===== 数字等宽 ===== */
.mono, .chip, .stat-num, .ver-ts {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
  .cfg-label { display: none; }
  .content { padding: 14px 10px; }
  body { font-size: 17px; }
}
</style>
