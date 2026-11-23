# 构建产物安全审计（2.0.2 开源构建）

审计对象：`release-tauri/2.0.2-open/` 下的三个发布件，以及生成它们的源码树。

| 文件 | 大小（字节） | 说明 |
| --- | --- | --- |
| `绘话-2.0.2-open-Setup.exe` | 4,643,474 | NSIS 安装包 |
| `绘话-2.0.2-open.exe` | 16,215,040 | 主程序单文件 |
| `绘话-2.0.2-open-portable.zip` | 6,003,074 | 便携包，解压后只有 `绘话.exe` |

安装包 SHA256：`93E8F53D319ABAA90A4D6C43F48BED72BBA5F6DE8F74852B227FF66F189F9ADA`（与同目录 `SHA256.txt` 一致）。

## 结论速览

| 检查项 | 结果 |
| --- | --- |
| 源码里的 API Key / Token / 私钥 | **0 处** |
| 安装包与主程序里的 API Key | **0 处** |
| 构建产物的本机路径 / 用户名 | 已随发布的 exe **1,059 处**；安装包 0 处；重新构建后 **0 处**（见第二节，已修） |
| 源码里的硬编码个人信息（手机号 / 邮箱 / 个人目录） | **0 处**（命中项全部是测试 fixture） |
| 第三方版权素材 | 开源构建已排除（`bundle.resources` 为空） |

## 一、密钥

扫描方式：对仓库内 1,233 个文件做二进制正则匹配（跳过 `node_modules` / `target` / `dist` / `bundle` / `chrome-profile`），规则覆盖 `sk-…`、`ark-…`、`gh[pousr]_…`、`AKIA…`、`AIza…`、`hf_…`、`xox[baprs]-…`、JWT、`BEGIN … PRIVATE KEY`、`Bearer …` 以及 `api_key|secret|token|password = "…"` 形式的赋值。

结果：**唯一命中是 Windows 清单里的 `publicKeyToken="6595b64144ccf1df"`**（`Microsoft.Windows.Common-Controls` 的程序集标识），与密钥无关。其余规则 0 命中。

源码层的设计也印证了这一点：

- `src-tauri/src/config.rs:9-46` 的 `ProviderConf { key, base_url }`，四家供应商的 `key` 默认值都是空串；
- 默认 `base_url` 为公开接口地址（`https://api.deepseek.com`、`https://api.minimax.cn`、`https://ark.cn-beijing.volces.com/api/v3`、`https://tokenhub.tencentmaas.com`）；
- Key 由用户在引导页或设置里填写，落盘到 `%APPDATA%\绘话\config.json`；
- 源码里唯一读取的环境变量是 `src-tauri/src/presets.rs` 的 `HUIHUA_PRESETS_DIR`（外部素材库目录），与密钥无关。

## 二、构建产物里的本机路径

`绘话-2.0.2-open.exe` 里能搜到 **1,059 处** `C:\Users\<用户名>\.cargo\registry\src\index.crates.io-…\…`。来源是依赖 crate 的 debug 信息里记录的源码路径——这是 Rust 默认行为，所有未剥离的 release 构建都会带；它不含项目源码、也不含任何密钥，但会把开发机的**用户名**暴露给下载者。

安装包（`Setup.exe`）与便携 zip 里查不到这些字符串：NSIS 对载荷做了压缩。

### 已做的修复

1. `src-tauri/Cargo.toml` 增加发布档配置：

   ```toml
   [profile.release]
   strip = true
   debug = false
   ```

2. `src-tauri/src/presets.rs` 的 `root()` 里，原先 `cfg!(debug_assertions)` 运行期判断包裹着 `env!("CARGO_MANIFEST_DIR")`——这个宏在编译期就会把绝对路径写进字符串常量。现已改为编译期门控：

   ```rust
   #[cfg(all(debug_assertions, not(feature = "open")))]
   { /* 开发期回退到源码目录的 resources/presets */ }
   ```

   release 构建不再包含这段代码，`--features open` 更不会。

3. 打包时显式重映射路径：

   ```powershell
   $env:RUSTFLAGS = "--remap-path-prefix=$PWD=. --remap-path-prefix=$env:USERPROFILE=."
   npm run build:open
   ```

4. 再加一道兜底：`tools/scrub_paths.py` 在构建后原地等长替换残留的 `X:\Users\<name>\` 前缀。`npm run build:open` 与 `npm run build:portable` 已链上这一步。

### 实测效果（同一台机器，2.0.2）

| 阶段 | 主程序里的 `C:\Users\<用户名>` |
| --- | --- |
| 原始发布件 | 1,059 处 |
| 加 `strip = true` + `debug = false` | 1,059 处（这些是 debug 信息里的 crate 源码路径，不随符号表一起剥掉） |
| 再加 `--remap-path-prefix`（项目目录 + 用户目录） | 1 处（项目自身路径被替换，crate 路径只留下 `.\` 前缀） |
| 再跑 `tools/scrub_paths.py` | **0 处** |

残留的 1,058 段 `.\.cargo\registry\src\index.crates.io-…` 不含用户名，只剩依赖 crate 的名字，可以接受。

### 发布前自检（一条命令）

```powershell
python -c "import sys;d=open(sys.argv[1],'rb').read();n=b'C:'+b'\\'+b'Users'+b'\\';print('user-path hits:',d.count(n))" .\src-tauri\target\release\huihua.exe
```

期望输出 `user-path hits: 0`。若不是 0，先确认构建时带了 `RUSTFLAGS`，再补跑一次 `python tools/scrub_paths.py .\src-tauri\target\release\huihua.exe`。

## 三、个人信息

源码（`src/`、`src-tauri/src/`、`docs/`）里没有 `C:\Users\…` 形式的个人目录，也没有手机号或邮箱。`test/` 下的命中全部是自动化回归用的替身数据：

- `test/mock.js` 里的 `127.0.0.1:8123` / `localhost:8090`（本地 mock 服务）；
- `test/mock.js` 里的 `17953653246${index}-mock`（mock 作品 id，不是真实号码）；
- `test/*.log` 里的构建日志（含本机绝对路径）——**发布仓库时不要提交 `test/*.log`**。

仓库里**没有** `.env`、`*.pem`、`*.key`、凭据文件或浏览器配置目录。需要排除的还有 `test/chrome-profile/`（真实浏览器配置）与 `_audit/`（本次审计脚本）。

## 四、本机数据不在仓库里

真实的 API Key 只存在于本机的 `%APPDATA%\绘话\config.json`（明文，这是产品设计：仅本机使用）。该文件在仓库目录之外，不会被提交；`docs/OPEN_SOURCE.md` 已把它列为发布前检查项。

除 Key 外，该目录还包含 `images/`、`thumbs/`、`styles/`、`trash/`、`presets-state.json`，同样都不属于仓库内容。

## 五、第三方素材与版权

开源构建的 `bundle.resources` 为空，安装包内不含任何提示词库或示例图；`src-tauri/resources/presets/` 里的 453 条内容抓取自 nanobanana-ai.cn，版权不属于本项目，**公开仓库前必须删除或移出**。素材库格式与自带模板见 `docs/LIBRARY_FORMAT.md` 与 `examples/library-template/`。

## 六、发布前检查清单

一键预处理（只移动、不删除，可回滚）：

```powershell
python tools/prepare_repo.py           # 预演，先看会移动哪些
python tools/prepare_repo.py --apply   # 移到仓库外的 <仓库名>-excluded-<时间戳> 目录
```

手动核对清单：

- [x] `src-tauri/resources/presets/` 已写进 `.gitignore`（453 条第三方内容，38.6 MB / 902 个文件）——**push 前用 `prepare_repo.py` 把它移出工作区**，`.gitignore` 只防误提交，防不了 `git add -A` 之外的手滑；
- [x] `release-tauri/`、`src-tauri/target/`、`dist/`、`node_modules/`、`test/chrome-profile/`、`test/*.log`、`_audit/` 已写进 `.gitignore`；
- [ ] `LICENSE` 已选定开源协议（当前 `package.json` / `Cargo.toml` 仍是 `UNLICENSED`）；
- [ ] 用带 `--remap-path-prefix` 的方式重新构建，构建后跑 `tools/scrub_paths.py`，并用上面的命令确认 `user-path hits: 0`；
- [ ] 安装包与便携包的 SHA256 已重新生成并写进 Release 说明；
- [ ] 保留第三方依赖与 `NOTICE` 的版权声明。
