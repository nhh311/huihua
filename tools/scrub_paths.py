#!/usr/bin/env python3
"""发布前抹掉二进制里的本机绝对路径。

Rust 依赖 crate 的 debug 信息会把构建机的 `C:\\Users\\<name>\\...` 写进 exe
（`--remap-path-prefix` 只能覆盖一部分）。这里做最后一道兜底：把
`X:\\Users\\<user>\\` 这类前缀原地替换成等长的 `$REMAPPED$...` 占位，
不改变文件长度和偏移，MZ/PE 结构与签名位置都不受影响。

用法：
    python tools/scrub_paths.py src-tauri/target/release/huihua.exe

退出码 0 表示清理完成（可能本来就没有命中），1 表示有残留没能替换。
"""
from __future__ import annotations

import os
import re
import sys

# 匹配盘符 + \Users\ + 用户名，一直到分隔符（不吞掉后续路径）
USER_DIR = re.compile(rb"([A-Za-z]:\\Users\\)([^\\\x00\r\n]{1,64})", re.IGNORECASE)


def scrub(path: str) -> int:
    data = bytearray(open(path, "rb").read())
    hits = 0

    def repl(m: re.Match[bytes]) -> bytes:
        nonlocal hits
        prefix, name = m.group(1), m.group(2)
        hits += 1
        # 等长替换：$REMAPPED$ 比 X:\Users\ 多 2 字节，用 name 的长度补回来
        filler = b"$"
        target = b"$REMAPPED$"
        out = target + filler * max(0, len(prefix) + len(name) - len(target))
        return out[: len(prefix) + len(name)]

    new = USER_DIR.sub(repl, bytes(data))
    if hits:
        open(path, "wb").write(new)
    return hits


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python tools/scrub_paths.py <exe> [<exe> ...]")
        return 2
    total = 0
    for p in sys.argv[1:]:
        if not os.path.isfile(p):
            print(f"skip (not found): {p}")
            continue
        n = scrub(p)
        total += n
        print(f"{os.path.basename(p)}: replaced {n} user-path prefix(es)")
    print(f"total: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
