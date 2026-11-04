# Agent Activity · Flow

Status: Direction approved, not yet implemented.
The user approved the Flow direction on 2026-11-04, shown in `docs/mockups/agent-activity/flow.html`.
The agent decided the remaining details, as the user asked ("cứ check, tự quyết định là được").

## Mục tiêu

Paseo mặc định thu gọn block tool và reasoning, nên khi agent đang chạy người dùng không biết nó đang làm gì nếu không bấm mở.
Claude Code, Codex và OMP lại thể hiện hoạt động mỗi cái một kiểu.
Plugin thay hiển thị mặc định của tool call và reasoning bằng một dòng chảy hoạt động:
- mỗi bước luôn có icon và nhãn hành động;
- các bước nằm đúng chỗ chúng xảy ra trong timeline;
- người dùng chọn mức chi tiết một lần cho cả timeline;
- pill ở composer luôn nói agent đang làm gì.

Người dùng là chính tác giả, chạy agent Claude Code, Codex và OMP trên Paseo local.

## Tiêu chí chấp nhận

- Trong lúc agent chạy, người dùng biết nó đang làm gì mà không cần bấm, kể cả khi đang cuộn lên đọc phần trước.
- Mọi bước luôn hiện icon và nhãn hành động (Thinking, Reading, Running…) ở mọi mức chi tiết.
- Các bước hiện ở đúng vị trí thời gian của chúng, giữa các câu trả lời, không bị gom lên đầu turn.
- Người dùng xem được chi tiết của cả timeline bằng một thao tác, không phải mở từng bước.
- Bước lỗi nhìn thấy được mà không cần mở, kể cả ở mức chi tiết gọn nhất.
- Cùng loại hoạt động dùng cùng icon và cùng nhãn, bất kể provider.
- Gỡ hoặc tắt plugin thì Paseo trở về hiển thị mặc định.
- Plugin cài được bằng `paseo plugin install` và lên trạng thái `running` không lỗi.

## Ràng buộc

- Chỉ một plugin.
- Chỉ dùng React Native primitives.
- `requirements.paseo` phải bao gồm Paseo 0.13.x.
- Không cần service từ xa và không ghi gì vào daemon.

## Bằng chứng nền

Các nguồn sau đã được kiểm tra ngày 2026-11-04.

- Daemon local là Paseo `0.15.0`; bản `@getpaseo/plugin` mới nhất trên npm cũng là `0.15.0`.
  `requirements.paseo` chọn `>=0.13.0` để bao cả 0.13.x và 0.15.
- `addTimelineTransformer` nhận `{ item, phase }` với `phase: "streaming" | "complete"`.
  Kết quả `undefined` giữ nguyên item, `items` thay thế item, `[]` xóa item.
  Transformer phải đồng bộ và tất định, và chỉ thấy từng item một.
- `addTimelineRenderer` vẽ một `kind`/`version` sau khi validate `data` bằng Zod.
  Props gồm `agentId`, `item`, `timestamp`, `theme`, `host`, `layout` và không có `phase`, nên `phase` phải đi qua `data`.
- Identity của component lấy từ source item, nên state giữ nguyên khi item chuyển từ streaming sang complete.
- Paseo đã chuẩn hóa tool của mọi provider thành `ToolCallDetail.type`: `shell`, `read`, `edit`, `write`, `search`, `fetch`, `sub_agent`, `plan`, `plain_text`, `worktree_setup`, `unknown`.
  Trạng thái tool là `running`, `completed`, `failed`, `canceled`.
- `usePaseo()` trả về `PaseoApi` của `@getpaseo/client`, trong đó `agents.ref(id).timeline` có `subscribe()` (chỉ sự kiện live) và `refetch()` (tải một trang timeline).
  Điều này đọc từ type của `@getpaseo/client` trong `usage-pill/node_modules`, chưa chạy thử.
- `addComposerPill` thêm một nút theo agent vào thanh composer và cập nhật được qua `update()`.
- `@getpaseo/plugin/client/ui` từ 0.13.0 có `Icon`, `StreamedText`, `Markdown` và `copyText`.
- Transformer chạy trước khi Paseo nhóm tool trong Overview, nên thay `tool_call` có thể làm mất nhóm tool mặc định.

## Quyết định 1 · Activity type và nhãn hành động

Phân loại theo `detail.type` do Paseo chuẩn hóa, không theo tên tool của provider.
Tên tool chỉ dùng làm fallback cho `unknown` và `plain_text`.
Nhãn là động từ: thì hiện tại khi bước đang chạy, thì quá khứ khi đã xong, lỗi hoặc bị hủy.

| Activity | Nhãn chạy / xong | Icon (Lucide) | Nguồn | Đích | Meta |
| --- | --- | --- | --- | --- | --- |
| `read` | Reading / Read | `FileText` | tool `read` | đường dẫn rút gọn | `N lines` |
| `edit` | Editing / Edited | `FilePen` | tool `edit` | đường dẫn rút gọn | `+X −Y` đếm từ diff |
| `write` | Writing / Wrote | `FilePlus` | tool `write` | đường dẫn rút gọn | `N lines` |
| `run` | Running / Ran | `SquareTerminal` | tool `shell`, `worktree_setup` | dòng đầu của lệnh, cắt 80 ký tự | `exit N` khi khác 0 |
| `search` | Searching / Searched | `Search` | tool `search` khác `web_search` | query, kèm `grep`/`glob` | `N files · N matches` |
| `web` | Fetching / Fetched | `Globe` | tool `fetch`, `search` với `web_search` | host + path hoặc query | `HTTP code` / `N results` |
| `delegate` | Delegating / Delegated | `Bot` | tool `sub_agent` | description | `N actions` |
| `plan` | Planning / Planned | `ListChecks` | tool `plan` | dòng đầu của plan | — |
| `tool` | Calling / Called | `Wrench` | tool `unknown`, `plain_text` | label hoặc tên tool; MCP `mcp__srv__fn` hiện `srv · fn` | — |
| `think` | Thinking / Thought | `Brain` | item `reasoning` | ở mức Brief không có; ở Steps là dòng đầu của suy nghĩ | — |

Mỗi activity thuộc một pha, dùng để gom và gắn nhãn pha:

| Pha | Activity |
| --- | --- |
| Explore | `think`, `search`, `read`, `web`, `delegate`, `tool`, `plan` |
| Change | `edit`, `write` |
| Verify | `run` |

Quy tắc chung:

- Đường dẫn rút gọn là hai segment cuối, ví dụ `utils/date.ts`; đường dẫn đầy đủ nằm trong phần chi tiết.
- Tool `failed` giữ activity của nó, đổi trạng thái sang lỗi và hiện meta `exit N` hoặc `failed`.
- Plugin không biến đổi `user_message`, `assistant_message`, `todo`, `compaction`, `error`, `notification` và item `plugin`, nên các item này giữ hiển thị mặc định của Paseo.
  Câu trả lời của agent và lỗi của turn vì thế vẫn hiển thị như cũ và luôn đọc được.
- Trạng thái gồm `running`, `done`, `failed`, `canceled`.
  Với reasoning, trạng thái suy từ `phase`.

## Quyết định 2 · Đoạn bước và mức chi tiết

Một **đoạn** là chuỗi các item liên tiếp do plugin vẽ (tool call và reasoning), bị ngắt bởi bất kỳ item nào khác, thường là câu trả lời của agent hoặc tin nhắn người dùng.
Đoạn luôn hiện ở vị trí của item đầu tiên trong nó.

Có ba mức chi tiết, áp dụng cho mọi turn của mọi agent:

| Mức | Một đoạn hiện thành |
| --- | --- |
| Brief (mặc định) | một dòng bọc nhiều hàng: các nhóm pha nối bằng `›`, mỗi nhóm có nhãn pha rồi các chip `icon + nhãn + đích + meta` |
| Steps | đầu đoạn `N steps · thời lượng`, rồi nhãn pha mỗi khi pha đổi, rồi một hàng cho mỗi bước: icon, nhãn ở cột riêng, đích, meta, trạng thái |
| Full | như Steps, thêm phần chi tiết của mọi bước được mở sẵn |

- Ở mức Brief, các bước `read` hoặc `edit` liên tiếp đã xong được gộp thành một chip, ví dụ `Read 2 files`.
- Chip đang chạy có viền và nền nhạt, kèm thời gian đã chạy và spinner.
- Chip lỗi màu lỗi, có meta `exit N` và icon ✕; chip bị hủy có đích gạch ngang và icon ⊘.
- Chạm vào dòng Brief mở riêng đoạn đó ở mức Steps; chạm đầu đoạn ở mức Steps hoặc Full thu đoạn đó về Brief.
- Ở mức Steps, chạm một hàng mở hoặc đóng phần chi tiết của bước đó; ở mức Full, chạm để đóng.
- Đổi mức chi tiết xóa mọi lựa chọn mở hoặc đóng riêng trước đó, để cả timeline đúng một mức.
- Lựa chọn riêng theo đoạn và theo bước không được nhớ qua lần tải lại.

Phần chi tiết của một bước:

| Activity | Chi tiết |
| --- | --- |
| `run` | cwd, tên tool gốc, rồi output monospace; khi đang chạy hiện 12 dòng cuối, khi xong hiện 40 dòng đầu kèm `… N more lines`, rồi khối lỗi nếu có |
| `edit` | đường dẫn đầy đủ, tên tool gốc, unified diff tô màu `+`/`−`, tối đa 60 dòng |
| `write`, `read` | đường dẫn đầy đủ, tên tool gốc, 20 dòng đầu của nội dung |
| `search` | danh sách file hoặc kết quả, tối đa 20 dòng |
| `web` | URL hoặc query và tiêu đề kết quả |
| `delegate` | description và danh sách actions |
| `think` | toàn văn qua `StreamedText` |
| `tool`, `plan` | text hoặc JSON rút gọn của input/output, tối đa 20 dòng |

Transformer cắt dữ liệu về khoảng 8 KB cho mỗi trường chi tiết.

## Quyết định 3 · Pill ở composer

Plugin thêm hai composer pill cho mỗi agent, nằm trước các pill có sẵn.

**Pill theo dõi** luôn nói agent đang làm gì:

| Trạng thái | Nội dung |
| --- | --- |
| Có bước đang chạy | icon của bước, nhãn pha, nhãn hành động, đích, thời gian đã chạy, spinner |
| Agent đang trả lời | icon `MessageSquare`, `Answering`, thời gian |
| Turn đang chạy nhưng chưa có bước nào chạy | spinner, `Working` |
| Agent rảnh | icon check, `Done`, số bước, số bước lỗi nếu có, thời lượng turn |

- Khi nhiều bước chạy song song, pill hiện bước bắt đầu sau cùng.
- Chạm pill cuộn timeline tới bước đang chạy và nhấp nháy nó một lần, nếu Paseo cho plugin cuộn timeline; nếu không, chạm pill không làm gì.

**Pill Detail** hiện `Detail · Brief` (hoặc `Steps`, `Full`); chạm để chuyển Brief → Steps → Full → Brief.
Mức chi tiết được nhớ qua lần tải lại nếu plugin có chỗ lưu cục bộ; nếu không, mỗi lần mở app bắt đầu từ Brief.

## Hành vi chi tiết

Vòng đời một bước:

1. Bước bắt đầu: ở Brief, chip mới xuất hiện cuối dòng của đoạn với nhãn thì hiện tại; ở Steps, một hàng mới xuất hiện với nền nhạt; ở Full, hàng mở sẵn phần chi tiết và output tăng dần.
   Pill theo dõi chuyển sang bước này.
2. Bước xong: nhãn chuyển sang thì quá khứ, meta cập nhật, spinner đổi thành trạng thái.
3. Bước lỗi: chip hoặc hàng chuyển màu lỗi kèm `exit N`; nhãn pha của nhóm đó cũng chuyển màu lỗi.
4. Bước bị hủy: đích gạch ngang, trạng thái ⊘.

Trường hợp biên:

- Nhiều tool chạy song song: mỗi tool là một chip hoặc hàng riêng, cùng chạy và xong độc lập.
- Câu trả lời giữa hai nhóm bước ("Giờ tôi sẽ sửa file…") ngắt đoạn, nên nhóm sau là một đoạn mới ngay dưới câu trả lời đó.
- Người dùng cuộn lên đọc: timeline không tự kéo xuống; pill theo dõi vẫn cập nhật.
- Tải lại trang hoặc mở lại agent: mọi đoạn hiện theo mức chi tiết hiện tại.
- Lệnh nhiều dòng: đích chỉ lấy dòng đầu khác rỗng và thêm `…`.
- Đích rỗng: đích là tên tool.
- Reasoning rỗng hoặc chỉ có khoảng trắng: transformer trả `[]`.
- `classify` gặp dữ liệu lạ: hàm bắt lỗi và trả `undefined`, nên item giữ hiển thị mặc định của Paseo.
- Chưa đọc được timeline của agent (đang tải, lỗi kết nối, API không có): ở mức Brief, mỗi bước tự vẽ một dòng chip riêng thay vì gộp theo đoạn; mức Steps và Full không bị ảnh hưởng.
- Plugin bị tắt, gỡ hoặc lỗi: timeline vẽ lại bằng hiển thị mặc định và pill biến mất.
- Theme sáng/tối và theme khác: mọi màu lấy từ `theme.colors`.
- Compact layout: dòng Brief bọc nhiều hàng, cột nhãn ở Steps hẹp lại, pill theo dõi chiếm trọn một hàng của composer.

Hành vi không đổi:

- Tin nhắn người dùng, câu trả lời của agent, lỗi, todo, compaction, notification và item của plugin khác giữ hiển thị mặc định.
- Ctrl/Cmd+F vẫn tìm thấy nội dung tool và reasoning, vì Paseo khớp theo item gốc.
- Permission request vẫn do Paseo hiển thị; bước đang chờ quyền vẫn ở trạng thái running.

## Hợp đồng dữ liệu

`shared/activity.ts` định nghĩa schema Zod sau, renderer validate `data` bằng schema này:

```ts
const activity = z.enum(["read", "edit", "write", "run", "search", "web", "delegate", "plan", "tool", "think"]);
const status = z.enum(["running", "done", "failed", "canceled"]);
const body = z.object({
  kind: z.enum(["mono", "diff", "stream"]),
  text: z.string(),
  hiddenLines: z.number().int().nonnegative().optional(),
});
export const activityStepSchema = z.object({
  activity,
  status,
  target: z.string(), // ≤120 chars
  meta: z.string().optional(),
  details: z.array(z.object({ label: z.string(), value: z.string() })).optional(), // cwd, full path, URL, raw tool name
  body: body.optional(),
  errorText: z.string().optional(), // ≤2000 chars
  startedAt: z.string().optional(), // ISO, for elapsed time
});
```

- `status` của reasoning là `running` khi `phase` là `streaming`, còn lại là `done`.
- Nhãn, icon, pha và màu suy từ `activity` và `status` trong renderer, không nằm trong data.

## Kiến trúc

Plugin id là `agent-activity`, chỉ có client entry.

```text
agent-activity/
  paseo-plugin.json         # { "id": "agent-activity", "requirements": { "paseo": ">=0.13.0" } }
  package.json, tsconfig.json, README.md
  index.client.tsx          # registers transformers, renderer, composer pills; returns cleanup
  shared/activity.ts        # Zod schema, activity/status enums
  client/classify.ts        # pure: item + phase -> step data or undefined
  client/classify.test.ts   # node --test
  client/activity-meta.ts   # activity -> verbs, Lucide icon, phase
  client/segments.ts        # pure: ordered timeline items -> segments; first-item lookup
  client/segments.test.ts   # node --test
  client/agent-timeline.ts  # per-agent store: refetch + subscribe, shared by renderer and pills
  client/detail-level.ts    # shared store for Brief/Steps/Full
  client/step-view.tsx      # renderer: Brief line, Steps rows, Full bodies
  client/step-bodies.tsx    # detail bodies: mono, diff, stream
  client/composer-pills.tsx # follow pill and Detail pill
  e2e/                      # Playwright per project-runtime.md
```

Đăng ký trong `index.client.tsx`:

| Transformer id | `query.itemType` | Kết quả |
| --- | --- | --- |
| `activity-tool` | `tool_call` | một item `activity-step` theo bảng activity |
| `activity-think` | `reasoning` | một item `activity-step` với `think`, hoặc `[]` khi rỗng |

Renderer duy nhất là `kind: "activity-step"`, `version: 1`, `schema: activityStepSchema`.

Cách vẽ đoạn:

- Mức Steps và Full: mỗi item tự vẽ hàng của mình; item đầu đoạn vẽ thêm đầu đoạn và mỗi item vẽ nhãn pha khi pha khác item trước.
- Mức Brief: `agent-timeline.ts` giữ danh sách item theo thứ tự cho `agentId`; `segments.ts` cho biết item hiện tại có là item đầu đoạn không.
  Item đầu đoạn vẽ cả dòng Brief của đoạn; các item còn lại của đoạn vẽ rỗng.
- Nếu store chưa có dữ liệu, mỗi item vẽ dòng Brief của riêng nó.

State trong renderer:

```ts
const level = useDetailLevel();                       // "brief" | "steps" | "full"
const segmentLevel = segmentOverride ?? level;        // per-segment tap, reset when level changes
const bodyOpen = manual ?? segmentLevel === "full";   // per-step tap, reset when level changes
```

## Style

Hướng đã chốt là **Flow**, mockup tương tác ở `docs/mockups/agent-activity/flow.html`.
`index.html` (card A/B/C) và `concepts.html` (7 ý tưởng) là các vòng thăm dò trước, giữ làm lịch sử quyết định.

- Nhãn hành động luôn dùng chữ đậm vừa (500) màu `foreground`; đích và meta dùng `foregroundMuted`.
- Đích là đường dẫn, lệnh hoặc query thì dùng monospace; đích là văn xuôi (think, delegate, plan) dùng font UI.
- Nhãn pha nhỏ, đậm, màu `foregroundMuted`; chuyển `foreground` khi pha đang chạy và `statusDanger` khi pha có bước lỗi.
- Chip và hàng đang chạy dùng nền `accent` rất nhạt và viền `accent`; chữ vẫn là `foreground`, vì `accent` mặc định (#20744A) quá tối để làm màu chữ trên theme tối.
- Chỉ dùng 11 màu của `PluginTheme.colors`.
- Trạng thái không chỉ dựa vào màu: luôn có spinner, check, ✕ hoặc ⊘, và lỗi luôn có meta.
- `Pressable` có `accessibilityRole="button"`, `accessibilityState={{ expanded }}` và label dạng "Ran npm test, done, collapsed".

## README của plugin

`agent-activity/README.md` theo mẫu của repo: prerequisites (Paseo `>=0.13.0`, `pluginsEnabled`), install, update, verify (chạy một turn có đọc, sửa, chạy lệnh; quan sát dòng Brief, pill theo dõi và đổi mức chi tiết), troubleshoot (`paseo plugin ls`, `paseo plugin logs`, console `[Plugins] Timeline transformer failed`), remove.

## Kiểm chứng

- `npm run typecheck` trong `agent-activity/`.
- `node --test` cho `classify.ts` và `segments.ts`, với fixture cho mỗi `detail.type`, mỗi status, reasoning rỗng, lệnh nhiều dòng, output quá dài, dữ liệu lạ, đoạn bị câu trả lời ngắt và tool song song.
- Runtime E2E bằng Playwright trên daemon E2E cô lập theo `.claude/skills/runtime-e2e-test/references/project-runtime.md`, với mỗi provider có sẵn:
  - Bước đầu tiên: đo xem item vẽ rỗng có còn chiếm khoảng cách giữa các item không; nếu có, ghi lại và chọn cách khác cho mức Brief trước khi làm tiếp.
  - Prompt chạy `sleep 8 && echo done`: khi đang chạy, pill theo dõi hiện `Running sleep 8 && echo done` và chip Running hiện trong timeline; khi xong, chip hiện `Ran` kèm check.
  - Prompt đọc và sửa một file: nhãn Read và Edited giống nhau trên mọi provider; Edited có meta `+X −Y`.
  - Đổi Detail qua Brief → Steps → Full: mọi đoạn đổi theo; chạm một đoạn chỉ đổi đoạn đó.
  - `paseo plugin disable agent-activity` trên daemon E2E thì timeline trở về mặc định và pill biến mất; `enable` thì quay lại.
  - Chụp ảnh desktop và compact, theme sáng và tối.

## Giả định và chỗ chưa chắc

- Item vẽ rỗng có thể vẫn chiếm khoảng cách giữa các item của timeline; mức Brief phụ thuộc vào điểm này và phải đo đầu tiên.
- `timeline.subscribe()` và `refetch()` mới xác nhận qua type, chưa chạy thử trong plugin; `subscribe()` chỉ gửi sự kiện live nên store phải `refetch()` lúc đầu và sau khi kết nối lại.
- Chưa biết plugin có cuộn được timeline tới một item không; nếu không, chạm pill theo dõi không làm gì.
- Chưa biết plugin có chỗ lưu cục bộ cho mức chi tiết không.
- Phân pha theo loại tool là ước lượng: lệnh không phải test vẫn tính là Verify.
- Tool đặc thù của OMP và tool MCP có thể rơi vào `unknown` và hiện là `tool`; ghi bảng ánh xạ quan sát được vào `docs/observed/agent-activity.md`.
- Codex và OMP cần được cài và đăng nhập để E2E đủ ba provider; hiện mới chứng minh được Claude trên daemon E2E.
- Thay `tool_call` có thể làm mất nhóm tool của Overview mode; nếu xảy ra, ghi lại làm giới hạn đã biết.

## Ngoài phạm vi

- Thay đổi hiển thị của câu trả lời, lỗi, todo và tin nhắn người dùng.
- Syntax highlighting, tìm kiếm, đăng registry.
- Nhớ lựa chọn mở riêng theo đoạn hoặc theo bước qua lần tải lại.
