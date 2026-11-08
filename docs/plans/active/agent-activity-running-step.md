# Agent Activity · Chính sách hiển thị bước đang chạy

Status: chủ dự án đã trả lời mọi câu hỏi mở (2026-11-08), chờ lệnh commit rồi mới implement.
Kế hoạch này là phần mở rộng của `docs/plans/active/agent-activity.md`, không thay thế nó.

## Tài liệu liên quan

- Chính sách (nguồn ý định, coding agent phải làm theo): `agent-activity/RUNNING-STEP-POLICY.md`.
- Mockup UI đã chốt: `docs/mockups/agent-activity/running-step.html`.
  Mockup cho thấy từng trạng thái ở Brief và Steps, theme sáng và tối, desktop và mobile.
  Phần chạy thử trong mockup đi qua ba đường: lệnh ngắn, quá 120s vào nền, chờ cấp quyền.
- Kế hoạch gốc và dữ liệu quan sát của các spike trước: `docs/plans/active/agent-activity.md`.
- Bằng chứng của spike (dữ liệu thô rút gọn, bộ dò, prompt): `docs/testing/evidence/agent-activity/running-step-spike/`.
- Mã hiện tại cần sửa: `agent-activity/client/step-view.tsx`, `timeline-rows.ts`, `agent-timeline.ts`, `classify.ts`, `format.ts`, `segments.ts`.

## Mục tiêu

Ở Brief và Steps, bước đang chạy hiện đủ tín hiệu để chủ dự án quyết định nhanh nên để agent chạy tiếp hay dừng nó, mà không phải mở body hay chuyển sang Full.
Tín hiệu chỉ dựa trên dữ liệu plugin thật sự nhận được từ Claude Code, không giả lập tiến độ.

## Quyết định của human

Mọi quyết định dưới đây do chủ dự án trả lời trong các vòng Grill ngày 2026-11-08.
Coding agent không đổi chúng và không tự chọn lại.

### Vòng 1 · phạm vi và tín hiệu

| # | Quyết định | Trạng thái |
| --- | --- | --- |
| 1 | Chạy spike thực tế trước khi viết policy | Đã làm, xem phần "Kết quả spike" |
| 2 | Mọi bước đang chạy có thời gian chạy, riêng output chỉ áp cho lệnh `Ran` | Còn hiệu lực phần thời gian chạy. Phần output bị bỏ (không có dữ liệu) |
| 3, 4, 5 | Số dòng ở Brief, dòng output cuối ở Steps, trạng thái khi không có output chạy dần | Bị bỏ, thay bằng vòng 3 |
| 6 | Ngưỡng "lâu bất thường" là 2 phút | Bị thay: spike cho thấy lệnh vào nền ở 120s |
| 7 | Mỗi bước chạy song song có đồng hồ riêng | Còn hiệu lực |
| 8 | Chấp nhận bước đã xong mất thời gian chạy sau reload | Được thay bằng quy tắc ở vòng 4 |
| 9 | `run_in_background` để ngoài scope | Bị đổi ở vòng 4 |

### Vòng 2 · dấu `slow`

Các quyết định 1 đến 5 của vòng này (dấu `slow`, thời gian của bước xong, sub-agent, `silent`) đều gắn với mốc 2 phút hoặc với output chạy dần.
Cả hai bị loại sau spike nên các quyết định này không còn hiệu lực, trừ việc sub-agent chỉ hiện thời gian chạy.

### Vòng 3 · sau spike

| # | Quyết định |
| --- | --- |
| 1 | Bỏ hẳn `slow` |
| 2 | Bước bị chuyển xuống nền hiện `In background · 3m 20s` với glyph riêng và đồng hồ tiếp tục, tới khi `task_notification` đến thì thành xong hoặc lỗi |
| 3 | Bước đang chờ cấp quyền hiện `Waiting for approval` thay cho đồng hồ, và đồng hồ chạy từ lúc được duyệt |
| 4 | Bước bị dừng giữ `canceled` như hiện tại, policy ghi rõ tiến trình có thể còn chạy |
| 5 | Bỏ `N lines`, `silent` và dòng output cuối khỏi spec Claude Code. Tiêu chí chấp nhận đổi thành "biết lệnh đã chạy bao lâu và đã vào nền chưa" |

### Vòng 4 · hệ quả của spike

| # | Quyết định |
| --- | --- |
| 1 | Lệnh `run_in_background` dùng chung trạng thái `In background` |
| 2 | Bước nền kết thúc thành `Ran` kèm check hoặc X và tổng thời gian, lỗi thì `exit N` màu đỏ |
| 3 | Bước không đi qua nền khi xong thì không hiện thời gian chạy |
| 4 | Bước nền mà agent đã đóng và không có thông báo kết thúc hiện `status unknown` và dừng đếm |
| 5 | Thời gian từ 1 giờ hiện `1h 15m` |
| 6 | Khoảng lặng giữa hai bước (model nghĩ lâu, API retry) nằm trong mục Không làm |

### Phản hồi của chủ dự án về rủi ro kỹ thuật (đã nhận vào policy)

- Elapsed tính bằng `now - timestamp`, không cộng dồn trong state.
- Một ticker chung, chỉ bước đang chạy mới đăng ký. Phần thời gian là component lá. Tạm dừng khi tab ẩn.
- Không giữ toàn bộ output trong state.
- Chờ cấp quyền là trạng thái riêng, không tính thời gian chờ vào lệnh.
- Trình đọc màn hình chỉ được báo khi bước đổi trạng thái, không báo theo từng giây.

### Vòng 5 · xác nhận cuối

Chủ dự án trả lời "theo đề xuất" cho các câu hỏi mở.

| # | Quyết định |
| --- | --- |
| 1 | Chấp nhận ba giả định: chữ `denied` cho bước bị từ chối quyền, icon bước bị dừng vẫn màu xanh như code hiện tại, và màu amber chỉ dành cho `Waiting for approval` (`In background` dùng viền nét đứt màu accent) |
| 2 | Pill theo dõi ở composer giữ nguyên, không nói `Waiting for approval` hay `In background` |
| 3 | Hai commit trong cùng một nhánh: commit chính sách, mockup và plan trước, commit implement sau |
| 4 | Lưu bản rút gọn dữ liệu spike vào `docs/testing/evidence/agent-activity/running-step-spike/` |

### Giả định của agent vẫn chưa được chủ dự án trả lời trực tiếp

- Brief và Steps hiện cùng một bộ tín hiệu, chỉ khác bố cục (hệ quả của việc bỏ dòng output cuối).
- Tên icon Lucide `Layers`, `ShieldAlert`, `CircleDashed` (cần kiểm tra trên Paseo 0.15.x khi implement).

## Kết quả spike

Ngày 2026-11-08, trên daemon E2E cô lập (home `/tmp/paseo-e2e-home`, cổng 6801, daemon 0.15.3), Claude Code 2.1.319, agent Haiku 5.5, mode `bypassPermissions` trừ C8.
Biến `BASH_DEFAULT_TIMEOUT_MS` và `BASH_MAX_TIMEOUT_MS` không có trong môi trường tiến trình daemon.

### Phương pháp

- Bộ dò là một script Node dùng chính client của CLI (`connectToDaemon`, `fetchAgentTimeline`, `subscribeAgentTimeline`).
  Đây là cùng RPC với `timeline.refetch` và `timeline.subscribe` mà plugin dùng.
  Bộ dò refetch mỗi 500 ms và ghi mọi event live, mỗi case một file JSON.
- `paseo logs` không được dùng làm dữ liệu vì nó in bản chép đã curate, mất `status`, `detail` và `timestamp`.
- Tool input thật được đối chiếu với session log của Claude Code, và lần chạy lệch kịch bản bị loại.
  Lô chạy đầu bị loại toàn bộ vì lỗi quote của bộ chạy khiến prompt chỉ là `50`. Lô thứ hai chạy đúng.
- Giới hạn: bộ dò chạy trong Node, chưa chạy trong trình duyệt. Mỗi case chỉ có một lần chạy.
- Bản rút gọn của dữ liệu thô, bộ dò và prompt nằm ở `docs/testing/evidence/agent-activity/running-step-spike/`.
  Dữ liệu thô đầy đủ chỉ còn ở `/tmp/aa-spike/raw` và sẽ mất khi dọn `/tmp`.

### Kết quả theo case

| Case | Lệnh và cách chạy | Quan sát | Hệ quả |
| --- | --- | --- | --- |
| C1a | Vòng lặp in 1 dòng mỗi giây trong 25 giây | `output` rỗng ở mọi snapshot đang chạy (t+3.5 s, t+4.0 s). `completed` ở t+30.6 s với 190 ký tự. Kênh live và refetch giống nhau | Không có output chạy dần |
| C1b | In 1 dòng mỗi 5 giây, 25 dòng | Chạy 124 s. Chuyển `completed` ở 120 s với output kết thúc bằng `Command did not complete within its 120s timeout and was moved to the background (ID: b0a7nal7r)` | Lệnh vào nền, không bị kill |
| C2 | Có pipe `\| tail -3` | `output` rỗng trong lúc chạy, `line 13\nline 14\nline 15` khi xong | Giống C1 |
| C3 | ANSI, `\r`, stderr xen stdout | Output thô `'\x1b[32mgreen\x1b[0m start\ndl 20%\rerr1\ndl 40%\rerr2…'`. stderr nằm xen đúng thứ tự | Làm sạch ANSI và `\r` nếu từng hiển thị output |
| C4 | `seq 1 20000` (106,3 KB) | Output thành `<persisted-output>Output too large (106.3KB). Full output saved to: …` với bản xem trước 2.236 ký tự. Entry khoảng 3,2 KB | Timeline không chứa toàn bộ output lớn |
| C5 | `sleep 20` | `output` là placeholder 31 ký tự, không rỗng | Không dùng độ dài output làm tín hiệu |
| C6 | `sleep 150` | Claude Code chặn: `Blocked: standalone sleep 150`, bước `failed`. Case đo không được | Thay bằng C6b |
| C6b | Vòng lặp im lặng 200 s, không truyền timeout | `completed` ở t+122.2 s với `moved to the background (ID: bsme5r4x2)`. `task_notification` ở t+202.9 s: `Background command "…" completed (exit code 0)` | Lệnh im lặng cũng vào nền ở 120 s |
| C7 | `sleep 20` với `timeout` 300000 | Input thật có `"timeout": 300000`. Chạy bình thường, `detail` chỉ có `command` và `output`, không có `timeout` | Plugin không biết timeout của lệnh |
| C7b | Vòng lặp 200 s với `timeout` 130000 | `completed` ở t+133.2 s với `its 130s timeout and was moved to the background`. `task_notification` ở t+203.9 s | Timeout tường minh cũng chuyển xuống nền |
| C8a | Mode `default`, lệnh `touch … && sleep 5`, Allow sau khoảng 38 s | Bước `running` suốt thời gian chờ, timestamp bằng lúc xin quyền (09:52:03 UTC). Live có `permission_requested` rồi `permission_resolved`. `completed` ở t+46.6 s | Đồng hồ tính theo timestamp sẽ gồm cả thời gian chờ |
| C8b | Như C8a, Deny sau khoảng 38 s | `failed` ngay lúc Deny, `error.content` là `Permission request denied` | Phân biệt được với `exit N` |
| C9 | Hai bước: `run_in_background` rồi đọc output | Bước nền hoàn tất sau khoảng 1,1 s với output `Command running in background with ID: b37ba1r8p. Output is being written to: <file>. You will be notified when it completes. To check interim output, use Read on that file path.`. `task_notification` ở t+34.5 s. `BashOutput` không tồn tại, agent dùng `ToolSearch` rồi `Monitor` rồi `Read` | Lệnh `run_in_background` có cùng dạng kết thúc như lệnh vào nền |
| C10a | Dừng agent ở giây 12 | Bước `canceled` cùng một record `failed` trùng. Tiến trình `sleep` sống tới khi tự kết thúc (còn sống ở +30 s, đã hết khi kiểm lại ở +55 s) | Nhãn `canceled` không nói về tiến trình |
| C10b | Restart worker daemon ở giây 12 | Bước `failed` với `Exit code 137`, agent `closed`. Tiến trình vẫn chạy ở +20 s | Không bước nào kẹt `running` khi restart |
| C11 | Sub-agent chạy `sleep 30; echo sub-done` | Chỉ có bước `Agent` (đổi thành `Task`), `actions` và `log` rỗng cả lúc chạy. Không có tool call lồng nhau | Không thấy lệnh bên trong sub-agent |
| C12 | Mở kết nối mới ở giây 69 của C6b | Nhận bước `running` với timestamp bằng lúc bắt đầu (09:56:59.130) | Reload giữa lúc chạy giữ được đồng hồ |
| C13 | Hai Bash song song trong một message | Hai bước độc lập: A `completed` ở 12,5 s, B ở 22,5 s, mỗi bước một timestamp | Mỗi bước một đồng hồ riêng |

### Dữ liệu dùng được cho implement

- Yêu cầu quyền (`permission_requested`) có `request.metadata.toolUseId` trùng `callId` của bước, nên nối được bước với lần chờ.
- Payload refetch có `agent.pendingPermissions` (rỗng khi không có yêu cầu nào) và `agent.status`, giúp khôi phục sau reload.
  Hình dạng phần tử của `pendingPermissions` chưa được quan sát vì spike không refetch lúc đang chờ.
- `task_notification` có `metadata.toolUseId`, `taskId` và `status`, còn exit code chỉ nằm trong chữ `(exit code N)` của output.

### Chưa quan sát được

- Lệnh bị kill thật bởi timeout ở foreground (không có trong Claude Code 2.1.319).
- `timeout` nhỏ (vài giây) có chuyển xuống nền như `timeout` 130000 hay không (dự kiến có, cần xác nhận khi viết E2E).
- Hình dạng của `agent.pendingPermissions` và cách nó thay đổi sau `permission_resolved`.
- Kết quả trong trình duyệt thật thay vì Node.

## Cách làm (agent đề xuất)

Giữ nguyên kiến trúc hiện có: classify thành `ActivityStep`, `timeline-rows` dựng hàng từ timeline, `step-view` vẽ.
Phần mới là một lớp suy ra trạng thái thuần, một đồng hồ chung, và hai nguồn tín hiệu mới.

### Mô hình dữ liệu

- `shared/activity.ts`: thêm vào `ActivityStep` trường tùy chọn `background` với `id`, và `timeoutSec` khi đọc được.
  Trường này do `classify.ts` điền khi output có `moved to the background (ID: …)` hoặc `Command running in background with ID: …`.
  Thêm trường `denied` khi `errorText` bắt đầu bằng `Permission request denied`.
- Trạng thái hiển thị là một giá trị suy ra, không lưu trong `ActivityStep`:
  `fg` (chạy trực tiếp), `wait`, `bg`, `unknown`, hoặc trạng thái cuối (xong, lỗi, bị dừng).
- Bước nền kết thúc được đổi ở `buildRows`: `status` thành `done` hoặc `failed` theo exit code, `meta` là `exit N` khi lỗi, và có `totalMs`.

### Suy ra trạng thái

- File mới `client/running.ts` với hàm thuần `deriveRunning(step, ctx)` và `running.test.ts`.
  Đầu vào: bước, timestamp của entry, `task_notification` khớp (nếu có), yêu cầu quyền đang chờ (nếu có), thời điểm được duyệt (nếu biết), và agent đã đóng hay chưa.
  Đầu ra: loại trạng thái cùng `startMs` và `endMs` để component vẽ.
- Chạy trực tiếp: `startMs` là timestamp của entry đang chạy.
- Chờ cấp quyền: có yêu cầu đang chờ khớp `toolUseId`. Sau khi duyệt, `startMs` là lúc nhận `permission_resolved`.
  Nếu reload sau khi duyệt thì không biết lúc duyệt, nên đồng hồ tính từ lúc xin quyền. Đây là giới hạn cần ghi trong policy.
- Vào nền: `startMs` là timestamp trừ `timeoutSec`. Với `run_in_background` thì dùng timestamp (sai lệch khoảng 1 giây). Thiếu `timeoutSec` thì không có đồng hồ.
- Kết thúc nền: `endMs` là timestamp của `task_notification`, exit code đọc từ `(exit code N)`, khác 0 là lỗi.
- Mất dấu: bước nền không có thông báo và `agent.status` là `closed`.

### Store

- `client/timeline-rows.ts`: trước khi bỏ `task_notification`, gom chúng vào map theo `metadata.toolUseId`. Hàng của chúng vẫn không được vẽ.
- `client/agent-timeline.ts`:
  - xử lý thêm `permission_requested` và `permission_resolved` từ `timeline.subscribe` (hiện chỉ xử lý `turn_*` và `timeline`), và refetch khi có;
  - mỗi lần refetch đọc `agent.pendingPermissions` và `agent.status` từ payload;
  - giữ thời điểm nhận `permission_resolved` theo `callId`.
- Hàng mới có trường `live` do `deriveRunning` trả về, nên `segments.ts` và `composer-pills.ts` vẫn đọc `step.status`.
  Bước nền đang chạy có `status: "running"` để tiêu đề run và pha tiếp tục tính nó là đang chạy.

### Đồng hồ chung

- File mới `client/clock.ts`: một store tick mỗi giây, dùng `useSyncExternalStore`.
  Chỉ chạy `setInterval` khi có ít nhất một subscriber, và tạm dừng khi `document.hidden` (kiểm tra `typeof document`).
  Khi tab hiện lại thì tick ngay để tính lại từ timestamp.
- Component lá `Elapsed` trong `step-view.tsx` đọc đồng hồ và nhận `startMs`, nên mỗi giây chỉ chữ thời gian render lại, không phải cả timeline.
  `useNow` và `useElapsed` hiện có được thay bằng đồng hồ này, kể cả ở tiêu đề run.

### Hiển thị

- `client/step-view.tsx`: dùng `live` để chọn glyph, chữ và viền cho chip (Brief) và hàng (Steps) theo mockup.
  `Waiting for approval` thay phần đồng hồ, `In background · {elapsed}`, `status unknown`.
  Chip và hàng có `accessibilityLabel` mô tả trạng thái. Không đặt thời gian vào live region.
  Trình đọc màn hình chỉ được báo khi trạng thái đổi.
- `client/format.ts`: `formatDuration` thêm dạng `1h 15m` từ 3600 giây, cùng test.
- Icon: `Layers` cho nền, `ShieldAlert` cho chờ quyền, `CircleDashed` cho mất dấu. Kiểm tra từng tên trên Paseo 0.15.x trước khi dùng.
- Màu: amber chỉ cho `Waiting for approval` (token `statusWarning`), `In background` dùng viền nét đứt màu `accent`.

### Không đổi

- Full (mọi thứ đang mở thân bước), cách hiển thị câu trả lời và lỗi của turn, pill Detail.
- Pill theo dõi ở composer: nó vẫn đọc bước đang chạy như hiện nay. Chủ dự án đã chốt giữ nguyên pill này (vòng 5); muốn đổi thì cần quyết định mới.

## Kiểm chứng

- `npm run typecheck` và `npm test` trong `agent-activity/`.
- Unit test (`running.test.ts`, `timeline-rows.test.ts`, `classify.test.ts`, `format` test) với fixture lấy từ dữ liệu spike:
  - bước chạy trực tiếp, chờ quyền, đã duyệt, bị từ chối;
  - bước vào nền do `timeout` và do `run_in_background`, có và không có thông báo kết thúc, thông báo lỗi, agent đã đóng;
  - hai bước song song, sub-agent, bị dừng;
  - `formatDuration` ở 59 s, 60 s, 3599 s, 3600 s và 4503 s.
- Demo trên Claude Code ở Brief và Steps cho từng tình huống trong policy, tạo như sau:
  - chờ cấp quyền: agent ở mode `default`, lệnh không nằm trong danh sách tự cho phép (ví dụ `touch x && …`), rồi `paseo permit allow` hoặc `paseo permit deny` trên daemon E2E;
  - vào nền: lệnh vòng lặp không có `sleep` đứng riêng, vì Claude Code chặn `sleep N` lớn. Dùng `timeout` nhỏ để không phải đợi 120 s, và xác nhận hành vi này trước;
  - `run_in_background`: prompt bắt buộc tham số `run_in_background`;
  - bị dừng: `paseo stop` giữa lúc chạy;
  - mất dấu: dừng và khởi động lại daemon E2E giữa lúc một lệnh nền đang chạy;
  - mở lại giữa lúc chạy: tải lại trang khi lệnh đang chạy.
- Runtime E2E Playwright trên daemon E2E cô lập theo `.claude/skills/runtime-e2e-test/references/project-runtime.md`.
  Thêm vào `agent-activity/e2e/` các case chờ quyền và vào nền (dùng `timeout` nhỏ). Chụp ảnh desktop và compact, theme sáng và tối.
- Tắt plugin thì Paseo về cách hiển thị mặc định, và Full không đổi.

## Thứ tự làm

Mỗi mốc chạy được và kiểm được riêng.
Đánh dấu `[x]` khi mốc đã làm xong và kiểm xong.

- [x] Mốc 0 · commit thứ nhất trên nhánh làm việc: policy, mockup, plan này và bằng chứng spike. Commit implement làm sau (quyết định vòng 5, câu 3).
- [x] Mốc 1 · nền: `formatDuration` có giờ, trường `background` và `denied` ở `classify.ts`, `running.ts` cùng test bằng fixture spike.
- [ ] Mốc 2 · store: gom `task_notification`, xử lý event quyền, đọc `agent.pendingPermissions` và `agent.status`, `live` trên hàng. Đã code và có unit test; còn phải xác nhận hình dạng `pendingPermissions` bằng một lần refetch lúc đang chờ quyền (cần cài lại plugin lên daemon E2E).
- [x] Mốc 3 · đồng hồ chung `clock.ts` và component `Elapsed`, thay `useNow` và `useElapsed`.
- [ ] Mốc 4 · hiển thị: bốn trạng thái mới ở Brief và Steps, accessibility, kiểm icon, ảnh so với mockup. Đã xem trên trình duyệt (desktop, sáng và tối): `Layers` và `ShieldAlert` hiện đúng; `CircleDashed` (`status unknown`) chưa quan sát.
- [ ] Mốc 5 · README đã cập nhật; E2E `@R1` (chờ quyền rồi Allow) và `@R2` (vào nền bằng `timeout` 5000 rồi kết thúc) đã pass trên daemon E2E, ở desktop sáng và tối. `timeout` nhỏ cũng chuyển xuống nền. Còn lại: E2E compact, `run_in_background`, bị dừng, mất dấu, reload giữa chừng, hình dạng `pendingPermissions` khi refetch. Phần còn lại của mốc: E2E và demo cho từng tình huống, cài lên daemon local và kiểm trạng thái `running`.

## Rủi ro và chỗ chưa chắc

- Bước vào nền dựa vào chữ trong output của Claude Code (`moved to the background`, `its Ns timeout`). Nếu bản Claude Code khác đổi câu chữ thì bước quay về `Ran ✓`, tức hành vi hiện tại, không hỏng thêm.
- Hình dạng `agent.pendingPermissions` chưa quan sát. Nếu khác dự kiến thì sau reload bước chờ quyền hiện như đang chạy và đồng hồ tính từ lúc xin quyền.
- Spike đo qua client CLI trong Node. Nếu trình duyệt nhận khác thì cần dò lại trong trình duyệt trước khi tin các kết luận về live stream.
- `run_in_background` có `startMs` lệch tới khoảng 1 giây vì entry hoàn tất bị đóng dấu lúc kết thúc.

## Câu hỏi mở

Không còn câu hỏi nào cần chủ dự án trả lời trước khi implement.
Những điều chưa quan sát được (hình dạng `agent.pendingPermissions`, `timeout` nhỏ, kết quả trong trình duyệt) do coding agent xác nhận trong lúc làm, ở các mốc 2 và 5.
