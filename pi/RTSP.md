# Nhận RTSP, phát lại RTSP/WebRTC

Theo yêu cầu của nhóm, **giữ chương trình Picamera2 đang phát RTSP**. App không mở trực tiếp CSI. Luồng triển khai:

```text
Picamera2 → RTSP nguồn ─┬→ MediaMTX ─→ RTSP (VLC/client tương thích)
                       │           └→ WebRTC/WHEP (web, Android, iPhone)
                       └→ agent.py → phân tích + bộ đệm video
                                    → ảnh JPG + video MP4 → Firebase → thông báo
```

App `camera.html` mặc định xem bằng WebRTC, có HLS dự phòng. Thư viện xem lại dùng MP4/ảnh trên Firebase, không nhầm với live RTSP relay. Các hướng dẫn Firebase, cài app và outbox ở [README.md](README.md).

## Cấu hình

1. Cài MediaMTX **v1.21.3** từ [release chính thức](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.3), chọn đúng kiến trúc Pi. Client WebRTC cùng phiên bản đã lưu trong `public/vendor`, kèm giấy phép. Không thay đổi script phát RTSP của nhóm.
2. Điền `RTSP_SOURCE_URL` trên máy chủ, ví dụ `rtsp://127.0.0.1:8554/live` (thay bằng đường dẫn thật). Mật khẩu RTSP nếu có chỉ nằm trong `.env` phía máy chủ, không nhập vào app.
3. `MEDIA_PATH=camera`. `WHEP_PUBLIC_URL=https://rtc.your-domain.example/camera/whep`. `APP_ORIGINS` là các origin HTTPS của app.
4. Tạo user/pass riêng `MEDIA_RTSP_USER`, `MEDIA_RTSP_PASSWORD` để client native đọc relay RTSP; mạng được phép trong `MEDIA_RTSP_NETWORKS` (mặc định chỉ loopback).
5. Chạy agent và tạo cấu hình MediaMTX:

```bash
cd /home/pi/fallguard
.venv/bin/python pi/render_mediamtx.py
.venv/bin/python pi/agent.py
# Mở terminal/service khác:
mediamtx /home/pi/fallguard/pi/mediamtx.generated.yml
```

File generated chứa nguồn RTSP và có thể chứa credential TURN, được bỏ qua bởi Git; không đưa vào thư mục `public/`. Có thể chạy MediaMTX như systemd theo tài liệu của MediaMTX. Cổng RTSP relay là **8555** để tránh xung đột nguồn RTSP 8554; mặc định chỉ bind loopback.

VLC/client native chạy trên máy chủ có thể đọc `rtsp://127.0.0.1:8555/camera` và nhập user/pass riêng. Muốn xem RTSP trong LAN: sửa `rtspAddress` trong file private, thêm LAN CIDR vào `MEDIA_RTSP_NETWORKS`; chỉ dùng trong mạng tin cậy/VPN. Không phát RTSP không mã hóa ra Internet. Trên điện thoại qua 4G/5G, dùng WebRTC trong app.

## HTTPS và mạng di động

Mẫu `Caddyfile.example` dùng hai hostname:

- `camera.your-domain.example` → agent `127.0.0.1:8000`; chặn công khai `/internal/*`.
- `rtc.your-domain.example` → MediaMTX `127.0.0.1:8889`, không thêm tiền tố URL làm hỏng WHEP Location.

MediaMTX gọi HTTP auth nội bộ của agent để xác thực Firebase ID token cho **read/WebRTC** đúng luồng và đúng UID. Phiên WebRTC hết hạn theo token; app gia hạn kết nối định kỳ. Các thao tác publish/API khác bị từ chối. RTSP native dùng thông tin riêng và giới hạn IP, không dùng mật khẩu Firebase trực tiếp.

HTTPS chỉ xử lý signaling, chưa đủ để đảm bảo gói video WebRTC đi qua NAT. Điền `WEBRTC_PUBLIC_HOSTS` với IP/DNS mà client truy cập được; định tuyến UDP/TCP 8189 tới máy MediaMTX nếu dùng kết nối trực tiếp. Với CGNAT hoặc mạng di động hạn chế, cần TURN thật trong `WEBRTC_ICE_SERVERS_JSON`:

```json
[{"url":"turn:YOUR_TURN_HOST:3478","username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}]
```

Trình tạo cấu hình chuyển mảng này sang `webrtcICEServers2`. Không có dịch vụ TURN/domain/tunnel thật được cấp sẵn trong repo. Không thể xác nhận 4G/5G chỉ từ mã nguồn. HLS dự phòng đi qua HTTPS, có độ trễ cao hơn.

## Codec

Nguồn RTSP nên là **H.264 không B-frame**, profile baseline để tương thích rộng. MediaMTX relay không tự chuyển mã codec. Nếu nguồn là H.265 hoặc H.264 có B-frame, hãy điều chỉnh encoder của chương trình phát hoặc thêm FFmpeg chuyển mã sang H.264 baseline, `-bf 0`. Agent ghi sự kiện có chuyển mã H.264 riêng; điều đó không tự sửa codec live WebRTC của MediaMTX. Bản này không phát/ghi âm thanh.

## Kiểm tra

- Xác nhận RTSP nguồn phát được trước.
- Đăng nhập app và kiểm tra WebRTC trên cùng Wi-Fi.
- Tắt Wi-Fi điện thoại, kiểm tra lại bằng 4G/5G; nếu lỗi, xem ICE/TURN và cổng media.
- Kiểm tra tài khoản sai UID không xem được, native RTSP sai user/pass bị từ chối.
- Bấm Lưu ảnh & đoạn video rồi xem lại trên thiết bị khác; đóng app và tạo sự kiện để kiểm tra push.

Tham khảo: [WebRTC client](https://mediamtx.org/docs/read/web-browsers), [HTTP authentication](https://mediamtx.org/docs/features/authentication), [WebRTC qua NAT/TURN và codec](https://mediamtx.org/docs/features/webrtc-specific-features).
