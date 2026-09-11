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
/* ============================================================
   主题 token 层
   ------------------------------------------------------------
   所有面板的背景 / 边框 / 阴影都从这里取，不要在组件里再写死
   `rgba(255,255,255,.62)` 或用 `:global(html.dark)` 覆盖。

   为什么必须这样做：Vue 的 scoped CSS 会把 `:global(html.dark) .foo`
   这条规则整条丢掉（编译产物里根本不存在），于是深色模式下这些面板
   仍然套用浅色背景 —— 「深色模式下一片灰」就是这么来的。
   改用 CSS 变量做主题切换与作用域无关，从根上避免这类问题。
   ============================================================ */
:root {
  /* 毛玻璃面板 */
  --fmps-panel-bg: rgba(255, 255, 255, 0.66);
  --fmps-panel-border: rgba(20, 30, 60, 0.08);
  --fmps-panel-shadow: 0 8px 28px rgba(30, 50, 90, 0.08);
  --fmps-panel-shadow-lg: 0 12px 36px rgba(30, 50, 90, 0.11);
  /* 顶栏 */
  --fmps-topbar-bg: rgba(255, 255, 255, 0.7);
  --fmps-topbar-border: rgba(20, 30, 60, 0.07);
  /* 面板内嵌浅底 */
  --fmps-inset-bg: rgba(255, 255, 255, 0.55);
  --fmps-inset-border: rgba(20, 30, 60, 0.06);
  /* 面板内的「凹陷」底（diff 行 / 代码行）：浅色下比面板更深，深色下比面板更亮。
     以前这里写死成 rgba(255,255,255,0.04) 再配一条 `html:not(.dark)` 去覆盖，
     但 scoped 块里的 `html:not(.dark)` 会被 Vue 编译器整条丢掉 → 浅色模式下
     白底叠白 → 内容直接隐形。改成 token 后两边都生效。 */
  --fmps-subtle-bg: rgba(20, 30, 60, 0.035);
  --fmps-subtle-border: rgba(20, 30, 60, 0.06);
  /* 面板的渐变描边环（::before 那圈细光边） */
  --fmps-ring: linear-gradient(
    135deg,
    rgba(120, 140, 240, 0.35),
    rgba(120, 140, 240, 0.04) 30%,
    rgba(160, 120, 240, 0.06) 60%,
    rgba(120, 180, 240, 0.3)
  );
  /* 分隔线 / 背景光晕 */
  --fmps-divider: rgba(20, 30, 60, 0.09);
  --fmps-glow: rgba(91, 141, 239, 0.14);
  --fmps-glow-2: rgba(122, 111, 240, 0.12);
  /* 液态玻璃按钮 */
  --fmps-btn-bg: linear-gradient(145deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.55));
  --fmps-btn-border: rgba(255, 255, 255, 0.95);
  --fmps-btn-shadow:
    0 3px 12px rgba(30, 50, 90, 0.12),
    inset 0 1px 0 #fff,
    inset 0 -1px 0 rgba(120, 140, 200, 0.15);
  /* 面板内的卡片 */
  --fmps-card-bg: linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.38));
  --fmps-card-border: rgba(20, 30, 60, 0.07);
  --fmps-card-shadow: 0 2px 8px rgba(30, 50, 90, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  /* 弹窗 */
  --fmps-dialog-shadow: 0 24px 70px rgba(40, 60, 130, 0.22);
  --fmps-dialog-head-glow: linear-gradient(135deg, rgba(91, 141, 239, 0.08), transparent 70%);
}

html.dark {
  /* ---- Element Plus 深色基色：比默认的纯灰更有蓝紫调 ---- */
  --el-bg-color: #1c1d29;
  --el-bg-color-page: #12131c;
  --el-bg-color-overlay: #24252f;
  --el-fill-color: #262838;
  --el-fill-color-light: #2b2d3d;
  --el-fill-color-lighter: #202131;
  --el-fill-color-extra-light: #1a1b26;
  --el-fill-color-dark: #33354a;
  --el-fill-color-darker: #3a3c52;
  --el-fill-color-blank: #1c1d29;
  --el-border-color: #3d3f52;
  --el-border-color-light: #35374a;
  --el-border-color-lighter: #2e3042;
  --el-border-color-extra-light: #272939;
  --el-text-color-primary: #e8eaf3;
  --el-text-color-regular: #ced1de;
  --el-text-color-secondary: #a0a4b8;
  --el-text-color-placeholder: #7c8098;
  --el-text-color-disabled: #5d6076;
  --el-mask-color: rgba(10, 11, 18, 0.8);
  --el-table-border-color: #2e3042;
  --el-table-header-bg-color: #24252f;
  --el-table-row-hover-bg-color: rgba(91, 141, 239, 0.12);
  --el-disabled-bg-color: #262838;

  /* ---- 本项目 token ---- */
  --fmps-panel-bg: rgba(36, 37, 49, 0.72);
  --fmps-panel-border: rgba(255, 255, 255, 0.1);
  --fmps-panel-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
  --fmps-panel-shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.38);
  --fmps-topbar-bg: rgba(24, 25, 36, 0.72);
  --fmps-topbar-border: rgba(255, 255, 255, 0.08);
  --fmps-inset-bg: rgba(255, 255, 255, 0.045);
  --fmps-inset-border: rgba(255, 255, 255, 0.08);
  --fmps-subtle-bg: rgba(255, 255, 255, 0.045);
  --fmps-subtle-border: rgba(255, 255, 255, 0.07);
  --fmps-ring: linear-gradient(
    135deg,
    rgba(120, 140, 240, 0.45),
    rgba(120, 140, 240, 0.05) 30%,
    rgba(160, 120, 240, 0.08) 60%,
    rgba(120, 180, 240, 0.4)
  );
  --fmps-divider: rgba(255, 255, 255, 0.09);
  --fmps-glow: rgba(91, 141, 239, 0.16);
  --fmps-glow-2: rgba(122, 111, 240, 0.13);
  --fmps-btn-bg: linear-gradient(145deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.03));
  --fmps-btn-border: rgba(255, 255, 255, 0.16);
  --fmps-btn-shadow:
    0 2px 8px rgba(120, 140, 240, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  /* 面板内的卡片 */
  --fmps-card-bg: linear-gradient(145deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
  --fmps-card-border: rgba(255, 255, 255, 0.1);
  --fmps-card-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  /* 弹窗 */
  --fmps-dialog-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  --fmps-dialog-head-glow: linear-gradient(135deg, rgba(122, 111, 240, 0.16), transparent 70%);
}

/* ============ 字号：整体放大一档（正文 14 → 16） ============ */
:root {
  --el-font-size-extra-large: 23px;
  --el-font-size-large: 20px;
  --el-font-size-medium: 18px;
  --el-font-size-base: 16px;
  --el-font-size-small: 15px;
  --el-font-size-extra-small: 13px;
  --el-component-size-large: 44px;
  --el-component-size: 36px;
  --el-component-size-small: 30px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  background:
    radial-gradient(1200px 600px at 15% -10%, var(--fmps-glow), transparent 60%),
    radial-gradient(1000px 500px at 100% 0%, var(--fmps-glow-2), transparent 55%),
    var(--el-bg-color-page);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
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
  padding: 0 22px;
  height: 64px;
  background: var(--fmps-topbar-bg);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  border-bottom: 1px solid var(--fmps-topbar-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #5b8def, #7a6ff0);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 3px 10px rgba(90, 120, 230, 0.4);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.name {
  font-size: 19px;
  font-weight: 700;
}
.subtitle {
  font-size: 13px;
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
/* 毛玻璃面板（透光）——深浅色统一走 token */
.glass {
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  box-shadow: var(--fmps-panel-shadow);
}
/* 液态玻璃按钮 */
.el-button {
  border-radius: 10px;
  font-weight: 500;
  transition: transform 0.16s ease, box-shadow 0.2s ease, filter 0.2s ease;
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}
/* 默认型按钮（无色）+ plain / text 型：液态玻璃底。
   注意**不能**用 `.el-button--default` —— Element Plus 会把 `size="default"`
   也编译成这个类，于是 primary / success 等彩色按钮也会被盖上这层半透明白，
   变成"白字白底、按钮凭空消失"。这里改为显式排除所有彩色类型。 */
.el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--warning):not(.el-button--danger):not(.el-button--info),
.el-button.is-plain,
.el-button.is-text,
.el-button--text {
  background: var(--fmps-btn-bg);
  border: 1px solid var(--fmps-btn-border);
  box-shadow: var(--fmps-btn-shadow);
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
.el-button:hover {
  transform: translateY(-2px);
  filter: brightness(1.06);
}
/* 表格行内的按钮不做悬浮位移，否则行内元素会上下跳动、看起来"不对齐" */
.el-table .el-button,
.el-table .el-button:hover {
  transform: none;
}
/* 表格里的文本按钮：去掉玻璃底，回归纯文字链接。
   三个宽度不一的玻璃胶囊并排，视觉上怎么排都像没对齐。 */
.el-table .el-button.is-text {
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  padding: 4px 8px;
  height: auto;
}
.el-table .el-button.is-text:hover {
  background: var(--el-fill-color-light);
  filter: none;
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
  box-shadow: var(--fmps-dialog-shadow) !important;
}
.el-dialog__header {
  padding: 18px 24px 14px !important;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--fmps-dialog-head-glow);
}
.el-dialog__title {
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.01em;
}
.el-dialog__body {
  padding: 20px 24px !important;
  font-size: 15px;
  line-height: 1.7;
}
.el-dialog__footer {
  padding: 12px 24px 18px !important;
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

/* ===== 表格：行高与内边距随字号一起放大 ===== */
.el-table {
  font-size: var(--el-font-size-base);
  --el-table-border-color: var(--fmps-divider);
}
.el-table th.el-table__cell {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  letter-spacing: 0.02em;
  padding: 10px 0;
}
.el-table td.el-table__cell {
  padding: 12px 0;
}
.el-table .cell {
  line-height: 1.55;
  padding: 0 14px;
}
.el-table__inner-wrapper::before {
  height: 1px;
  background-color: var(--fmps-divider);
}

/* ===== 模式切换（radio-button 组）：加大点击区 ===== */
.el-radio-button__inner {
  font-size: 15px;
  padding: 10px 20px;
}

/* ===== 标签 ===== */
.el-tag {
  font-size: 13px;
}

/* ===== 消息提示 ===== */
.el-message {
  font-size: 15px;
}

@media (max-width: 560px) {
  .cfg-label { display: none; }
  .content { padding: 14px 10px; }
  body { font-size: 15px; }
  .topbar { padding: 0 14px; height: 58px; }
}
</style>
