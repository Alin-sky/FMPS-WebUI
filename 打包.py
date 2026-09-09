# -*- coding: utf-8 -*-
"""
FMPS 可视化系统 - 打包脚本
生成一个「便携版」压缩包：包含全部代码、配置、学生/漫画 JSON 元数据、头像图片，
自动排除 node_modules（首次运行自动安装）、.runtime（自动下载 Node）、
2.3GB 漫画图片缓存（首次运行重新爬取）、日志、快照、开发截图等。

用法：
    python 打包.py          # 生成压缩包到上级目录
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(ROOT), "FMPS-便携版.zip")
TOP = "FMPS便携版"  # 压缩包内的顶层文件夹名

# 任意层级都要排除的目录名
EXCLUDE_DIRS = {
    "node_modules", ".runtime", ".workbuddy", ".git",
    "__pycache__", "dist",
}

# 以项目根为基准、需要排除的相对路径前缀（正斜杠）
EXCLUDE_PREFIXES = [
    "server/data/img/manga",      # 2.3GB 漫画图片缓存（可重新爬取）
    "server/data/snapshots",      # 历史快照（可再生）
    "server/data/export",         # 历史导出（可再生）
    "server/data/versions",       # 历史版本（空）
]

# 根目录下要排除的开发截图 / 杂项文件
EXCLUDE_ROOT_FILES = {
    "gacha-auto.png", "gacha-page.png", "manga-157-dialog.png",
    "publish-preview.png", "t2.jpg", "fmps.zip", "desktop.ini",
    "start-all.bat",  # 旧版启动脚本（含硬编码路径），已被 启动.bat 取代
}

# 排除的文件扩展名
EXCLUDE_EXTS = {".log"}

# 单独排除的具体文件（相对路径）
EXCLUDE_FILES = {
    "server/data/proc_final.txt",
}


def norm(p):
    return p.replace(os.sep, "/")


def should_skip(rel):
    """判断相对路径是否应跳过"""
    rel = norm(rel)
    parts = rel.split("/")
    # 目录名匹配
    for d in parts[:-1]:
        if d in EXCLUDE_DIRS:
            return True
    # 前缀匹配
    for pre in EXCLUDE_PREFIXES:
        if rel == pre or rel.startswith(pre + "/"):
            return True
    # 具体文件
    if rel in EXCLUDE_FILES:
        return True
    # 根目录文件
    if "/" not in rel and rel in EXCLUDE_ROOT_FILES:
        return True
    # 扩展名
    if os.path.splitext(rel)[1].lower() in EXCLUDE_EXTS:
        return True
    return False


def main():
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # 剪枝：跳过排除目录，避免深入遍历
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        rel_dir = norm(os.path.relpath(dirpath, ROOT))
        for fn in filenames:
            rel = fn if rel_dir == "." else f"{rel_dir}/{fn}"
            if should_skip(rel):
                continue
            files.append((os.path.join(dirpath, fn), rel))

    files.sort(key=lambda x: x[1])

    total = 0
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for abspath, rel in files:
            arcname = f"{TOP}/{rel}"
            # 给 .sh 加上可执行位
            zi = zipfile.ZipInfo(arcname)
            if rel.endswith(".sh"):
                zi.external_attr = 0o755 << 16
            else:
                zi.external_attr = 0o644 << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(abspath, "rb") as f:
                data = f.read()
            zf.writestr(zi, data)
            total += len(data)
            count += 1

    size_mb = total / 1024 / 1024
    print("=" * 50)
    print("  打包完成")
    print("=" * 50)
    print(f"  输出文件: {OUT}")
    print(f"  包含文件: {count} 个")
    print(f"  原始大小: {size_mb:.1f} MB")
    print(f"  压缩包  : {os.path.getsize(OUT) / 1024 / 1024:.1f} MB")
    print("=" * 50)


if __name__ == "__main__":
    main()
