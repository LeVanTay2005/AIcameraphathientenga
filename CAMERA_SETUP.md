# Kết nối camera IP trên Android, iOS và laptop

**Cập nhật hiện tại:** đã chuyển sang nhận RTSP từ chương trình Picamera2 của nhóm, phát RTSP/WebRTC qua MediaMTX. App chính là `/camera.html`. Có mã agent lưu sự kiện và gửi Firebase/FCM, đã kiểm thử bằng camera/cloud giả lập; chưa triển khai lên Pi thật. Xem [hướng dẫn RTSP/WebRTC](pi/RTSP.md) và [Firebase/app](pi/README.md). Các ghi chú nguyên mẫu bên dưới không phản ánh đầy đủ bản hiện tại.

Mục tiêu: xem camera IP có sẵn qua Wi-Fi và 4G/5G, nhận thông báo sự kiện. Không dùng điện thoại làm camera.

Ứng dụng cần một đường dẫn HTTPS chung. Camera dùng RTSP/ONVIF cần máy chủ cầu nối chuyển luồng sang WebRTC/HLS; trình duyệt không phát trực tiếp RTSP. Máy chủ cầu nối phải truy cập được IP nội bộ của camera. Không đưa tài khoản camera vào mã nguồn phía trình duyệt.

Để triển khai và kiểm tra thực tế, cần:

- Model camera hoặc đường dẫn luồng gồm giao thức, cổng và đường dẫn (ẩn mật khẩu).
- Thiết bị chạy cầu nối liên tục trong cùng mạng camera, hoặc VPN riêng từ máy chủ tới mạng camera.
- Domain HTTPS, đăng nhập người dùng và cấu hình truyền video xuyên mạng.
- Cấu hình Firebase để lưu sự kiện và gửi thông báo.

Bản PWA hiện có chưa phải ứng dụng native Android/iOS, chưa kết nối camera IP và chưa có push notification nền. Không thể xác nhận xem qua 4G/5G trước khi triển khai cầu nối và thử với camera thật.

## Raspberry Pi của nhóm

Nhóm đã xác nhận dùng Raspberry Pi làm thiết bị camera. Cần xác định camera CSI (cáp dẹt), USB hay camera mạng mà Pi lấy luồng; đồng thời cần IP/hostname của Pi và phần mềm đang phát hình. Không giả định địa chỉ RTSP từ tên Raspberry Pi.

Đã thêm trang `/ip.html` và trình phát `/ip.js`: nhập URL HLS HTTPS từ máy chủ để xem bằng Safari/iOS hoặc hls.js trên trình duyệt có Media Source Extensions. Trang không yêu cầu quyền camera của điện thoại. Manifest mở trang này khi chạy app PWA; service worker lưu giao diện, không lưu luồng video. Không lưu URL hay mật khẩu camera trong localStorage.

Trang này chưa tự chuyển RTSP/MJPEG thành HLS và chưa tích hợp AI cho luồng Pi. Raspberry Pi có thể chạy dịch vụ chuyển luồng, nhưng cấu hình cụ thể phụ thuộc camera và hệ điều hành. Phải có HLS codec tương thích, HTTPS và xác thực máy chủ trước khi cho truy cập Internet. Không chỉ mở cổng camera ra Internet mà bỏ xác thực.

Thông báo nền chưa triển khai: cần backend phân tích video và dịch vụ push. Mã hiện tại không tuyên bố phát hiện té ngã trên luồng Pi. Việc kiểm thử bản bổ sung bị chặn bởi lỗi môi trường chạy lệnh `helper_unknown_error: setup refresh had errors`; chưa xác nhận phát trên Android/iOS hoặc camera thật, chưa xuất bản bản cập nhật.

Tham khảo kỹ thuật: https://mediamtx.org/docs/read/web-browsers
