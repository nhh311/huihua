# 开源发布清单

这个仓库同时要产出两种构建：

| 构建 | 命令 | 带 453 条内置预设 | 用途 |
|---|---|---|---|
| 完整版 | `npm run build` | 是 | 内部使用，安装包约 42MB |
| 开源版 | `npm run build:open` | 否 | 对外开源分发，安装包约 4.4MB |

开源版使用 `src-tauri/tauri.open.conf.json`（`bundle.resources = []`）并启用 Cargo feature `open`：程序只从用户素材库（`%APPDATA%\绘话\presets`）或 `HUIHUA_PRESETS_DIR` 读取，不碰安装目录里的 `resources\presets`。

## 发布前必须处理

1. **移出内置预设**：`src-tauri/resources/presets/` 里有 453 条抓取自 nanobanana-ai.cn 的提示词和示例图，版权不属于本项目。开源仓库里不要保留这个目录（完整版构建时再从私有位置拷回来）。
2. **不要提交构建产物**：`src-tauri/target/`、`dist/`、`release-tauri/`、`node_modules/`。
3. **不要提交本机数据**：`%APPDATA%\绘话` 下的 `config.json`（含明文 Key）、作品、素材库都不在仓库里；确认没有把任何 Key 写进源码或测试脚本。
4. **保留 Noto/第三方声明**：`NOTICE.md`（若有）与 `docs/LIBRARY_FORMAT.md` 里的版权说明要一起带上。
5. **示例素材**：`examples/library-template/` 里的两张图是脚本生成的渐变图，不含第三方内容，可随仓库发布。

一键处理第 1、2 条：`python tools/prepare_repo.py --apply`（只移动不删除，备份到仓库外的 `<仓库名>-excluded-<时间戳>`）。

## 协议

代码以 MIT 协议开源（`LICENSE`）。`package.json` 与 `src-tauri/Cargo.toml` 的 `license` 字段同为 `MIT`。

## 开源版验证过的点

- 空状态：`这个版本不带内置素材库`，提供导入、格式规范、打开数据目录、重新读取。
- 导入：校验 `presets.json`、重算分类计数、统计缺图；再次导入整体替换并保留收藏/最近使用；失败回滚。
- 移除：删除用户库并回到空状态。
- 隔离：`--features open` 下不读取安装目录/ exe 同级的 `resources\presets`，即使机器上残留完整版素材也不会被加载。
- 安装包里 `resources\presets` 相关行数为 0；便携包只有 `绘话.exe`。

## 建议的仓库结构

```text
huihua/
  src/                    前端
  src-tauri/
    src/                  Rust
    capabilities/
    tauri.conf.json       完整版配置（包含 resources/presets）
    tauri.open.conf.json  开源版配置（resources = []）
  docs/LIBRARY_FORMAT.md
  examples/library-template/
  test/                   mock 与无头回归脚本
  package.json
  README.md
```

如果希望「默认 clone 下来就能构建」，可以把 `tauri.conf.json` 的 `bundle.resources` 也改成 `[]`，另建 `tauri.full.conf.json` 给完整版用；两种做法功能一致，只是默认值不同。
