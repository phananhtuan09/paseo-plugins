# Agent Activity · Flow

Status: Direction approved and spiked on Claude Code (2026-11-05), not yet implemented.
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

- [ ] Mốc 1 · nền: scaffold `agent-activity/` bằng `paseo plugin init`, `shared/activity.ts`, `client/classify.ts` và `activity-meta.ts` với `classify.test.ts` dùng fixture từ `docs/observed/agent-activity.md`; typecheck và `node --test` đạt.
- [ ] Mốc 2 · timeline: transformer, renderer ở ba mức, `detail-level.ts`, `step-bodies.tsx`; cài lên daemon E2E, kiểm bằng một turn Claude Code có đọc, sửa, chạy lệnh (cả lệnh lỗi), cả lúc đang stream.
- [ ] Mốc 3 · pill và đầu đoạn: `agent-timeline.ts`, `segments.ts` (có test), đầu đoạn và nhãn pha ở Steps và Full, hai composer pill.
- [ ] Mốc 4 · hoàn thiện: README, E2E Playwright (cần người dùng đồng ý cài Playwright trong `agent-activity/e2e/`), ảnh desktop và compact, theme sáng và tối, `docs/observed/agent-activity.md` cập nhật theo kết quả.

Codex và OMP chưa kiểm được; làm mốc 1 đến 4 trên Claude Code trước, rồi bổ sung provider khác khi đã cài và đăng nhập.

## Giả định và chỗ chưa chắc

Kết quả spike ngày 2026-11-05 nằm ở `docs/observed/agent-activity.md`.

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

Dữ liệu thật của Claude Code (3 turn, chi tiết ở `docs/observed/agent-activity.md`) lệch khỏi bảng ở "Quyết định 1" ở các điểm sau; bảng chi tiết của "Quyết định 2" và mockup đã sửa theo `cwd` và `unifiedDiff`, còn `classify` phải xử lý các điểm còn lại:

- Một tool call đổi dạng khi đang chạy: ban đầu `detail.type` là `unknown` với `input` rỗng nhưng `name` đã có (`Bash`, `Read`, `Edit`), vài chục ms sau mới thành `shell`/`read`/`edit`.
  `classify` phải dùng `name` làm fallback cho `unknown` đang chạy, nếu không bước `run` sẽ nháy `Calling` trước khi thành `Running`.
- `Agent` đổi `name` thành `Task` và `detail` thành `sub_agent` giữa chừng; `actions` luôn rỗng nên meta `N actions` của `delegate` không có dữ liệu.
- `shell` không có `exitCode` và `cwd`; mã thoát chỉ có trong `error.content` dạng `Exit code 2\n...` của bước `failed`.
  Meta `exit N` phải được parse từ chuỗi đó, và dòng `cwd` trong chi tiết bước `run` bỏ.
- `edit` không có `unifiedDiff`, chỉ có `oldString` và `newString` (đến dần từng trường khi đang chạy).
  Meta `+X −Y` và khối diff phải tự tính từ hai chuỗi đó.
- `read` chỉ có `content` khi đã xong, nên meta `N lines` chỉ hiện sau khi xong.
- `search` kiểu `web_search` không có `webResults` hay số kết quả, nên meta `N results` không có dữ liệu.
- Paseo phát thêm item `tool_call` tổng hợp kiểu `plain_text`: `agent_message` (tin nhắn do agent khác gửi) và `task_notification` (trùng với bước `Bash` đã có).
  Bảng hiện coi `plain_text` là `tool` nên chúng sẽ hiện thành hai bước thừa; `classify` phải trả `undefined` cho `agent_message` và xử lý `task_notification` riêng.
- `reasoning` chỉ có `text`, đến từng đoạn nhỏ; Haiku 5.5 không phát reasoning, Sonnet 5.5 với thinking cao thì có.

Vẫn chưa chắc:

- Mặc định Paseo có hiện `task_notification` không; nếu không, plugin nên trả `[]` cho item đó.
- `TodoWrite`, `Grep`, `Glob`, `WebFetch` không tồn tại trong session Claude Code do Paseo 0.15.0 khởi tạo (cả Haiku và Sonnet), nên các nhánh `todo`, `fetch` và `search` thành công, cùng `plan`, `compaction`, `error`, `notification`, chưa quan sát được.
  Fixture của các nhánh này phải viết tay từ type `ToolCallDetail`.
- Codex và OMP cần được cài và đăng nhập để E2E đủ ba provider; mới quan sát Claude.
- Tool đặc thù của OMP và tool MCP có thể rơi vào `unknown` và hiện là `tool`.
- Phân pha theo loại tool là ước lượng: lệnh không phải test vẫn tính là Verify.

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
