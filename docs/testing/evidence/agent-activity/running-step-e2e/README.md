# Runtime E2E của bước đang chạy (2026-11-08)

Bằng chứng cho `docs/plans/active/agent-activity-running-step.md`, mốc 4 và 5.
Đây là bản chạy nhẹ để chứng minh thay đổi, không phải plan E2E bền vững theo `docs/testing/README.md`.

## Môi trường

- Daemon E2E cô lập: home `/tmp/paseo-e2e-home`, cổng 6801, daemon 0.15.3. Daemon của chủ dự án (cổng 6767) không bị đụng tới.
- Plugin `agent-activity` cài từ thư mục này, trạng thái `running`.
- Claude Code 2.1.319, agent Haiku 5.5, mode `default` (Bash hỏi quyền).
- Playwright 1.64.1, Chromium. Test: `agent-activity/e2e/tests/activity.spec.ts`, các case `@R1` đến `@R6`, bật bằng `E2E_LIVE=1`.

## Kết quả

Mỗi lần chạy dùng một agent mới, vì agent từng bị dừng hay ngắt sẽ từ chối chạy lệnh tiếp.

| Case | Nội dung | desktop tối | desktop sáng | compact tối |
| --- | --- | --- | --- | --- |
| `@R1` | Chờ cấp quyền, rồi Allow: đồng hồ chạy từ lúc duyệt | pass | pass | pass |
| `@R2` | `timeout` 5000 vào nền, rồi kết thúc kèm tổng thời gian | pass | pass | pass |
| `@R3` | `run_in_background` | pass | pass | pass |
| `@R4` | Dừng agent giữa lúc chạy: `canceled`, không đồng hồ | pass | pass | pass |
| `@R5` | Reload trang giữa lúc chạy: đồng hồ không mất | pass | pass | pass |
| `@R6` | Restart daemon: lệnh nền hiện `killed` | pass (chạy riêng, `E2E_RESTART=1`) | không chạy | không chạy |

- `screenshots/`: ảnh chụp từ các lần chạy trên. Tên ảnh gồm tình huống, kích thước và theme. `@R6` không có ảnh trong thư mục này.
- `junit/`: kết quả JUnit của từng lần chạy.
- Lần chạy đầu của `@R5` ở compact fail vì `openAgent` bấm vào sidebar sau khi reload. Đã sửa `openAgent` (không bấm nếu ô nhập đã hiện) và chạy lại, pass.

## Giới hạn

- Mỗi case chỉ chạy một lần mỗi tổ hợp. Hai test cũ `@K3` và `@K8` phụ thuộc fixture có chữ cố định và không được chạy lại trên fixture sạch của lần này; chưa chứng minh chúng vẫn pass.
- `status unknown` và icon `CircleDashed` chưa quan sát trên trình duyệt. Sau restart daemon, agent ở trạng thái `idle` và Claude Code gửi thông báo `killed`, nên không tạo được trạng thái "agent đã đóng, không có thông báo". Trạng thái này chỉ có unit test.
- Ảnh chụp của `@R1` đến `@R5` chỉ ở theme tối cho compact.
- Chỉ chạy trên Chromium.
