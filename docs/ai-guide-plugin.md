# AI 攻略插件方案

状态：**终稿**（尚未实现）。本文是产品与技术合同。实现时以**仓库源码**为准：API、超时、错误字符串和源码不一致时，按源码做，并改本文对应句，不要为了贴合文档去改已经正确的核心代码。

[ai-guide-plugin-prompt.md](./ai-guide-plugin-prompt.md) 只是开工清单（坑 + 顺序），不是第二份方案。流水线细节以本文 §7–§11 为准。

插件业务代码不进入 `client/` / `server/`，以仓库根独立目录 `ai-guide/` 开发（**不要**加入根 `package.json` 的 workspaces），经 Admin → Plugins 安装或 Dev-link 接入。

**唯一允许的核心改动：** 给插件宿主加薄 RPC `ctx.maps.search`（及可选 `maps.reverseGeocode`），内部调用现有 `MapsService`（与 MCP `search_place` / `reverse_geocode` 同源）。不要在插件里再对接一遍高德 / Google Places，也不要让插件 HTTP 打 `/mcp`。不要加 `ctx.xhs`。

小红书采集**全部放在插件进程**。对照 TripStar 的**产品流**（搜笔记 → 拉正文 → LLM 提纯地名），不是把 TripStar 或 MediaCrawler 嵌进 TREK。

---

## 1. 要解决什么

自由行规划最耗时的一步是：**把散落的攻略变成一份能在地图上改的行程**。TREK 已经能管行程、地图、按天排程；缺的是「从描述或攻略材料自动生成可写入的节点」。

本插件补这一段。生成结果必须是 TREK 里的 trip / place / day assignment，而不是一段 Markdown。

对照本机 TripStar：用户填城市和偏好后，后台自动搜小红书游记、LLM 提纯景点、再补坐标。TREK 要同一条用户路径——**不必先打开 App 复制正文**——但坐标仍走宿主地图，草稿仍先预览再写入。

原则：

- **地点不由模型发明。** LLM 只做意图解析、游记提纯和文案；POI 必须来自宿主地图检索（高德 / Google / Nominatim，由实例已有配置决定）。
- **先预览，再写入。** 与预订 AI 导入同一纪律：模型输出进草稿，用户确认后才落库。
- **走插件写行程；地图检索走宿主。** 入口用现有 `page` 类型；写回用 `ctx.trips` / `ctx.places` / `ctx.itinerary`。搜点用 `ctx.maps.search`。
- **攻略正文由插件采集。** 有目的地 + 已配置会话时默认搜笔记；用户也可贴 URL 或粘贴文字。采集失败则降级为「仅表单 + 地图检索」，不要空转失败。

---

## 2. 非目标（本次不做）

| 不做 | 原因 |
|------|------|
| 加全局悬浮球、改「创建新旅行」弹窗 | 插件目前没有这些槽 |
| 插件内再写一套高德 / Places HTTP 客户端 | 与 `MapsService` 重复；Key、坐标系、限流会分叉 |
| 插件进程 HTTP 调用 TREK `/mcp` | 子进程没有用户 Cookie；`ctx.*` 才是插件面 |
| 把小红书客户端、签名脚本、Cookie、Playwright 放进 TREK `server/` | 宿主只给出网沙箱 + 加密设置 |
| 嵌入 MediaCrawler / 其 Playwright 登录 / 评论与媒体下载 | 非商业学习许可；沙箱禁浏览器；产品只要几篇游记正文 |
| 默认爬大众点评 / 携程 / Tripadvisor | 本次只接小红书 |
| 搜图、把小红书 CDN 图写入 place | 规划器以地图针为主 |
| 让模型直接吐日程并写入 | 幻觉路线、无坐标点会污染行程 |
| 机票酒店实时比价与下单 | TREK 是规划器，不是 OTA |

---

## 3. 产品形态

| 项 | 选择 |
|----|------|
| 插件 id | `ai-guide`（须与目录名一致） |
| 类型 | `page`（顶部导航一项） |
| 图标 | `Sparkles`（lucide 已有此名） |
| `trek` 范围 | `>=4.0.0 <5.0.0`（与 `trek-plugin create` 脚手架一致） |
| `nativeModules` | `false` |
| 依赖 Addon | `llm_parsing` |
| 用户路径 | 打开插件页 → 填偏好（可选贴 URL / 正文）→ 拉游记 → 预览 → 写入新/已有行程 → `trek.navigate('/trips/' + tripId)` |

手机：同一 `page` 出现在底部导航或「更多」，同一套 iframe。

以后若宿主支持多入口，**同一流水线、同一草稿协议**，只改 manifest entries。

---

## 4. 架构

```
用户（插件 iframe）
    │  trek.invoke('/plan' | '/plan/:id' | '/commit' | '/xhs/test')
    ▼
插件路由（隔离子进程，本次 invoke 内必须跑完当前一步）
    │
    ├─ 0. 解析输入              表单 / URL / 粘贴正文
    ├─ 1. fetch_guides          小红书：关键词搜索 和/或 按 URL 拉笔记
    ├─ 2. ctx.ai.extract        意图 + 候选地名（只看见游记载荷 + 表单）
    ├─ 3. ctx.maps.search       证据列表（必须有坐标）
    ├─ 4. 聚类 + 通勤约束        按天排程（确定性代码，无 LLM）
    ├─ 5. ctx.ai.complete        每日文案（只看见证据载荷）
    ├─ 6. Publish Gate           丢掉无坐标 / 重复 / 折返过远
    └─ 7. 用户确认后
           ctx.trips.create / ctx.places.create / ctx.itinerary.assign
           ctx.meta.set；可选 ctx.weather.get(lat, lng, date)
    ▼
TREK 行程规划器（/trips/:id）
```

三层不要混：

| 面 | 谁用 | 做什么 |
|----|------|--------|
| MCP `/mcp` | 外部助手 | `search_place`、`create_trip`、… |
| 插件 `ctx` + `fetch` | 沙箱子进程 | `maps.search`、写行程、出网小红书 |
| REST `/api/maps` | 浏览器规划器 | 搜索框 |

`ctx.maps.search` **不是**新的 MCP 工具。MCP 搜地点已叫 `search_place`。插件 RPC 只是把 `MapsService.searchPlaces` 挂到 `ctx` 上。**不要**再注册 MCP tool 叫 `maps.search`。

宿主：有高德 Key 先高德（GCJ→WGS 在服务内完成），否则 Google，再否则 Nominatim。返回的 `lat`/`lng` **已经是 WGS-84**。插件不要再转坐标，不要再配地图 Key。

| MCP（外部助手） | 插件 `ctx` | 底下 | 本次 |
|-----------------|------------|------|------|
| `search_place` | **`ctx.maps.search`（待加）** | `MapsService.searchPlaces` | 要加 RPC |
| `reverse_geocode` | 可选 `ctx.maps.reverseGeocode` | `MapsService.reverseGeocode` | 可同文件加 |
| `create_trip` | `ctx.trips.create` | `TripsService` | 已有 |
| `create_place` | `ctx.places.create` | `PlacesService` | 已有 |
| assign | `ctx.itinerary.assign` | assignments | 已有 |
| `get_weather` | `ctx.weather.get(lat, lng, date?)` | `WeatherService` | RPC 已有 |

小红书 **没有** 宿主 RPC。

---

## 4.1 技术选型（已拍板）

| 层 | 用什么 | 不用什么 |
|----|--------|----------|
| 形态 | TREK `page` 插件，`definePlugin`，CJS `server/index.js` | 不新开 FastAPI/Python；不改 `*Page.tsx` |
| 脚手架 | 在仓库根 `npx trek-plugin create ai-guide --type page`，再改权限与路由 | **不要**抄 `examples/trip-doctor/`（那是 hooks-only integration，没有 page UI） |
| UI | `client/index.html` + `<!-- trek:ui -->`；iframe 只 `trek.invoke` | iframe 不 `fetch` 小红书、不读 Cookie |
| LLM | Addon `llm_parsing` → `ctx.ai.extract` / `ctx.ai.complete` | 插件不持有模型 Key |
| 地图 | `ctx.maps.search`，`lane: 'background'` | 插件不 `fetch` 高德/Google |
| 任务 | `ctx.db` + `GET` 分步 | 禁止 `jobs:run` / `ctx.scheduler`（无 acting user） |
| 出网 | 全局 `fetch`，egress 三 host | Playwright、Puppeteer、`child_process`、native addon |

**小红书采集分两层（同一插件目录）：**

1. **公开笔记页（URL / 详情降级，优先做实）。** `GET https://www.xiaohongshu.com/explore/{noteId}`，从 HTML 里的 `window.__INITIAL_STATE__` 取标题和正文（对照 TripStar SSR、MediaCrawler `extractor.py`）。粘贴 explore / discovery / xhslink 走这条。无 Cookie 也可以试；有 Cookie 只作为请求头，成功率更高。
2. **关键词自动搜索（有会话才启用）。** 用户或实例提供**本人** Web Cookie 后，插件内 Web 会话客户端搜 `{destination} {interests} 旅游 景点攻略`，取 `max_notes` 篇，再对每篇走详情（会话接口优先，失败回落到第 1 层）。产品流对照 TripStar `search_xhs_attractions`，**不是**对照 MediaCrawler 的评论/媒体/创作者爬取。

会话客户端必须跑在**当前插件 Node 进程**里（插件已经是 Node）。禁止再 `spawn`/`exec` 一个 Node 或 Python 去跑签名。禁止把 MediaCrawler 当依赖。不要在 TREK `server/` 或本文里展开请求签名字段怎么算；实现细节留在 `ai-guide/server/xhs/`。

沙箱硬限制（`server/src/nest/plugins/paths.ts`）：`--permission` 禁止文件系统写入、`child_process`、worker、native addon；子进程 `--max-old-space-size=192`。因此 **Playwright 做不了**。MediaCrawler 的扫码登录也做不了。

---

## 5. 目录与运行

```
ai-guide/                    # 仓库根，独立目录，不进 workspaces
  trek-plugin.json
  package.json               # trek-plugin-sdk 为 devDependency；runtime 由宿主注入，不要 vendor SDK
  server/index.js
  server/xhs/                # 采集：url.js（公开页）+ 可选 session 客户端
  client/index.html
  test/                      # mock-host 单测；禁止打真站
  README.md
```

对照外部项目（只借产品流，不借仓库）：

| 来源 | 可借鉴 | 不要搬 |
|------|--------|--------|
| TripStar `xhs_service.py` | 搜 → 详情 → LLM 提纯地名；Cookie 规范化；explore 页降级 | `geocode_amap`、搜图、把签名脚本拷进 TREK/server |
| MediaCrawler `media_platform/xhs` | 同一套「接口失败 → 解析 `__INITIAL_STATE__`」 | Playwright 登录、评论、下图、代理池、整仓依赖（非商业学习许可） |

本机开发：

1. 仓库根生成插件骨架（见 §4.1），不要手搓一个 hooks-only 插件
2. 实例 `.env` 设 `TREK_PLUGINS_DEV_LINK=1`
3. Admin → Plugins → Link 到 `ai-guide/`
4. 启用并同意权限（含 `maps:read`、`ai:invoke`、三个出网 host）
5. 启用 Addon **AI Parsing**，配好模型
6. 地图 Key 用实例已有配置。无 Key 时 Nominatim，国内失败要有中文说明
7. 用户在 **Settings → Plugins** 填 `xhs_cookie`；管理员可选填实例兜底 `xhs_cookie_fallback`。未配置时仍可用表单 + URL + 粘贴正文

`npx trek-plugin-sdk dev` 可先 mock；接真实行程必须 Dev-link。

---

## 6. 宿主 `ctx.maps`（本次必做的核心改动）

装饰器形状对照 `server/src/nest/weather/weather.rpc.ts`。**不要**照抄 Weather 的「无用户」模型：天气是租户无关缓存；地图 Key 跟登录用户走。无 `actingUserId` 时拒绝，对照 `trips.listMine`：

```ts
if (ctx.actingUserId === undefined) {
  throw new ForbiddenResource('map searches require an authenticated user context');
}
```

禁止插件传 `userId`。调用：

`this.maps.searchPlaces(ctx.actingUserId, query, lang, locationBias, 'background')`

### 6.0 要改的核心文件（仅此范围）

| 文件 | 改什么 |
|------|--------|
| `server/src/nest/plugins/protocol/envelope.ts` | `KNOWN_METHODS` 加 `maps.search`（及可选 `maps.reverseGeocode`）；`KNOWN_PERMISSIONS` 加 `maps:read`；`METHOD_PERMISSION` 二者都绑 `maps:read` |
| `server/scripts/gen-plugin-facts.ts` | 跑一遍，更新 `plugin-sdk/src/generated/host-facts.ts` 与 `shared/src/plugin-permissions.ts` |
| `shared/src/i18n/en/admin.ts` | 加 `'admin.plugins.perm.maps:read'`（英文）。**每个其它 locale 的 `admin.ts` 必须有同一 key**，否则 `i18n:parity:strict` 失败。`gen-plugin-facts` 只检查 `en/` |
| `plugin-sdk/src/cli/ui.ts` | `PERMISSION_FAMILIES` 的 services 组加 `maps:read`（`gen-plugin-facts` 会扫这个文件） |
| `server/src/nest/maps/maps.rpc.ts` | **新建** `MapsRpc` |
| `server/src/nest/maps/maps.module.ts` | `providers` 加入 `MapsRpc` |
| `server/src/nest/plugins/plugins-runtime.module.ts` | `imports` 加入 `MapsModule` |
| `server/src/nest/plugins/runtime/plugin-sdk.ts` | `ctx.maps.search` → RPC |
| `plugin-sdk/src/index.ts` | `PluginContext.maps.search` 类型 |
| `plugin-sdk/src/mock-host.ts` | `need('maps:read', 'maps.search')`，测试可注入结果 |
| `server/src/nest/plugins/host/plugin-audit.ts` | 可选：`maps.search` → `maps:search` |
| 宿主单测 | `server/tests/unit/nest/maps/`（或并列 `maps.rpc.test.ts`）：转发 query/bias；无 acting user 拒绝 |

然后：`npm run build --workspace=shared`（locale 变更后消费者读的是 dist）。`npm run check:plugin-facts --workspace=server` 应通过。

建议签名（插件侧）：

```ts
ctx.maps.search(
  query: string,
  opts?: {
    lang?: string;
    locationBias?: { lat: number; lng: number; radius?: number };
  },
): Promise<{ places: Array<Record<string, unknown>>; source: string }>
```

返回值与 `MapsService.searchPlaces` / MCP `search_place` 一致。只把有限数字 `lat`/`lng` 的条目当证据。

同一次交付可加 `maps.reverseGeocode`（薄封装，对齐 MCP `reverse_geocode`）。不要做 `get_place_details`。

### 6.1 插件 Manifest 权限

| 权限 | 用途 |
|------|------|
| `ai:invoke` | `ctx.ai.extract` / `ctx.ai.complete` |
| `maps:read` | `ctx.maps.search` |
| `db:own` | 任务、草稿、游记原文 |
| `db:create:trips` | 新建行程 |
| `db:read:trips` | `listMine`、`getDays` |
| `db:write:places` | 写地点 |
| `db:write:itinerary` | 挂到某一天 |
| `db:write:days` | 已有行程补天 |
| `db:read:categories` | 地点分类 |
| `db:meta` | 标记来源 |
| `weather:read` | `ctx.weather.get` |
| `http:outbound:www.xiaohongshu.com` | explore / discovery |
| `http:outbound:edith.xiaohongshu.com` | 会话搜索 / 详情（仅自动搜索需要） |
| `http:outbound:xhslink.com` | 短链；只 follow 到仍在 egress 内的最终 URL |

`egress` 与上述三 host 一致。iframe 不要直连这些 host。Cookie 只由子进程请求头带出。

**不要** `http:outbound:restapi.amap.com` / `places.googleapis.com`。

`requiredAddons`: `["llm_parsing"]`。

应用侧用户还须有 `trip_create` / `place_edit`。

### 6.2 设置（key 必须唯一）

`plugin_settings_fields` 有 `UNIQUE (plugin_id, field_key)`，**同一个 key 不能既 user 又 instance**。

| key | scope | secret | 说明 |
|-----|-------|--------|------|
| `max_days` | instance | 否 | 默认 8，上限 14 |
| `max_places_per_day` | instance | 否 | 默认 6 |
| `max_notes` | instance | 否 | 默认 4，上限 8 |
| `xhs_enabled` | instance | 否 | 默认 true；false 则不做关键词搜索（URL/粘贴仍可用） |
| `xhs_cookie` | **user** | 是 | 该用户自己的小红书 Web Cookie |
| `xhs_cookie_fallback` | instance | 是 | 家庭实例兜底；仅当用户 `xhs_cookie` 为空时使用 |

不要 `amap_key` / `google_places_key` / `poi_provider`。

Cookie 解析顺序：

```
await ctx.settings.get('xhs_cookie')  // 空 / undefined 则下一步
ctx.config.xhs_cookie_fallback
```

规范化（对照 TripStar `normalize_xhs_cookie`）：去首尾引号；JSON 数组或 `{name,value}` 对象拼成 `a=b; c=d`。禁止把 Cookie 写入日志、草稿 JSON、LLM 载荷、iframe。

Manifest `actions`：

| key | label | 作用 |
|-----|-------|------|
| `testXhs` | 测试小红书会话 | 用解析后的 Cookie 做一次最小搜索（如关键词 `旅行`）。返回 `{ ok, message }`（`PluginActionResult`）。空 Cookie → `ok: false` 中文说明 |

---

## 7. 草稿协议

UI、任务表、`/commit` 共用。

### 7.1 意图

```json
{
  "destination": "京都",
  "startDate": "2026-11-03",
  "endDate": "2026-11-07",
  "dayCount": 5,
  "pace": "relaxed",
  "interests": ["寺庙", "咖啡"],
  "mustSee": ["伏见稻荷"],
  "avoid": ["夜店"],
  "sourceText": null,
  "guideQuery": "京都 寺庙 咖啡 旅游 景点攻略"
}
```

`pace`: `relaxed` | `balanced` | `packed`。有起止日期时以日期为准，忽略 `dayCount`。`guideQuery` 由代码拼接。

### 7.2 攻略原文

```json
{
  "id": "g_1",
  "noteId": "64f…",
  "title": "京都五天不赶路",
  "url": "https://www.xiaohongshu.com/explore/64f…",
  "text": "第一天东山……",
  "via": "search"
}
```

`via`: `search` | `url` | `paste`。单篇 `text` 截断约 4000 字；交给 `ctx.ai.extract` 的 **text 合计 ≤ 12000 字**（宿主 `ai.extract` 上限 20000，须留余量给 schema/prompt）。预览**不展示** `text`。

### 7.3 证据点

```json
{
  "id": "ev_1",
  "name": "伏见稻荷大社",
  "lat": 34.9671,
  "lng": 135.7727,
  "address": "…",
  "placeId": "ChIJ…",
  "osmId": null,
  "provider": "amap",
  "categoryHint": "sight",
  "source": "poi_search",
  "fromGuideIds": ["g_1"],
  "stayHintMinutes": 90,
  "reservationHint": "可能需要提前预约"
}
```

`lat`/`lng` 为 WGS-84。`provider` 填 `maps.search` 返回的 `source`。无坐标不得排程、不得 commit。

### 7.4 预览草稿

```json
{
  "jobId": "…",
  "status": "ready",
  "intent": {},
  "guides": [{ "id": "g_1", "title": "京都五天不赶路", "url": "…", "via": "search" }],
  "warnings": ["「某某小店」无法匹配坐标，已跳过"],
  "days": [
    {
      "date": "2026-11-03",
      "title": "东山半日",
      "notes": "节奏偏松，预留走路时间",
      "places": [
        {
          "evidenceId": "ev_1",
          "name": "伏见稻荷大社",
          "lat": 34.9671,
          "lng": 135.7727,
          "placeId": "ChIJ…",
          "categoryHint": "sight",
          "stayMinutes": 90,
          "notes": "建议清晨，避开人流"
        }
      ]
    }
  ]
}
```

`status`: `queued` | `running` | `ready` | `failed`。`failed` 带 `error`，不写行程库。

### 7.5 写入请求

```json
{
  "jobId": "…",
  "mode": "new_trip",
  "tripId": null,
  "title": "京都五日"
}
```

`mode`: `new_trip` | `existing_trip`。`existing_trip` 必须带用户可编辑的 `tripId`。草稿天数多于行程时 `ctx.days.create`；草稿更短则只填前 N 天并在响应说明。

---

## 8. 路由与任务

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/plan` | 写入 queued 任务，立刻返回 `{ jobId }` |
| `GET` | `/plan/:jobId` | 推进**一步**并返回状态/草稿 |
| `POST` | `/commit` | `ready` 草稿写入 TREK |
| `POST` | `/plan/:jobId/cancel` | 可选 |
| `POST` | `/xhs/test` | 与 `actions.testXhs` 同一探测 |

任务在 `ctx.db`，按用户隔离，建议 24h 后清理。commit 后可删 `text`，meta 只留 noteId/url。

阶段：`parse_intent` → `fetch_guides` → `gather_evidence` → `schedule` → `write_copy` → `gate` → `ready`。

宿主默认 route invoke 约 30s。禁止 handler `return` 后再 `ctx.*`。禁止 `jobs:run`。

每次 GET：

- `fetch_guides`：第一次解析 URL 列表和/或关键词搜索；之后每次只拉 **1** 篇详情
- `gather_evidence`：每次最多 3 次 `maps.search`
- 其余阶段：一次 GET 跑完该阶段

`ctx.ai` 每日 200 次（`complete`+`extract` 合计）：全程 extract **一次**、complete **一次**。

`ctx.ai.extract(text, jsonSchema, prompt?)` 返回 **`{ results: Record<string, unknown>[] }`**，取 `results[0]`。不要当成单个对象。`text` 空字符串会被宿主拒绝。

---

## 9. 流水线细则

### 9.0 输入（可叠加）

| 模式 | 用户做什么 | 插件做什么 |
|------|------------|------------|
| 自动搜索 | 填目的地，可选兴趣 | `xhs_enabled` 且解析到 Cookie：搜 `guideQuery`，取 `max_notes` 篇 |
| URL | 1～`max_notes` 条链接 | 解析 noteId，走公开页（失败再试会话详情） |
| 粘贴正文 | 从 App 复制 | `via: paste` 一篇 guide |
| 仅表单 | 只填目的地 | 无笔记；按兴趣 `maps.search` |

URL：`xiaohongshu.com/explore/{id}`、`/discovery/item/{id}`；`search_result?keyword=` 抽出词走搜索；`xhslink.com` follow 且最终 host 仍在 egress。`noteId` 约 24 位 hex，去重。

无 Cookie 时：**不要**把自动搜索标成整单失败；URL 公开页和表单检索继续。warning 说明可去设置填 Cookie。

### 9.1 意图

表单字段优先。目的地为空且只有 URL/正文时，等 `fetch_guides` 之后由 extract 猜 `destination`。

`guideQuery`：`[destination] [interests] 旅游 景点攻略`；兴趣空则用 `景点`。

### 9.2 `fetch_guides`

全部 `fetch` + 串行 + 间隔 300–800ms；单篇超时 15s。禁止并发搜索。

- 搜索：只要 `model_type === note`（或等价笔记条目）。
- 详情：会话接口优先；失败则公开页 `__INITIAL_STATE__`。两者都空则 warning 该篇。
- 会话风控/过期：warning「会话不可用，已跳过自动搜索」；有目的地则继续表单路径。`testXhs` 可以明确失败让用户换 Cookie。
- 不要拉评论、主页、私信、图片二进制。

### 9.3 extract

有 guides 时一次抽出 intent + candidates：

```json
{
  "intent": {},
  "candidates": [
    {
      "name": "伏见稻荷大社",
      "nameZh": "伏见稻荷大社",
      "reason": "建议清晨避开人流",
      "durationMinutes": 90,
      "reservationRequired": false,
      "reservationTips": "",
      "dayHint": 1,
      "guideId": "g_1"
    }
  ]
}
```

只提正文里出现的地点；此步**不要**坐标。无 guides 时只做意图 + 表单查询词。

### 9.4 证据

1. `maps.search(destination)` 第一条有坐标的结果作 `locationBias`
2. 兴趣 / `mustSee` / 候选 `nameZh`（否则 `name`）再搜，上限 `max_days * max_places_per_day`
3. 候选上的 reason / 预约 / 时长挂到匹配证据上

模型发明的店名若不在证据里，Gate 丢掉。

### 9.5 排程（无 LLM）

地理聚类；单日点数；直线距离通勤；`mustSee` 优先；`dayHint` 弱约束（与距离冲突时以距离为准）；`relaxed` 减少每天点数。`stayMinutes` 用候选时长，缺省景点 90 / 餐饮 75。

### 9.6 文案

`complete` 只能用载荷里的店名；禁止编价格/开放时间/班次；可用 reason/预约提示改写成 notes。

### 9.7 Gate

无坐标 / 同名同坐标重复 / 单日相邻直线 > 40 km / 超上限 → warning 或截断。零有效点 → `failed`，禁止 commit。

### 9.8 Commit

1. `new_trip`：`ctx.trips.create({ title, start_date, end_date, day_count })`（服务会建 days）。`existing_trip`：缺天 `ctx.days.create`，禁止删原行程。
2. `ctx.trips.getDays(tripId)`
3. 每点 `places.create` → `itinerary.assign`
4. 可选：该日中心点或第一点的 `lat`/`lng` 调 `ctx.weather.get(lat, lng, date)` 写一句进 day notes（**不要传城市名**；失败跳过）
5. `ctx.meta.set('trip', tripId, 'ai-guide.jobId', jobId)`；可选 noteId/url
6. 返回 `{ tripId }`，前端 `trek.navigate('/trips/' + tripId)`

中途失败列出已创建 placeId。`new_trip` 且零成功点可删空行程。AI 日额度耗尽 → `failed`，文案「AI 日额度已用完（UTC 零点重置）」。

---

## 10. 插件 UI

`<!-- trek:ui -->`，`surface` 为 `plugin-page`。

1. 目的地、日期或天数、节奏、兴趣；链接框；粘贴框
2. 未配置 Cookie 时提示，链到宿主插件设置（Cookie 输入框**不要**做在 iframe）
3. 新行程或 `listMine` 选择
4. 进度（含已读笔记 n/m）
5. 来源标题（CSP 可能禁外链，做不到可点则只展示 URL）；按天预览；warnings
6. 生成 / 写入（防重复）。失败中文错误

主题跟随 `trek.onContext`。

---

## 11. 本次一次做完 vs 不做

同一条流水线一次交付：表单、自动搜索（有 Cookie）、URL 公开页、粘贴正文、预览、写入新/已有行程、按日天气。

**做完：**

- 宿主 `ctx.maps.search`（可选 reverseGeocode）+ `maps:read` 的 facts、**en + 全部 locale** 文案、cli ui
- page 插件骨架、权限、egress、分步 GET
- 公开页拉笔记 + 有 Cookie 时关键词搜索；extract 只提纯地名
- Cookie：`xhs_cookie` user + `xhs_cookie_fallback` instance；`testXhs`
- commit 两条路径；weather 按坐标；mock 测试

**不做：** 点评/携程、搜图、FAB、`ctx.xhs`、Playwright、MediaCrawler、核心里加入口。

---

## 12. 测试

**宿主**（`server/tests/unit`）：`maps.search` 把 query/bias/lane 交给 `MapsService`；无 acting user → `ForbiddenResource`；无 `maps:read` 的 mock 调用失败。

**插件**（`ai-guide/test`，`createMockHost`）：Gate；零点不能 commit；夹具游记未匹配进 warnings；无 Cookie 仍能出表单预览；new_trip 调了 create/assign；existing_trip 不删原行程；`testXhs` 空 Cookie 失败；extract 使用 `results[0]`。夹具 HTML/JSON，禁止 CI 访问小红书。

---

## 13. 风险

| 风险 | 处理 |
|------|------|
| 幻觉地点 | 证据 + Gate |
| 地图配额 | 已有 Key、`background`、点数上限 |
| AI 200/日 | extract 一次 + complete 一次 |
| ToS / 风控 | 本人会话、限条数、失败降级、出网需同意 |
| Cookie 泄露 | secret；不进日志/LLM/iframe |
| 版权 | 预览不展示全文；到期删 text |
| 坐标系 | 只信宿主 WGS-84 |
| 签名变更 | 只更新插件目录 |
| 沙箱 | 不引入浏览器；控制依赖体积（192MB） |

---

## 14. 验收

1. 启用后顶部导航出现「AI 攻略」。
2. 「京都、5 天、偏轻松」+ 可用会话：进度有搜索/读笔记，预览带来源标题和带坐标日程。
3. 无会话：同一表单仍能出带坐标预览，并提示可填 Cookie 或贴链接。
4. 粘贴 explore / xhslink：能抽点；搜不到的店只在 warnings。
5. 粘贴含店名正文：同上。
6. 确认后写入新行程或已有行程；规划器地图针与底图对齐。
7. 无坐标点不进行程。
8. 关闭 `llm_parsing` 时失败且中文说明。
9. 设置页「测试小红书会话」：空/失效有中文原因。

---

## 15. 实现时不要做的事

- 不要改 TREK `*Page.tsx` 加入口。
- 不要把 LLM 输出直接当 place 名写入。
- 不要移植 TripStar 地理编码/搜图，或 MediaCrawler 整仓。
- 不要 Playwright / `child_process` / native addon。
- 不要在插件里 `fetch` 地图 API，不要 HTTP 打 `/mcp` 或 `/api/maps`。
- 不要 FAB / 多 type；一个 `page`。
- 除 §6.0 外不要改核心。不要 `ctx.xhs`。
- 不要两个 settings 共用 key `xhs_cookie`。
- 不要用 `jobs:run`。不要 handler 返回后再 `ctx.*`。
- 不要并发轰炸搜索；不要 follow 到 egress 外。
- 不要把 `ai-guide` 加进根 workspaces。
