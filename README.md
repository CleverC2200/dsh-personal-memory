# GEA 个人记忆插件

独立插件通过 GEA Host 管理当前账号的记忆。安装后正常激活，生成开关只由服务端当前完整身份保存，首次关闭。关闭生成后已有记忆仍参与召回，插件整体停用走 Core 插件管理。凭据、Hindsight 地址和服务器模型配置由 GEA/公司网关持有。

pre-step 仅接纳本次新领取且 source.kind=user 的文字，不回扫 history、replay 或 seed。按已验证开关与版本准入后，在对应 turn/end 后串行后台提取稳定工作背景、表达偏好与工作习惯，不等待提取完成即可继续聊天。助手、工具、插件注入、附件内容、引用、假设、凭据和临时任务不进入保存。没有候选不产生条目。来源 ID 和时间取自已提交的新消息事件。

召回通过 Host 当前身份请求，只向模型追加一条带 plugin:gea-personal-memory 与 scope 的背景消息。取消或身份切换后旧结果不追加；失败继续聊天。新生成、手工维护与删除屏障的协议单一来源是同组 GEA 的 docs/memory/protocol.md 和 src/shared/memory-contract.ts。正文只存 Hindsight；本插件不保存输入副本。

源码测试使用固定 Core 的真实消息构造器，tests/agent-http.integration.mjs 还装载真实 AgentLoop、Session、插件事件、Host传输和本地公司网关，外部GEA、模型及Hindsight为HTTP合成替身。测试使用同组 ../dsh-gea-plugin 和 ../../official-latest-standard，可通过 DSH_CORE_PATH 指定本票固定Core。npm run test:integration 运行该组合验收，npm test 运行独立插件测试。该组合实际使用 Host 的持久会话账本，但不证明真实账号、服务器部署、Native 或正式发行。

## 当前账号设置页

`build:client` 编译公开 `./client` 入口，DSH 通过包元数据加载，并注册现有 `settings.section` 的“记忆与进化”。CI 先构建 client，再由 `check:package` 核对 dry-run 包包含所有声明的 exports；缺少 client 产物会失败。设置 shell、焦点锁定、Escape 与滚动归 Core。页面通过 `/api/gea-proof/memory/*` 调用 GEA Host，不持有登录凭据或 Hindsight key。开关按服务端当前身份保存，首次关闭；网络结果未知时查询原 operationId，阻止重复提交。设置列表支持搜索和三个分类。

协议的单一来源是同组 GEA 的 `docs/memory/protocol.md` 与 `src/shared/memory-contract.ts`。自动提取与召回走 Host-only 能力。编辑支持分类和内容、版本冲突重新加载、失败保留草稿，以及未知操作查询与同 ID 重试。来源由 Host 核持久会话归属与原消息存在性，再由 Core 打开会话；当前账号不可访问时只显示来源不可用。删除单条需二次确认，清空全部分类需输入“清空”，两者保持生成开关和聊天记录。清理结果未知时继续查询原操作；服务端完成后清除当前存活的文档、派生内容、含正文的异步任务和内容性元数据。备份与 WAL 不承诺即时擦除，恢复时须重放删除元数据。

浏览器验收使用固定 Core 的真实 SlotRegistry、SettingsRoot 与公共 primitive。设置 `DSH_CORE_PATH` 和 `MEMORY_UI_OUTPUT` 后执行 `node tests/build-ui-fixture.mjs`，再以相同输出目录执行 `node tests/serve-ui-fixture.mjs`。后者使用同组 GEA Host 传输和 Python 网关，GEA/Hindsight 为本地合成 HTTP 替身；它不代表真实账号、Native 装载或服务器部署通过。

会话在首次实际使用记忆时按 GEA 完整身份绑定。切账号会取消旧等待并清理页面草稿；带旧身份记忆的会话不能继续提交给新账号模型，恢复、fork 和压缩沿用同一限制。缺少可信归属的旧记忆历史拒绝认领。Core 本地历史仍可由同一 OS 用户查看。

## 来源与许可

旧试点源自 GEA 408fce84 的 plugins/personal-memory，本轮已替换旧 OV 执行合同。上游许可与来源保留在 [NOTICE.md](NOTICE.md) 和 [vendor/LICENSE](vendor/LICENSE)。本包保持 private 与 UNLICENSED，不自动发布 npm。

在合成 fixture 服务给出 URL 后，设置 MEMORY_UI_URL 与同一 MEMORY_UI_OUTPUT，运行 node --test tests/edit.browser.mjs 可验证编辑、冲突、未知回执、来源成功/失败、Escape 焦点恢复和初次读取失败文案。浏览器测试使用同组 GEA 的 Playwright 依赖。该服务只用公开 HTTP 生成合成条目，并通过 Host-only bindSession 建立合成来源绑定，没有浏览器自授 sessionId 的入口。
