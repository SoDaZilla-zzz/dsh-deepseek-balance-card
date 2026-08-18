# dsh-liquid-glass-balance-card

A draggable **liquid-glass floating card** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) **web GUI** that shows your **DeepSeek API balance**, **cumulative spend**, and **token usage**.

一个给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）**网页界面** 使用的插件：在页面右上角显示 **DeepSeek API 余额**、**累计消费** 与 **Token 用量**，采用可拖动的液态玻璃卡片。

<p align="center">Created with ❤️ by <a href="https://github.com/SoDaZilla-zzz">sooodaaa</a> · 创作者：sooodaaa</p>

<p align="center">
  <img src="docs/cover.jpg" alt="dsh-liquid-glass-balance-card cover" width="100%">
</p>

---

## 🎬 Demo / 效果演示

![Demo GIF](docs/demo.gif)

<video src="docs/demo.mp4" controls muted loop playsinline width="100%"></video>

> GIF 预览 · 完整视频见下方播放器。
>
> 完整演示：液态玻璃效果、3D 立体厚度、颜色调节、余额与用量统计、充值入口。
>
> Full demo: liquid glass, 3D thickness, color customization, balance & usage stats, and top-up entry.

---

## ✨ Features / 功能

| English | 中文 |
| --- | --- |
| Floating card in the top-right corner by default | 默认悬浮在右上角 |
| Draggable; position is remembered in `localStorage` | 可拖动，位置自动保存在浏览器 `localStorage` |
| Liquid Glass effect with adjustable parameters | 液态玻璃效果，参数可实时调节 |
| 3D thickness effect with toggle, depth and side-angle controls | 3D 立体厚度效果：可开关、调节厚度与侧向角度 |
| Custom glass color while keeping liquid glass properties | 自定义玻璃颜色，调节后仍保持液态玻璃特性 |
| Shows total balance, availability, granted & topped-up balance | 显示总余额、可用状态、赠送余额与充值余额 |
| Currency preference (CNY / USD / Auto) to avoid multi-currency conflicts | 币种偏好（人民币/美元/自动），避免多币种余额冲突 |
| Cumulative spend & cumulative tokens | 累计消费金额与累计 Token 用量 |
| Time ranges: Today / Yesterday / Last 7 days / Last 30 days / All | 时间维度：今天 / 昨天 / 近7天 / 近30天 / 全部 |
| Liquid-glass bar charts for 7d/30d spend & token trends | 近7天/近30天液态玻璃柱状图展示消费与 Token 趋势 |
| One-click DeepSeek top-up link | 一键跳转 DeepSeek 官方充值入口 |
| Manual API key input in the card settings | 支持在卡片设置中手动填写 API Key |
| Falls back to the DSH `DEEPSEEK_API_KEY` credential | 未填写手动 Key 时自动使用 DSH 已配置的 `DEEPSEEK_API_KEY` |
| Auto-refresh every 60 seconds + manual refresh | 每 60 秒自动刷新，也可手动刷新 |
| Follows DSH light/dark theme variables (`--dsw-*`) | 跟随 DSH 明暗主题变量（`--dsw-*`） |

---

## 📦 Install / 安装

Requires the DSH CLI and [pnpm](https://pnpm.io/installation).

需要 DSH CLI 与 [pnpm](https://pnpm.io/installation)。

```sh
dsh plugin --profile web add dsh-liquid-glass-balance-card
```

Restart DSH Web / 重启 DSH Web：

```sh
dsh web
```

Open http://127.0.0.1:3080 and refresh the page. The card appears in the top-right corner.

打开 http://127.0.0.1:3080 并刷新页面，右上角会出现卡片。

> Manual install / 手动安装：
> Put the package into the profile's `node_modules`, then add a loader entry to `~/.dsh/profiles/web/cordis.patch.yml`:
>
> 将包放入 profile 的 `node_modules`，并在 `~/.dsh/profiles/web/cordis.patch.yml` 中加入：
>
> ```yaml
> - insert:
>     - id: liquid-glass-balance-card
>       name: dsh-liquid-glass-balance-card
> ```

---

## ⚙️ Configuration / 配置

### API Key

Click the gear icon on the card to open settings:

点击卡片右上角的齿轮图标打开设置：

1. Paste a DeepSeek API Key and click **Save** / 粘贴 DeepSeek API Key 并点击「保存」；
2. The key is stored on the host under `$DSH_HOME/storages/dsh-liquid-glass-balance-card.json`; the browser only sees a masked value / Key 保存在宿主侧 `$DSH_HOME/storages/dsh-liquid-glass-balance-card.json`，浏览器只显示掩码；
3. Click **Clear** to remove the manual key and fall back to the DSH `DEEPSEEK_API_KEY` / 点击「清除」可删除手动 Key，之后回退使用 DSH 自身的 `DEEPSEEK_API_KEY`。

> Manual key takes priority. If neither is configured, the card shows a clear error.
>
> 手动 Key 优先于 DSH 已配置的 `DEEPSEEK_API_KEY`。若两者都没有，卡片会显示明确的错误提示。

### Liquid Glass Parameters / 玻璃效果参数

All parameters are adjustable in real time in the settings panel:

所有参数均可在设置面板实时调节：

| Parameter / 参数 | Range / 范围 |
| --- | --- |
| Transparency / 透明度 | 0% ~ 80% |
| Background blur / 背景模糊 | 0px ~ 40px |
| Saturation / 饱和度 | 100% ~ 300% |
| Highlight intensity / 高光强度 | 0% ~ 100% |
| Moving shine / 流动光线 | 0% ~ 50% |
| 3D thickness / 3D 立体厚度 | 0px ~ 40px（可开关） |
| Side angle / 侧向角度 | -30° ~ 30° |
| Glass color / 玻璃颜色 | 自定义取色器（保持液态玻璃特性） |

Settings are saved in `localStorage` and a **Reset to default** button is provided.

参数保存在浏览器 `localStorage`，并提供「恢复默认」按钮。

### Usage Statistics / 用量统计

The card shows cumulative spend and cumulative tokens with selectable time ranges:

卡片显示累计消费与累计 Token，可切换时间维度：

- Today / 今天
- Yesterday / 昨天
- Last 7 days / 近7天
- Last 30 days / 近30天
- All time / 全部

Statistics are aggregated **locally** from DSH session logs using the official DeepSeek pricing timeline. No data is sent to any third party.

统计由宿主侧**本地**聚合 DSH 会话日志，并使用 DeepSeek 官方价格时间表计价，不会向任何第三方发送数据。

---

## 🔒 Privacy / 隐私说明

- Your API key never leaves your machine. The browser only talks to local host routes.
- API Key 不会离开你的机器，浏览器只访问本地宿主路由。
- Usage statistics are computed locally from DSH session logs.
- 用量统计由本地 DSH 会话日志计算。
- No analytics, no tracking, no remote telemetry.
- 无统计、无追踪、无远程遥测。

---

## 🏗 Architecture / 工作原理

| Part / 部分 | File / 文件 | Responsibility / 作用 |
| --- | --- | --- |
| Host / 宿主侧 | `lib/index.js` | Local routes: settings, balance, stats; local aggregation from session logs / 注册本地路由：设置、余额、统计；从会话日志本地聚合 |
| Pricing / 计价 | `lib/pricing.js` | Official DeepSeek pricing timeline + peak/off-peak pricing / DeepSeek 官方价格时间表与峰谷计价 |
| Browser / 浏览器侧 | `lib/client.js` | `shell.overlay` floating card, drag, glass sliders, stats UI, recharge link / `shell.overlay` 悬浮卡片、拖动、玻璃参数、统计 UI、充值入口 |
| Composition / 组合层 | `cordis.patch.yml` | Bundle patch layer / bundle 补丁层 |

---

## 🛠 Development / 开发

```sh
git clone <your-fork>
cd dsh-liquid-glass-balance-card
# edit lib/index.js or lib/client.js, then install locally:
# 修改 lib/index.js 或 lib/client.js 后本地安装测试：
dsh plugin --profile web add .
```

After changing `lib/client.js`, restart `dsh web` and hard-refresh the page. After changing host code (`lib/index.js`), a restart is required.

修改 `lib/client.js` 后重启 `dsh web` 并强制刷新页面；修改宿主代码（`lib/index.js`）后需要重启 DSH Web。

---

## 📄 License / 协议

[MIT](./LICENSE)
