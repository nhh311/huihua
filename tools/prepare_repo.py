#!/usr/bin/env python3
"""把仓库整理成"可以直接 push 到公开 GitHub"的状态。

它会做三件事（全部可回滚——只移动，不删除）：

1. 把第三方素材库 `src-tauri/resources/presets/`（453 条提示词 + 示例图，
   版权不属于本项目）移到仓库外的备份目录；
2. 把构建产物、历史发布件、浏览器配置、日志移动到同一个备份目录；
3. 打印剩下的待人工确认项（开源协议、SHA256 等）。

用法（在仓库根目录执行）：

    python tools/prepare_repo.py            # 预演，只打印将要移动什么
    python tools/prepare_repo.py --apply    # 真的移动
    python tools/prepare_repo.py --apply --backup-dir D:\\huihua-backup

备份目录默认是 `<仓库父目录>\\<仓库名>-excluded-<时间戳>`。
"""
from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
import time

# Windows 控制台默认是 GBK，这里统一成 UTF-8 并容错
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# (相对路径, 说明)
EXCLUDES: list[tuple[str, str]] = [
    ("src-tauri/resources/presets", "第三方素材库：453 条提示词与示例图，版权不属于本项目"),
    ("src-tauri/target", "Rust 构建产物"),
    ("src-tauri/gen", "Tauri 生成物"),
    ("dist", "前端构建产物"),
    ("node_modules", "npm 依赖"),
    ("release-tauri", "历史发布件与安装包（40MB+，进 Release 而不是仓库）"),
    ("test/chrome-profile", "真实浏览器配置"),
    ("_audit", "本次安全审计的临时脚本与输出"),
    (".taste-skill", "编辑器/技能工具的本地缓存"),
]

KEEP: list[tuple[str, str]] = [
    ("build/icon.ico", "installer.nsi 会引用，必须提交"),
    ("build/icon.png", "图标源文件"),
    (".cargo/config.toml", "构建配置（空 proxy 设置）"),
    ("examples/library-template", "素材库模板"),
    ("assets", "README 截图"),
    ("tools", "构建脚本"),
]


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def size_of(path: str) -> tuple[int, int]:
    """返回 (总字节数, 文件数)。"""
    if os.path.isfile(path):
        return os.path.getsize(path), 1
    total = files = 0
    for root, _dirs, names in os.walk(path):
        for name in names:
            total += os.path.getsize(os.path.join(root, name))
            files += 1
    return total, files


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的移动（默认只预演）")
    ap.add_argument("--backup-dir", default=None, help="备份到哪个目录")
    args = ap.parse_args()

    root = os.path.abspath(os.getcwd())
    if not os.path.isdir(os.path.join(root, "src-tauri")):
        print(f"看起来 {root} 不是仓库根目录（找不到 src-tauri/）。")
        return 2

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = args.backup_dir or os.path.join(
        os.path.dirname(root), f"{os.path.basename(root)}-excluded-{stamp}"
    )
    print(f"仓库: {root}")
    print(f"备份: {backup}")
    print(f"模式: {'执行移动' if args.apply else '预演（加 --apply 才真的移动）'}\n")

    if args.apply:
        # 安全检查：备份目录不能落在仓库内部
        if os.path.commonpath([backup, root]) == root:
            print("备份目录在仓库内部，拒绝执行（否则排除的文件还是会被提交）。")
            return 2
        os.makedirs(backup, exist_ok=True)

    moved = 0
    for rel, why in EXCLUDES:
        src = os.path.join(root, rel)
        if not os.path.exists(src):
            print(f"  - {rel:34s} 不存在，跳过")
            continue
        total, files = size_of(src)
        print(f"  -> {rel:34s} {human(total):>10s} / {files:>5d} 个文件   # {why}")
        if args.apply:
            dst = os.path.join(backup, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.exists(dst):
                print(f"    备份目标已存在，跳过：{dst}")
                continue
            shutil.move(src, dst)
            moved += 1

    print("\n保留（这些必须留在仓库里）:")
    for rel, why in KEEP:
        exists = "[ok]" if os.path.exists(os.path.join(root, rel)) else "[--]"
        print(f"  {exists} {rel:34s} # {why}")

    if args.apply:
        print(f"\n完成：移动了 {moved} 项到 {backup}")
    else:
        print("\n未做任何改动。确认无误后加 --apply 再跑一次。")

    print(
        "\n还需要人工处理：\n"
        "  1. LICENSE / package.json / Cargo.toml 里的 UNLICENSED -> 选定协议；\n"
        "  2. 用 docs/SECURITY.md 里的命令重新构建并确认 user-path hits: 0；\n"
        "  3. 重新生成安装包 SHA256 写进 Release 说明。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
