# 开发提示词：AI 攻略插件

把下面代码块整段复制到新 Cursor 会话。产品合同看 [ai-guide-plugin.md](./ai-guide-plugin.md)；流水线、草稿字段、验收不要在提示词里再抄一遍。

---

## 提示词

```
你在 TREK 仓库实现「AI 攻略」插件。用中文沟通。

权威顺序：仓库源码 > 方案合同 > 本提示词。读到的 API/超时/错误字符串与方案不一致时，按源码实现，并改 docs/ai-guide-plugin.md 对应句。不要为了贴合文档去改已经正确的核心代码。不要另起一套架构。

先读：docs/ai-guide-plugin.md §3–§6、§11；wiki/Plugin-Development.md（page / egress / settings）；plugin-sdk/src/index.ts；weather.rpc.ts（装饰器形状）；trips.rpc.ts 的 listMine（无用户拒绝）；MapsService.searchPlaces。不要把 trip-doctor 当 page 样板。不要引入 MediaCrawler。TripStar 只借产品流和 Cookie 规范化，不移植地理编码/搜图/签名进 TREK/server。

交付分两步，A 测通再开 B（可以同一会话，但不要并行糊在一起）。

A. 宿主 ctx.maps.search（唯一允许改的核心；可同文件加 reverseGeocode）
不要新写 geocoder，不要新 MCP tool（搜地点已叫 search_place）。按方案 §6.0：envelope + gen-plugin-facts；MapsRpc 用 actingUserId，无用户时 ForbiddenResource，lane 用 background；MapsModule + PluginsRuntimeModule；sdk 类型/运行时/mock-host；cli/ui.ts 加 maps:read；en 和每一个 locale 的 admin.ts 加 admin.plugins.perm.maps:read；rebuild shared。单测放 server/tests/unit。坐标已是 WGS-84。不要 ctx.xhs。

B. 仓库根 ai-guide/（npx trek-plugin create，type=page；不要加入根 workspaces）
合同见方案 §6.1–§6.2：两个 Cookie key 必须不同（user: xhs_cookie，instance: xhs_cookie_fallback）。采集：URL/详情降级走公开页 HTML；关键词搜索仅有 Cookie 时、且必须在当前插件进程 fetch。禁止 Playwright / spawn / jobs:run / handler return 后再 ctx.*。POST /plan 只返回 jobId，GET 分步。iframe 只 trek.invoke。Cookie 不进 iframe/日志/LLM。

API 易错：ctx.ai.extract 返回 { results }，取 results[0]；ctx.weather.get(lat, lng, date?)，不要传城市名。

测试：宿主无用户拒绝；插件 mock 覆盖 Gate、无 Cookie 降级、commit 两路径、空 Cookie 的 testXhs。禁止 CI 打小红书。除 §6.0 外不改核心。

开始前列出文件。先 A 再 B；B 里先公开页 URL，再会话搜索。
```
