# Agent Activity · Flow

Status: Milestones 1 to 4 implemented and checked on Claude Code (2026-11-05); reasoning, Codex and OMP not checked at runtime.
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
Khi tool đang chạy, `detail.type` ban đầu là `unknown` với `name` đã có (`Bash`, `Read`, `Edit`, `Agent`), nên `classify` dùng `name` để chọn đúng activity ngay từ đầu và không để bước nháy sang `tool`.
Nhãn là động từ: thì hiện tại khi bước đang chạy, thì quá khứ khi đã xong, lỗi hoặc bị hủy.

| Activity | Nhãn chạy / xong | Icon (Lucide) | Nguồn | Đích | Meta |
| --- | --- | --- | --- | --- | --- |
| `read` | Reading / Read | `FileText` | tool `read` | đường dẫn rút gọn | `N lines`, chỉ khi đã xong |
| `edit` | Editing / Edited | `FilePen` | tool `edit` | đường dẫn rút gọn | `+X −Y` đếm từ `oldString` và `newString` |
| `write` | Writing / Wrote | `FilePlus` | tool `write` | đường dẫn rút gọn | `N lines` |
| `run` | Running / Ran | `SquareTerminal` | tool `shell`, `worktree_setup` | dòng đầu của lệnh, cắt 80 ký tự | `exit N` khi lỗi, parse từ dòng `Exit code N` của `error.content` |
| `search` | Searching / Searched | `Search` | tool `search` khác `web_search` | query, kèm `grep`/`glob` | `N files · N matches` |
| `web` | Fetching / Fetched | `Globe` | tool `fetch`, `search` với `web_search` | host + path hoặc query | `HTTP code` cho `fetch`; không có meta cho `web_search` |
| `delegate` | Delegating / Delegated | `Bot` | tool `sub_agent` | description | — |
| `plan` | Planning / Planned | `ListChecks` | tool `plan` | dòng đầu của plan | — |
| `tool` | Calling / Called | `Wrench` | tool `unknown`, `plain_text` (trừ `agent_message`, giữ mặc định) | label hoặc tên tool; MCP `mcp__srv__fn` hiện `srv · fn` | — |
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
| Brief (mặc định) | mỗi bước là một chip `icon + nhãn + đích + meta` trên một hàng riêng; không gộp bước, không có nhãn pha |
| Steps | đầu đoạn `N steps · thời lượng` ở bước đầu của đoạn, nhãn pha ở bước đầu của mỗi pha, rồi một hàng cho mỗi bước: icon, nhãn ở cột riêng, đích, meta, trạng thái |
| Full | như Steps, thêm phần chi tiết của mọi bước được mở sẵn |

Quyết định đã chốt ngày 2026-11-05 sau spike: Paseo thêm 16px dưới mỗi item của plugin kể cả item vẽ rỗng, nên không item nào được vẽ rỗng.
Vì vậy Brief không gộp bước thành một dòng cho cả đoạn, và mọi mức đều vẽ theo từng item.

- Chip đang chạy có viền và nền nhạt, kèm thời gian đã chạy và spinner.
- Chip lỗi màu lỗi, có meta `exit N` và icon ✕; chip bị hủy có đích gạch ngang và icon ⊘.
- Ở mọi mức, chạm một bước mở hoặc đóng phần chi tiết của riêng bước đó; ở Full, chi tiết mở sẵn và chạm để đóng.
- Không có thao tác mở hoặc thu cả đoạn; muốn xem cả timeline thì đổi mức chi tiết.
- Đổi mức chi tiết xóa mọi lựa chọn mở hoặc đóng riêng trước đó, để cả timeline đúng một mức.
- Lựa chọn riêng theo bước không được nhớ qua lần tải lại.

Phần chi tiết của một bước:

| Activity | Chi tiết |
| --- | --- |
| `run` | tên tool gốc, rồi output monospace; khi đang chạy hiện 12 dòng cuối, khi xong hiện 40 dòng đầu kèm `… N more lines`, rồi khối lỗi nếu có |
| `edit` | đường dẫn đầy đủ, tên tool gốc, diff tô màu `+`/`−` do plugin tự dựng từ `oldString` và `newString` (không có hunk header và dòng ngữ cảnh), tối đa 60 dòng |
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
- Pill theo dõi chỉ báo trạng thái, không có hành vi chạm: SDK của plugin không có API cuộn timeline tới một item.

**Pill Detail** hiện `Detail · Brief` (hoặc `Steps`, `Full`); chạm để chuyển Brief → Steps → Full → Brief.
Mức chi tiết được nhớ qua lần tải lại nếu plugin có chỗ lưu cục bộ; nếu không, mỗi lần mở app bắt đầu từ Brief.

## Hành vi chi tiết

Vòng đời một bước:

1. Bước bắt đầu: ở Brief, một hàng chip mới xuất hiện với nhãn thì hiện tại; ở Steps, một hàng mới xuất hiện với nền nhạt; ở Full, hàng mở sẵn phần chi tiết và output tăng dần.
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
- Chưa đọc được timeline của agent (đang tải, lỗi kết nối, API không có): Steps và Full bỏ đầu đoạn và nhãn pha, chỉ vẽ hàng của từng bước; Brief không bị ảnh hưởng.
- Plugin bị tắt, gỡ hoặc lỗi: timeline vẽ lại bằng hiển thị mặc định và pill biến mất.
- Theme sáng/tối và theme khác: mọi màu lấy từ `theme.colors`.
- Compact layout: chip Brief cắt đích bằng dấu `…` thay vì xuống hàng, cột nhãn ở Steps hẹp lại, pill theo dõi chiếm trọn một hàng của composer.

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
  details: z.array(z.object({ label: z.string(), value: z.string() })).optional(), // full path, URL, raw tool name
  body: body.optional(),
  errorText: z.string().optional(), // ≤2000 chars
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
  client/segments.ts        # pure: ordered timeline items -> run/phase starts for Steps and Full headers
  client/segments.test.ts   # node --test
  client/agent-timeline.ts  # per-agent store: refetch + subscribe, shared by renderer (Steps/Full headers) and pills
  client/detail-level.ts    # shared store for Brief/Steps/Full
  client/step-view.tsx      # renderer: Brief chip, Steps rows, Full bodies
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

Cách vẽ:

- Mọi mức: mỗi item tự vẽ đúng một hàng của mình và không item nào vẽ rỗng, vì Paseo thêm 16px dưới mỗi item của plugin.
- Mức Brief: chip một dòng, không cần store.
- Mức Steps và Full: `agent-timeline.ts` giữ danh sách item theo thứ tự cho `agentId`; `segments.ts` cho biết item hiện tại có là item đầu đoạn hoặc đầu pha không.
  Item đầu đoạn vẽ thêm đầu đoạn `N steps · thời lượng`, item đầu pha vẽ thêm nhãn pha, cả hai nằm trong chính item đó.
- Nếu store chưa có dữ liệu, Steps và Full chỉ vẽ hàng của bước.

State trong renderer:

```ts
const level = useDetailLevel();                // "brief" | "steps" | "full"
const bodyOpen = manual ?? level === "full";   // per-step tap, reset when level changes
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
  - Prompt chạy `sleep 8 && echo done`: khi đang chạy, pill theo dõi hiện `Running sleep 8 && echo done` và chip Running hiện trong timeline; khi xong, chip hiện `Ran` kèm check.
  - Prompt đọc và sửa một file: nhãn Read và Edited giống nhau trên mọi provider; Edited có meta `+X −Y`.
  - Đổi Detail qua Brief → Steps → Full: mọi bước đổi theo; chạm một bước chỉ mở chi tiết của bước đó.
  - `paseo plugin disable agent-activity` trên daemon E2E thì timeline trở về mặc định và pill biến mất; `enable` thì quay lại.
  - Chụp ảnh desktop và compact, theme sáng và tối.

## Thứ tự làm

Mỗi mốc có thể chạy được và kiểm được riêng.
Đánh dấu `[x]` khi mốc đã làm xong và kiểm xong.

- [x] Mốc 1 · nền: scaffold `agent-activity/` bằng `paseo plugin init`, `shared/activity.ts`, `client/classify.ts` và `activity-meta.ts` với `classify.test.ts` dùng fixture từ mục "Dữ liệu quan sát" cuối kế hoạch này; typecheck và `node --test` đạt.
- [x] Mốc 2 · timeline: transformer, renderer ở ba mức, `detail-level.ts`, `step-bodies.tsx`; cài lên daemon E2E, kiểm bằng một turn Claude Code có đọc, sửa, chạy lệnh (cả lệnh lỗi), cả lúc đang stream.
- [x] Mốc 3 · pill và đầu đoạn (pill Detail đã làm ở mốc 2): `agent-timeline.ts`, `segments.ts` (có test), đầu đoạn và nhãn pha ở Steps và Full, hai composer pill.
- [x] Mốc 4 · hoàn thiện: README, E2E Playwright dark và light đạt, ảnh desktop và compact chụp lại ở head `41a7cba`, mục "Dữ liệu quan sát" cuối kế hoạch này cập nhật, sửa `1 step · 0s`. Còn mở ngoài mốc: reasoning, Codex và OMP chưa kiểm runtime; tô màu code chỉ có unit test và kiểm tay.

Codex và OMP chưa kiểm được; làm mốc 1 đến 4 trên Claude Code trước, rồi bổ sung provider khác khi đã cài và đăng nhập.

## Giả định và chỗ chưa chắc

Kết quả spike ngày 2026-11-05 nằm ở mục "Dữ liệu quan sát" cuối kế hoạch này.

Đã có kết quả:

- **Item vẽ rỗng vẫn chiếm 16px mỗi item** (margin của wrapper do Paseo sở hữu, plugin không bỏ được).
  Brief gộp đoạn bằng cách để các item sau của đoạn vẽ rỗng sẽ để lại một dải trống 16px × số item, nên không dùng được.
  Đã chốt ngày 2026-11-05: Brief là một chip một hàng, không gộp (xem mục "Quyết định đã chốt" bên dưới và `docs/mockups/agent-activity/flow.html`).
  Chưa thử bù khoảng cách bằng margin âm; nếu thử và chạy được thì mới cân nhắc lại.
- `refetch()` chạy được trong renderer, và `subscribe()` nhận sự kiện live (`turn_started`, `timeline`, `turn_completed`) trong lúc turn đang chạy; `agents.list({ subscribe })` cũng phát hiện agent tạo sau.
- Plugin không có API cuộn timeline tới một item, nên chạm pill theo dõi không cuộn; bỏ hành vi này khỏi tiêu chí chứ không coi là tùy chọn.
- `localStorage` có trên web client và đọc ghi được; chưa kiểm trên native.
  Lưu mức chi tiết bằng `localStorage` gói trong `client/web.ts` (chỉ chạy khi `Platform.OS === "web"`); native bắt đầu từ Brief.
  `defineSettings` cũng lưu được nhưng ghi qua daemon, trái ràng buộc "không ghi gì vào daemon".
- Tắt plugin thì timeline về mặc định ngay không cần tải lại; tiêu chí "gỡ hoặc tắt plugin" đã đạt.
- Thay `tool_call` làm mất nhóm tool mặc định của Overview (ví dụ `Ran 1 command and read 1 file`); ghi làm giới hạn đã biết.

Dữ liệu thật của Claude Code (3 turn, chi tiết ở mục "Dữ liệu quan sát" cuối kế hoạch này) lệch khỏi bảng ở "Quyết định 1" ở các điểm sau; bảng chi tiết của "Quyết định 2" và mockup đã sửa theo `cwd` và `unifiedDiff`, còn `classify` phải xử lý các điểm còn lại:

- Một tool call đổi dạng khi đang chạy: ban đầu `detail.type` là `unknown` với `input` rỗng nhưng `name` đã có (`Bash`, `Read`, `Edit`), vài chục ms sau mới thành `shell`/`read`/`edit`.
  `classify` phải dùng `name` làm fallback cho `unknown` đang chạy, nếu không bước `run` sẽ nháy `Calling` trước khi thành `Running`.
- `Agent` đổi `name` thành `Task` và `detail` thành `sub_agent` giữa chừng; `actions` luôn rỗng nên meta `N actions` của `delegate` không có dữ liệu.
- `shell` không có `exitCode` và `cwd`; mã thoát chỉ có trong `error.content` dạng `Exit code 2\n...` của bước `failed`.
  Meta `exit N` phải được parse từ chuỗi đó, và dòng `cwd` trong chi tiết bước `run` bỏ.
- `edit` không có `unifiedDiff`, chỉ có `oldString` và `newString` (đến dần từng trường khi đang chạy).
  Meta `+X −Y` và khối diff phải tự tính từ hai chuỗi đó.
- `read` chỉ có `content` khi đã xong, nên meta `N lines` chỉ hiện sau khi xong.
- `search` kiểu `web_search` không có `webResults` hay số kết quả, nên meta `N results` không có dữ liệu.
- Paseo phát thêm item `tool_call` tổng hợp kiểu `plain_text` (mốc 1: `classify` trả `undefined` cho `agent_message` và ẩn `task_notification` bằng `[]`; thời gian đã chạy lấy từ `timestamp` của renderer, không có `startedAt` trong data): `agent_message` (tin nhắn do agent khác gửi) và `task_notification` (trùng với bước `Bash` đã có).
  Bảng hiện coi `plain_text` là `tool` nên chúng sẽ hiện thành hai bước thừa; `classify` phải trả `undefined` cho `agent_message` và xử lý `task_notification` riêng.
- `reasoning` chỉ có `text`, đến từng đoạn nhỏ; Haiku 5.5 không phát reasoning, Sonnet 5.5 với thinking cao thì có.

Vẫn chưa chắc:

- Mặc định Paseo có hiện `task_notification` không; nếu không, plugin nên trả `[]` cho item đó.
- `TodoWrite`, `Grep`, `Glob`, `WebFetch` không tồn tại trong session Claude Code do Paseo 0.15.0 khởi tạo (cả Haiku và Sonnet), nên các nhánh `todo`, `fetch` và `search` thành công, cùng `plan`, `compaction`, `error`, `notification`, chưa quan sát được.
  Fixture của các nhánh này phải viết tay từ type `ToolCallDetail`.
- Codex và OMP cần được cài và đăng nhập để E2E đủ ba provider; mới quan sát Claude.
- Tool đặc thù của OMP và tool MCP có thể rơi vào `unknown` và hiện là `tool`.
- Phân pha theo loại tool là ước lượng: lệnh không phải test vẫn tính là Verify.
- Tool đặc thù của OMP và tool MCP có thể rơi vào `unknown` và hiện là `tool`; bảng ánh xạ quan sát được nằm trong kế hoạch này, không ghi thành tài liệu bền vững.
- Codex và OMP cần được cài và đăng nhập để E2E đủ ba provider; hiện mới chứng minh được Claude trên daemon E2E.
- Thay `tool_call` có thể làm mất nhóm tool của Overview mode; nếu xảy ra, ghi lại làm giới hạn đã biết.

## Quyết định đã chốt

Ngày 2026-11-05 người dùng chọn **một chip một hàng** cho mức Brief, sau khi spike cho thấy item vẽ rỗng vẫn chiếm 16px.

- Mất nhãn pha nối bằng `›` và việc gộp `Read 2 files` ở mức Brief; nhãn pha vẫn còn ở Steps và Full.
- Hai hướng bị loại: transformer có trạng thái (trái yêu cầu tất định của Paseo, dễ vỡ khi tải lại) và chấp nhận dải trống 16px.
- Mockup `docs/mockups/agent-activity/flow.html` đã cập nhật theo quyết định này, theo dữ liệu thật (không có `cwd`, `exit N` parse từ lỗi, diff tự dựng từ `oldString` và `newString`) và bỏ hành vi chạm pill để cuộn timeline.

## Ngoài phạm vi

- Thay đổi hiển thị của câu trả lời, lỗi, todo và tin nhắn người dùng.
- Syntax highlighting, tìm kiếm, đăng registry.
- Nhớ lựa chọn mở riêng theo bước qua lần tải lại.
- Cuộn timeline tới bước đang chạy từ pill (SDK không hỗ trợ).

## Dữ liệu quan sát

Chuyển từ mục "Dữ liệu quan sát" cuối kế hoạch này; đây là bằng chứng của kế hoạch, không phải quyết định bền vững.


Scope: Paseo 0.15.0 timeline transformer, renderer, composer pill and storage behavior, and the Claude Code timeline item shapes, that the planned `agent-activity` plugin depends on

### Facts

### Method

- Spike runs on 2026-11-05 on an isolated E2E daemon (home `/tmp/paseo-e2e-home`, port 6801, Paseo 0.15.0) with throwaway plugins in `/tmp/aa-spike/plugin`, which is not kept in the repository. Evidence: `docs/plans/active/agent-activity.md`
- Run 1 used a plugin that replaced `tool_call` and `reasoning` items and rendered diagnostics. Run 2 used an observe-only plugin that logged every transformer input and every live `timeline.subscribe` event to the browser console. Evidence: console logs `[obs:transform]` and `[obs:live]` in those runs
- Three Claude Code agent turns were observed in run 2 (Haiku 5.5 twice, Sonnet 5.5 with thinking `high` once), all in `bypassPermissions` mode, plus two Haiku turns in run 1. Evidence: spike runs

### Rendering and host behavior

- Each plugin timeline item is wrapped by Paseo in a `data-plugin-row` element whose inner wrapper has `marginBottom: 16px`. A renderer that returns `null` still occupies 16 px. Three consecutive empty items measured as three stacked 16 px rows. A content row measured content height + 16 px. Evidence: DOM measurement in run 1
- The renderer props include `theme`, `agentId`, `item` and `timestamp`, and `npm run typecheck` accepts `theme.colors` use in a renderer. Evidence: `PluginTimelineItemProps` in `@getpaseo/plugin` 0.15.0 and run 1 typecheck
- A transformer id containing `_` is rejected with `Invalid timeline transformer id`, and the whole plugin client entry then fails to evaluate. Evidence: console warning `[Plugins] Failed to evaluate ... Invalid timeline transformer id: obs-user_message`
- Transformers run only for timelines that are rendered. An agent that was not open produced live events but no transformer calls. Evidence: run 2 logs for agent `6780ae26`
- With the plugin disabled (`paseo plugin disable`), the open page reverted to Paseo's default rendering without a reload. The default groups tools into one summary line per turn, for example `Ran 1 command and read 1 file`. With the plugin enabled that grouping was absent. Evidence: DOM text before and after disable in run 1
- The SDK types expose no API to scroll the timeline to an item. `PluginTab.setState` persists state only for workspace and agent panels, and `defineSettings` persists host-scoped settings through the daemon. Evidence: `@getpaseo/plugin` 0.15.0 `dist/client/contracts.d.ts`, `dist/settings.d.ts`
- `localStorage` is available in the web client and a write followed by a read succeeded. Native storage was not tested. Evidence: run 1 diagnostic text `localStorage ok`
- A web tab keeps the previous daemon's `serverId` after the E2E home is recreated, and its agent panel then spins forever. A fresh browser context loads normally. Evidence: run 2, `srv_FEs_C6nqtCkr` versus `srv_1L2Krla3smLp`

### Timeline subscription

- `usePaseo().agents.ref(id).timeline.refetch({ direction: "tail", limit: 200 })` works from inside a renderer and returns a payload with keys `agentId, agent, direction, epoch, window, hasOlder, hasNewer, entries`. Evidence: run 1 log `[spike] refetch keys`, `refetch=4` and `refetch=8`
- `timeline.subscribe(handler)` delivers live events during a running turn: `turn_started`, `thread_started`, `timeline` (one per item update), `turn_completed` (with `usage`). Each event carries `seq`, `epoch` and `turnId`. Evidence: run 1 console `[spike] timeline event turn_started`, run 2 `[obs:live]`
- `client.paseo.agents.list({ subscribe: {} })` delivers a snapshot and then `agent_update` upserts, so a subscription started in the client entry also covers agents created later. Evidence: run 2, agent `6780ae26` created after plugin load and observed from `turn_started`

### Transformer calls

- One tool call produces several transformer calls: each state change calls the transformer again with `phase: "streaming"` while `status` is `running`, then once with `phase: "complete"`. Loading history calls the transformer once per item with `phase: "complete"`. Evidence: run 2 `[obs:transform]` for callId `toolu_01JFQb2U...`
- A tool call's `detail` evolves while running. It first arrives as `detail.type: "unknown"` with empty `input` and the tool `name` already set (`Bash`, `Read`, `Edit`, `Agent`, `WebSearch`), then becomes a typed detail with partial fields, then completes with output. For `Edit` the typed detail gained `filePath`, then `oldString`, then `newString`, one live event each. Evidence: run 2 live events for `Bash` `toolu_01Xf3amH...` and `Edit` `toolu_01Ps3W7b...`
- An `Agent` tool call changes `name` to `Task` and `detail.type` to `sub_agent` after about 0.5 s, and its live completed event shows `unknown` again while the transformer sees `sub_agent`. Evidence: run 2 events `msgid=71..82`
- A finished `tool_call` entry is stamped when it ended, not when it started: a `sleep 8` call had timestamp 14:57:30.3 and the answer after it 14:57:31.1, while the entry before it (a hidden `agent_message`) was 14:57:21.3. A running call is stamped when it started, and the entry has no start or duration field. Evidence: WebSocket timeline payload in the E2E re-run 2026-11-05
- Assistant message text streams as accumulated text with `phase: "streaming"` (the transformer sees the full text so far) and a final `phase: "complete"` call. The live event carries only the new chunk. Reasoning items also stream in chunks and have only a `text` field and no `status`. Evidence: run 2 `msgid=83..108` and `msgid=112..133`
- Haiku 5.5 at thinking `Medium` emitted no `reasoning` item in four turns. Sonnet 5.5 at thinking `high` emitted reasoning. Evidence: run 1 and run 2 logs

### Claude Code item shapes

- `Bash` maps to `detail.type: "shell"` with `command` and, once finished, `output`. `cwd` and `exitCode` were absent in every observed shell call. Evidence: run 2 `[obs:transform]` `msgid=8`, `40`
- A failed `Bash` has `status: "failed"` and `error: { type: "tool_result", content, is_error: true }`, where `content` starts with `Exit code 2\n` followed by stderr. Evidence: run 2 `msgid=61`
- The exit code in a failed `Bash` result is the real exit code of the command, so `ls` on a missing path gave `Exit code 1` on macOS (BSD `ls`) and `Exit code 2` in the earlier run. Tests must not hard-code one value. Evidence: E2E re-run 2026-11-05, chip text `exit 1`
- `Read` maps to `detail.type: "read"` with `filePath`, and on completion `content` and `offset: 1`. `limit` was absent. A `Read` of a missing file has `status: "failed"`, no `content`, and `error.content` `File does not exist...`. Evidence: run 2 `msgid=3`, `12`
- `Edit` maps to `detail.type: "edit"` with `filePath`, `oldString` and `newString`. `unifiedDiff` was absent. Evidence: run 2 `msgid=4` and live events for `Edit`
- `Write` maps to `detail.type: "write"` with `filePath` and `content`. Evidence: run 2 `msgid=5`
- `WebSearch` maps to `detail.type: "search"` with `toolName: "web_search"` and `query`. No `webResults`, `numFiles` or `numMatches` were present when completed. Evidence: run 2 `msgid=54`, `70`
- A `Task` sub-agent maps to `detail.type: "sub_agent"` with `subAgentType`, `description`, `log: ""` and `actions: []`, and `actions` stayed empty on completion. Evidence: run 2 `msgid=80`, `82`
- An MCP tool call (`mcp__chrome-devtools__list_pages`) and `ToolSearch` map to `detail.type: "unknown"` with `input` and `output`. A failed MCP call has `error.content` text only. Evidence: run 2 `msgid=58`, `67`, `36`
- A failed `Grep` (tool unavailable) maps to `detail.type: "search"` with `toolName: "grep"`, `query` and `status: "failed"`. Evidence: run 2 `msgid=6`
- Paseo emits synthetic `tool_call` items with `detail.type: "plain_text"`. `name: "agent_message"` (callId prefix `paseo-agent-message:`, `icon: "bot"`) carries the text of a message sent by another agent or by `paseo send`. `name: "task_notification"` (`metadata.synthetic: true`, `source: "claude_task_notification"`, `toolUseId` pointing at the original call) appeared for each `Bash` call that ran `sleep 3`, and duplicates a `Bash` item with the same label as its text. Evidence: run 2 `msgid=16`, `38`, `44`
- Two `Bash` calls issued in one message ran in parallel as separate callIds, both `running` at once, and completed independently. Evidence: run 2 `msgid=20..44`
- `user_message` and `assistant_message` items reach the transformer with `text` and `messageId`. Evidence: run 2 `msgid=2`, `7`

### Not observable in this environment

- `TodoWrite`, `Grep`, `Glob` and `WebFetch` do not exist in the Claude Code session that Paseo 0.15.0 started, for both Haiku 5.5 and Sonnet 5.5. `ToolSearch` returned `No matching deferred tools found`, and the agents substituted `Bash` or a `web-fetch` sub-agent. Evidence: run 2 `msgid=9`, `36`, `68` and the agents' final messages
- No `todo`, `plan`, `compaction`, `error`, `notification`, `fetch` or `worktree_setup` item was observed. Evidence: run 2 logs

### Codex on Paseo 0.15.2

- Codex `apply_patch` returns an edit detail with `filePath` and `unifiedDiff`, without `oldString` and `newString`.
  The classifier now supports this shape.
  Evidence: `agent-activity/client/classify.test.ts`, test `Codex unified diff renders changed lines and counts without file headers`.
- Failed Codex shell calls expose `detail.exitCode`, while `error.message` can be only `Tool call failed`.
  Evidence: `agent-activity/client/classify.test.ts`, test `Codex failed shell uses structured exitCode before generic error text`.
- Stopping a Codex turn can leave a running tool entry in the daemon timeline; the shell can complete later as a second record with the same call ID and no turn ID.
  The plugin reconciles these into one row and freezes unresolved steps when the turn is no longer active.
  It does not terminate provider-owned shell processes.
  Evidence: runtime probes on 2026-11-05, agent `0956eb72-9042-4b0d-b0a1-3cd2cfe419fb`; regression cases in `agent-activity/client/timeline-rows.test.ts`.

### Open questions

- Whether Paseo's default rendering shows or hides `task_notification` items, which decides whether the plugin should hide them.
- Whether `Grep`, `Glob`, `WebFetch` and `TodoWrite` exist in a normal Claude Code session outside Paseo's E2E setup and map to `search`, `fetch` and `todo`.
- Whether OMP tool calls map to the same `detail.type` values as Claude Code.
- Whether `localStorage` exists on native clients.

### References

- `docs/plans/active/agent-activity.md`
