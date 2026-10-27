# 上游复用来源

OpenViking 固定提交 `2425cf41b9120bffdc83723afc9d8473a7794407`，仓库 [volcengine/OpenViking](https://github.com/volcengine/OpenViking/tree/2425cf41b9120bffdc83723afc9d8473a7794407)。Apache 2.0 许可原文保存在 `vendor/LICENSE`。

| 本包文件                          | 上游路径                                                                                          | 改动                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/capture.mjs`              | `examples/dsh-memory-plugin/capture.mjs`                                                          | 原文；仅调用 `promptText` 和 `pluginMessage`                                                                                                 |
| `vendor/shared/capture-utils.mjs` | `examples/memory-plugin-shared/lib/capture-utils.mjs`                                             | 原文，满足 capture 的静态导入                                                                                                                |
| `vendor/shared/input-filters.mjs` | `examples/memory-plugin-shared/lib/input-filters.mjs`                                             | 原文，满足 capture-utils 的静态导入                                                                                                          |
| `vendor/recall-context.mjs`       | `examples/memory-plugin-shared/lib/recall-core.mjs` 的 `RECALL_CONTEXT_TEMPLATE` 与 `wrapContext` | 仅摘取纯文本包装；导出包装函数，介绍文本限定为偏好背景、明确不是指令，并删除不存在的 MCP 工具提示。保留原有嵌套 delimiter 替换与美元字符处理 |

`index.mjs` 沿用 `examples/dsh-memory-plugin/index.mjs` 的 `agent/pre-step` waterfall 接入方式，先等待 `next()`，再保留其决定并追加消息。公司运行接线只调用 GEA 的只读能力。没有导入上游 runtime、client、profile、capture 运行接线、commit、pending 队列或 MCP 挂载入口。
