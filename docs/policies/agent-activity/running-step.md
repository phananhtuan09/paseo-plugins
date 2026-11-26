# Chính sách hiển thị bước đang chạy

Trạng thái: chủ dự án đã xác nhận các giả định cuối (2026-11-08), chờ lệnh commit trước khi giao cho coding agent.
Ngày: 2026-11-08.
Áp dụng cho: plugin `agent-activity`, agent Claude Code, mức Brief và Steps, Paseo 0.15.x chạy local.
Full không đổi.
Mockup tương ứng: `docs/mockups/agent-activity/running-step.html`.
Dữ liệu gốc của spike: `docs/testing/evidence/agent-activity/running-step-spike/` và mục "Kết quả spike" trong `docs/plans/active/agent-activity-running-step.md`.
Kế hoạch implement: `docs/plans/active/agent-activity-running-step.md`.

Coding agent làm theo chính sách này và không tự chọn lại bất kỳ điều nào trong đó.
Điều gì chính sách chưa nói thì hỏi chủ dự án, không tự quyết.

## Vấn đề

Ở Brief và Steps, bước đang chạy chỉ có spinner và thời gian chạy.
Khi agent chạy lệnh dài, chủ dự án không biết lệnh đang chạy, đang chờ mình, hay đã bị đẩy xuống nền.

## Điều spike đã chứng minh

Các điều dưới đây quyết định chính sách, nên chính sách không dựa vào giả định nào khác.

- Lệnh Bash không có output trong lúc chạy.
  `detail.output` chỉ xuất hiện khi lệnh xong, cả trên kênh live lẫn refetch.
  Vì vậy plugin không thể cho biết lệnh còn in output hay không, và chính sách không giả lập tiến độ.
- Claude Code không kill lệnh ở timeout.
  Ở mốc 120s mặc định, và cả ở timeout tường minh, lệnh được chuyển xuống nền và bước chuyển `completed`.
  Kết thúc thật đến sau bằng một `task_notification` có `metadata.toolUseId` trỏ về bước.
  Hiện plugin ẩn thông báo này, nên bước hiện `Ran ✓` trong lúc tiến trình vẫn chạy.
- Lệnh `run_in_background` cũng hoàn tất sau khoảng 1 giây và kết thúc bằng `task_notification`.
- Bước chờ cấp quyền vẫn là `running`, timestamp là lúc xin quyền.
  Luồng live có `permission_requested` và `permission_resolved`.
  Từ chối cho bước `failed` với nội dung `Permission request denied`.
- Timestamp của bước đang chạy là lúc bắt đầu, và kết nối mới giữa chừng vẫn nhận đúng.
  Khi xong, timestamp bị thay bằng lúc kết thúc và không có thời lượng.
- Lệnh bên trong sub-agent không xuất hiện trong timeline.
- Dừng agent đưa bước sang `canceled` nhưng tiến trình có thể chạy tiếp.
  Restart daemon đưa bước sang `failed` với `Exit code 137`.

## Chính sách

Brief và Steps hiện cùng một bộ tín hiệu.
Chúng chỉ khác bố cục: chip một hàng ở Brief, hàng có cột nhãn và nhóm pha ở Steps.
Không tín hiệu nào chỉ dựa vào màu: mỗi trạng thái có glyph và chữ đi kèm.

| Trạng thái | Người dùng thấy | Vì sao |
| --- | --- | --- |
| Đang chạy trực tiếp | Spinner và thời gian chạy (`42s`, `1m 35s`), đếm lên từng giây | Cho biết lệnh còn sống và đã chạy bao lâu, tín hiệu duy nhất đáng tin |
| Chạy song song | Mỗi bước một đồng hồ riêng | Mỗi bước có timestamp độc lập |
| Chờ cấp quyền | Glyph khiên, chữ `Waiting for approval` màu amber, không có đồng hồ | Người chậm là người dùng, không phải lệnh |
| Đã duyệt | Trở về trạng thái đang chạy, đồng hồ bắt đầu từ lúc duyệt | Thời gian chờ không tính vào lệnh |
| Bị từ chối | Bước lỗi: viền đỏ, chữ đỏ, `denied`, dấu X | Là lỗi nhưng không phải lỗi của lệnh |
| Vào nền (quá timeout hoặc `run_in_background`) | Viền nét đứt, glyph chồng lớp, `In background · 3m 20s`, đồng hồ tiếp tục | Tiến trình vẫn chạy, hiện `Ran ✓` sẽ sai |
| Nền kết thúc tốt | `Ran` kèm check và tổng thời gian (`3m 22s`) | Bước chậm giữ dấu vết khi đọc lại turn |
| Nền kết thúc lỗi | `exit N · 3m 22s` màu đỏ, dấu X | Nhìn qua là thấy lỗi, và biết lệnh hỏng sau bao lâu |
| Nền mất dấu | Viền nét đứt, glyph vòng đứt, `status unknown`, không đồng hồ | Agent đã đóng nên sẽ không có thông báo, đồng hồ đếm mãi là nói dối |
| Xong thường | `Ran` kèm check, không có thời gian | Giữ turn đã xong gọn |
| Lỗi thường | `exit N` màu đỏ, dấu X | Giữ nguyên hiện tại |
| Bị dừng | Gạch ngang, icon Ban, không spinner, không đồng hồ | Giữ nguyên hiện tại |
| Sub-agent đang chạy | Chỉ spinner và thời gian chạy | Không thấy lệnh bên trong nên không nâng lên được |

Quy tắc kèm theo:

- Thời gian dưới 1 giờ hiện `12s`, `1m 05s`. Từ 1 giờ hiện `1h 15m`.
- Chỉ bước từng đi qua nền mới giữ thời gian khi xong. Mọi bước khác xong thì không hiện thời gian.
- Thời điểm bắt đầu của bước vào nền lấy từ timestamp lúc chuyển trừ đi số giây trong câu `its Ns timeout` của output.
  Nếu không đọc được số đó thì bước vẫn hiện `In background` nhưng không có đồng hồ.
- Kết thúc thật của bước vào nền lấy từ `task_notification` có `metadata.toolUseId` trùng `callId` của bước.
- Bị dừng chỉ là hiển thị `canceled`. Chính sách ghi rõ tiến trình thật có thể còn chạy, và giao diện không nói thêm.
- Bước `failed` mang `Permission request denied` hiện `denied`, các bước `failed` khác giữ `exit N`.

## Tình huống đã dùng để kiểm tra

Mỗi tình huống có hình minh họa ở Brief và Steps trong mockup.
Người dùng thấy gì được ghi trong bảng chính sách ở trên.

1. Lệnh ngắn đang chạy.
2. Hai lệnh chạy song song.
3. Sub-agent chạy 4 phút.
4. Đang chờ cấp quyền.
5. Đã duyệt, lệnh bắt đầu chạy.
6. Bị từ chối quyền.
7. Lệnh quá 120s vào nền.
8. Lệnh chạy bằng `run_in_background`.
9. Lệnh nền kết thúc thành công.
10. Lệnh nền kết thúc lỗi.
11. Lệnh nền mất dấu.
12. Dừng agent giữa lúc chạy.
13. Xong nhanh.
14. Lỗi nhanh.
15. Lệnh chạy hơn 1 giờ.
16. Mở lại trang giữa lúc lệnh đang chạy.
17. Turn đã xong, đọc lướt (ở Brief vẫn là danh sách gọn).

## Tiêu chí chấp nhận

Tiêu chí "biết lệnh còn in output hay không" được thay vì plugin không nhận được thông tin đó (xem phần spike).
Tiêu chí thay thế: không cần click, người dùng biết lệnh đã chạy bao lâu, đang chờ mình, hay đã vào nền.

- Ở Brief và Steps, mỗi trạng thái trong bảng chính sách hiện đúng tín hiệu mà không cần click.
- Ở Brief, nhìn qua là thấy bước lỗi.
- Ở Brief, một turn đã xong vẫn là danh sách gọn, chỉ bước từng chạy nền mới có thời gian.
- Reload giữa lúc lệnh đang chạy không làm mất đồng hồ.
- Full giữ nguyên hành vi hiện tại, tắt plugin thì Paseo về cách hiển thị mặc định.

## Giới hạn đã biết

- Không biết lệnh còn in output hay không, và không biết timeout của từng lệnh.
- Khi bị dừng, nhãn `canceled` không nói được tiến trình còn chạy hay không.
- Sub-agent: lệnh treo bên trong nó không bao giờ được nhìn thấy.
- Bước vào nền chỉ biết kết thúc khi `task_notification` đến. Nếu không đến thì hiện `status unknown` khi agent đã đóng.
- Kết quả đo bằng client của CLI trong Node, chưa đo trong trình duyệt.
  Phiên bản đã đo: Claude Code 2.1.319, Paseo 0.15.3.

## Không làm

- Hỗ trợ Codex.
- Card cho câu trả lời hoặc lỗi.
- Phân loại lệnh theo rủi ro.
- Thông báo, âm thanh, hoặc quy tắc làm gián đoạn người dùng.
- Cuộn timeline tới bước đang chạy.
- Màn hình settings ngoài các mức chi tiết đang có.
- Mốc `slow`, tín hiệu `silent`, số dòng output và dòng output cuối (không có dữ liệu để làm).
- Khoảng lặng giữa hai bước, khi không có bước nào đang chạy (model nghĩ lâu, API retry).

## Chỉ dẫn kỹ thuật cho coding agent

- Chỉ dùng React Native primitives và `requirements.paseo` vẫn tương thích Paseo 0.15.x.
- Đồng hồ tính bằng `now - timestamp`, không cộng dồn trong state.
- Dùng một ticker chung. Chỉ bước đang chạy mới đăng ký vào ticker. Phần thời gian là component lá để mỗi giây không render lại cả timeline.
- Tạm dừng ticker khi tab ẩn và tính lại từ timestamp khi hiện lại.
- Store của timeline xử lý thêm `permission_requested` và `permission_resolved`. Không giữ output của lệnh trong state ngoài những gì đang hiển thị.
- `task_notification` vẫn ẩn như hiện tại. Chỉ đọc nó để nối với bước gốc qua `metadata.toolUseId`.
- Trình đọc màn hình chỉ được báo khi bước đổi trạng thái (vào nền, chờ cấp quyền), không báo theo từng giây.
- Tên icon Lucide dự kiến là `Layers`, `ShieldAlert`, `CircleDashed`. Kiểm tra chúng có trong Paseo 0.15.x trước khi dùng.
- Cập nhật `README.md` của plugin (mô tả, kiểm tra, giới hạn đã biết) cùng với phần implement.
- Chứng minh bằng unit test cho phần suy ra trạng thái và định dạng thời gian, cộng demo trên Claude Code cho từng tình huống ở cả Brief và Steps.

## Giả định đã được chủ dự án xác nhận (2026-11-08)

- Chữ `denied` cho bước bị từ chối quyền.
- Icon của bước bị dừng vẫn màu xanh như code hiện tại.
- Màu amber chỉ dành cho `Waiting for approval`. `In background` dùng viền nét đứt màu accent.
- Pill theo dõi ở composer giữ nguyên, không nói `Waiting for approval` hay `In background`.
