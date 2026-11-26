# Spike bước đang chạy (2026-11-08)

Bằng chứng cho mục "Kết quả spike" của `docs/plans/active/agent-activity-running-step.md`.
Đây là bản rút gọn của dữ liệu thô, không phải một lần chạy E2E của plugin.

## Môi trường

- Daemon E2E cô lập: home `/tmp/paseo-e2e-home`, cổng 6801, daemon 0.15.3.
- Claude Code 2.1.319, agent Haiku 5.5.
- Mode `bypassPermissions`, trừ C8a và C8b chạy mode `default`.
- Không có biến `BASH_DEFAULT_TIMEOUT_MS` hay `BASH_MAX_TIMEOUT_MS` trong môi trường tiến trình daemon.

## Nội dung

- `raw/<case>.jsonl`: mỗi dòng là một bản ghi của bộ dò.
  `kind: "refetch"` là kết quả `fetchAgentTimeline` (chỉ giữ entry `tool_call`), `kind: "live"` là event từ `subscribeAgentTimeline`, `t` là thời điểm nhận bằng mili giây.
  Event quyền chỉ giữ `id`, `name`, `detail` và `metadata`.
  Nội dung tin nhắn người dùng và trợ lý đã bị bỏ.
- `prompts/<case>.txt`: prompt đã giao cho agent của từng case.
- `scripts/probe.mjs`: bộ dò. Chạy bằng `ELECTRON_RUN_AS_NODE=1 /Applications/Paseo.app/Contents/MacOS/Paseo probe.mjs <agentId> <outfile> <seconds>`.
  Nó import client của CLI từ bundle của ứng dụng Paseo, nên chỉ chạy trên máy có Paseo desktop.
- `scripts/run.sh`, `scripts/launch.sh`: tạo agent và chạy bộ dò song song cho các case.
- `scripts/analyze.py`, `scripts/inputs.py`: tóm tắt từng case và đối chiếu tool input thật với session log của Claude Code.
  Hai script đọc `/tmp/aa-spike/raw` và `~/.claude/projects`, nên cần chỉnh đường dẫn khi chạy trên bản đã rút gọn.
- `scripts/trim.py`: script tạo `raw/` rút gọn từ dữ liệu thô.
- `scripts/actions.txt`: giờ bấm Allow và Deny của C8.

## Case

| Case | Nội dung |
| --- | --- |
| C1a, C1b | Output chạy dần (1 dòng mỗi giây, 1 dòng mỗi 5 giây) |
| C2, C3, C4, C5 | Pipe, ANSI và `\r`, output lớn, lệnh im lặng |
| C6, C6b, C7, C7b | Timeout mặc định và tường minh (`C6` bị Claude Code chặn nên không dùng làm kết quả) |
| C8a, C8b | Chờ cấp quyền, Allow và Deny |
| C9 | `run_in_background` |
| C10a, C10b | Dừng agent, restart daemon (`C10b-after` là dữ liệu sau restart) |
| C11 | Lệnh trong sub-agent |
| C12 | Kết nối mới giữa lúc lệnh đang chạy (đọc lại `C6b`) |
| C13 | Hai Bash song song |

## Giới hạn

- Mỗi case chỉ chạy một lần.
- Bộ dò chạy trong Node bằng client của CLI, chưa chạy trong trình duyệt.
- Lô chạy đầu bị loại vì lỗi quote của bộ chạy (prompt chỉ là `50`) và không được lưu.
- `C10a` chỉ kiểm tra tiến trình còn sống ở +30 s và đã hết ở +55 s.
