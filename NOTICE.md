# 上游复用来源

初始试点参考 OpenViking 固定提交 `2425cf41b9120bffdc83723afc9d8473a7794407`，仓库 [volcengine/OpenViking](https://github.com/volcengine/OpenViking/tree/2425cf41b9120bffdc83723afc9d8473a7794407)。Apache 2.0 许可原文保存在 `vendor/LICENSE`。

`vendor/capture.mjs` 最初来自 `examples/dsh-memory-plugin/capture.mjs`，现已改为严格原始用户输入筛选和 Core 消息构造，不保留工具、助手或旧来源捕获。未再使用的上游 capture-utils 和 input-filters 已从运行包移除，历史提交保留原文。

`vendor/recall-context.mjs` 最初摘自 `examples/memory-plugin-shared/lib/recall-core.mjs`。现使用本插件自己的记忆标记，保留背景与指令边界、嵌套标记净化和美元字符原样输出。

`index.mjs` 沿用 `agent/pre-step` waterfall 的接入方式，等待下游决定后追加记忆背景。当前生成、版本和隔离合同属于 GEA 公司网关，不调用上游 OV runtime、client、profile、commit 或 MCP。
