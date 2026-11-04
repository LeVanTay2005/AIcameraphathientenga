# FallGuard: nh?n RTSP, ph?t WebRTC v? l?u s? ki?n

Đây là backend thực sự cho `public/camera.html`: Pi sở hữu camera CSI, phát HLS có xác thực, theo dõi tư thế, lưu ảnh/video sự kiện lên Firebase và gửi Web Push. Laptop/điện thoại chỉ xem, không cần cấp quyền camera.

## 1. Chuẩn bị Pi

Dùng Raspberry Pi OS **64-bit**, camera đang hoạt động với Picamera2 và FFmpeg có encoder `libx264`. Tắt script/dịch vụ khác đang giữ camera CSI trước khi chạy agent này; hai tiến trình không thể cùng sở hữu camera. Sao chép repo vào `/home/pi/fallguard` (đổi đường dẫn và tên user trong các lệnh nếu khác).

```bash
sudo apt update
sudo apt install -y python3-opencv python3-venv ffmpeg
cd /home/pi/fallguard
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r pi/requirements.txt
ffmpeg -encoders | grep libx264
```

`--system-site-packages` cần để venv đọc được Picamera2/libcamera/OpenCV do apt cài. Không cài Picamera2 từ pip thay cho bộ thư viện camera của Raspberry Pi OS. Mặc định 640×480, 12 fps để giảm tải CPU; đo nhiệt độ, tốc độ khung hình và chất lượng trên Pi thật trước khi tăng độ phân giải. Agent hiện mã hóa H.264 bằng CPU, không giả định có hardware encoder trên mọi model Pi.

## 2. Firebase và quyền truy cập

1. Tạo Web app trong Firebase; bật Authentication → **Email/Password**. Tạo một tài khoản cho nhóm; dùng cùng tài khoản trên các máy xem. Sao chép **UID** của tài khoản vào `OWNER_UID` trên Pi.
2. Tạo Firestore và Storage. Áp dụng `firestore.rules`, `storage.rules` trong repo bằng Console hoặc Firebase CLI. Cấu hình billing nếu Storage của project yêu cầu.
3. Tạo service-account cho backend với quyền Firestore, Storage và gửi FCM trong project. Giữ JSON credential **chỉ trên Pi**, ngoài thư mục public và ngoài Git, ví dụ `/home/pi/.config/fallguard/service-account.json`. Đặt quyền file `chmod 600`.
4. Trong Project settings → Cloud Messaging, bật FCM HTTP v1 API và tạo **Web Push certificate / VAPID public key**. Không đưa private key hoặc service-account key vào app.
5. Dùng Firebase Web config đầy đủ gồm `messagingSenderId` trên ứng dụng. Thêm domain web vào Authorized domains của Authentication khi cần.
6. Sửa `storage.cors.json` chứa domain web thực tế rồi áp dụng CORS để SDK có thể đọc Blob ảnh/video:

```bash
gcloud storage buckets update gs://YOUR_STORAGE_BUCKET --cors-file=storage.cors.json
```

Tệp lưu tại `users/{OWNER_UID}/events/{eventId}/photo.jpg` và `video.mp4`. Metadata nằm ở `users/{OWNER_UID}/events/{eventId}`. Client đọc file bằng SDK đã xác thực, không tạo đường dẫn download công khai. Danh sách push token nằm dưới `users/{OWNER_UID}/pushTokens`.

## 3. Bật nhận diện nghi té ngã

```bash
cd /home/pi/fallguard
.venv/bin/python -m pip install -r pi/requirements-ai.txt
mkdir -p models
curl --fail --location 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' -o models/pose_landmarker_lite.task
.venv/bin/python -c 'import mediapipe; from mediapipe.tasks.python import vision; print("MediaPipe import OK")'
```

Khả năng cài wheel MediaPipe phụ thuộc kiến trúc ARM64 và phiên bản Python/OS. Nếu pip báo không có wheel, cần dùng môi trường Python được MediaPipe hỗ trợ; **không coi AI đang chạy khi cài thất bại**. Có thể đặt `ENABLE_FALL=false` để kiểm tra xem/ghi hình trước. Agent hiển thị trạng thái AI và lỗi trên app; khi AI không tải được, camera và ghi thủ công vẫn hoạt động.

Heuristic theo dõi **một người** chuyển từ thân đứng sang ngang trong khoảng 4,5 giây và giữ ngang hơn 0,8 giây. Đây là nguyên mẫu chưa kiểm định, có thể nhầm nằm xuống với té ngã hoặc bỏ sót khi bị che/khuất khung hình. Không có khả năng phát hiện mọi tai nạn, ngất xỉu hoặc "bất thường" nói chung. Đặt camera cố định nhìn rõ toàn thân và kiểm thử với video đã ghi; không thử té thật.

`ENABLE_MOTION=true` bật loại sự kiện **chuyển động** bằng chênh lệch khung hình; thay đổi ánh sáng cũng có thể kích hoạt. Mặc định tắt. Các loại sự kiện trong app: `fall`, `motion`, `manual`, `alert`.

## 4. Cấu hình và chạy agent

```bash
cd /home/pi/fallguard
cp pi/.env.example pi/.env
chmod 600 pi/.env
.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Điền vào `.env`: bucket thật, đường dẫn credential, `OWNER_UID`, danh sách `APP_ORIGINS` (cách nhau bằng dấu phẩy), `POSE_MODEL`, `DATA_DIR`; dùng chuỗi vừa tạo cho `STREAM_SIGNING_KEY`. Không giữ giá trị ví dụ. `APP_ORIGINS` là domain **app web**, không phải domain API Pi. Ví dụ:

```text
APP_ORIGINS=https://fallguard-camera-laptop-mobile.rightknoll8.chatgpt.site,http://localhost:3000
```

Chạy:

```bash
cd /home/pi/fallguard
.venv/bin/python pi/agent.py
```

API mặc định chỉ lắng nghe `127.0.0.1:8000`. Chạy **một process**, không dùng nhiều Uvicorn worker. Picamera2 RGB888 xuất byte BGR, được giữ đúng định dạng khi đưa vào OpenCV/FFmpeg; chỉ chuyển sang RGB cho MediaPipe.

Để tự chạy khi Pi khởi động, sửa đường dẫn/user trong `pi/fallguard.service`, sau đó:

```bash
sudo cp pi/fallguard.service /etc/systemd/system/fallguard.service
sudo systemctl daemon-reload
sudo systemctl enable --now fallguard
journalctl -u fallguard -f
```

Agent thử mở lại camera sau khi lỗi. Log encoder ở `DATA_DIR/encoder.log`; đặt cơ chế xoay log trong vận hành dài hạn. Dữ liệu sự kiện chưa tải xong nằm trong `DATA_DIR/outbox`, được giữ qua khởi động lại và thử tải mỗi 15 giây. Theo dõi dung lượng Pi: agent từ chối tạo sự kiện mới khi còn dưới 200 MB; dữ liệu chưa tải thành công không tự xóa. Bản đã tải và xử lý push được dọn cục bộ sau một ngày; dữ liệu Firebase vẫn giữ.

## 5. Truy cập qua Wi-Fi và 4G/5G

Cần một domain **HTTPS truy cập từ Internet** chuyển tiếp tới `127.0.0.1:8000` trên Pi. Có thể dùng reverse proxy với TLS (mẫu `Caddyfile.example`) nếu mạng có thể định tuyến tới Pi, hoặc dùng đường hầm HTTPS được nhóm quản lý nếu mạng bị CGNAT. Mẫu Caddyfile không tự mở đường mạng, cấp domain hoặc xử lý CGNAT. Không đưa IP nội bộ của Pi vào app rồi kỳ vọng dùng được bằng 4G.

Chỉ xuất bản endpoint agent đã xác thực; không công khai camera/raw RTSP hay service-account file. Agent kiểm tra Firebase ID token và đúng `OWNER_UID` trước khi cấp URL HLS có chữ ký, hạn 10 phút. URL này là quyền xem tạm thời: không chia sẻ, không ghi access log có query. Các yêu cầu playlist/segment đều kiểm tra chữ ký và hạn; app làm mới phiên trước hết hạn, có thể ngắt ngắn khi nạp lại luồng. HLS có độ trễ so với hình thực tế; AI xử lý trực tiếp trên Pi, không dựa vào hình trễ trên điện thoại.

## 6. Dùng app

Mở web đã triển khai HTTPS trên laptop/điện thoại. Trang chính là `camera.html` (được sao chép làm `index.html`). Điền domain API Pi, Firebase Web config, VAPID public key; lưu rồi đăng nhập.

- **Xem camera**: xác thực với Pi và phát HLS. Safari dùng HLS native; Chrome/Edge dùng hls.js.
- **Lưu ảnh & đoạn video**: Pi chụp ngay và giữ khoảng 10 giây trước/10 giây sau. Sự kiện xuất hiện khi đã tải Firebase.
- **Video & sự kiện**: cập nhật trực tiếp từ Firestore; lọc loại, xem ảnh/video, tải về. Tải thêm tối đa 200 sự kiện gần nhất trong phiên.
- **Bật thông báo**: xin quyền trên từng thiết bị và đăng ký FCM. Android/laptop dùng trình duyệt tương thích; iPhone/iPad cần iOS/iPadOS 16.4+ hỗ trợ Web Push, thêm PWA vào màn hình chính rồi bật từ app đã cài. Có thể bị ảnh hưởng bởi cài đặt thông báo/tập trung hoặc mạng; cần thử trên thiết bị thật.
- **Đăng xuất**: xóa đăng ký push của phiên thiết bị này khi có thể, đóng luồng và đóng dữ liệu xem lại. Nếu không xóa được token do mất mạng, app báo lỗi và giữ trạng thái đăng nhập để bạn thử lại.

Đây là **app PWA**, chưa phải APK hoặc ứng dụng phát hành trên App Store. Khi cài trên điện thoại, app mở riêng từ màn hình chính. Pi tiếp tục xử lý khi app đóng; thông báo nền phụ thuộc FCM/Web Push được thiết lập và cấp quyền đúng.

## 7. Sự kiện và lưu video

FFmpeg giữ HLS dạng các đoạn TS hoàn chỉnh khoảng 2 giây. Khi có sự kiện, Pi sao chép các đoạn trước vào outbox, chờ thêm khoảng 12 giây để đủ đoạn sau rồi remux thành MP4 có header hợp lệ, kèm ảnh JPG. Ranh giới đoạn làm cửa sổ dài/ngắn hơn danh nghĩa vài giây; lúc vừa khởi động hoặc khôi phục sau mất điện, metadata `partial=true` để app hiển thị. Nếu không có video, ảnh vẫn được tải và sự kiện được đánh dấu thiếu phần video. Không phải bản ghi liên tục 24/7.

Mỗi lần chỉ tạo một sự kiện, cách nhau tối thiểu 25 giây để tránh chiếm hết ổ đĩa. Mạng lỗi không làm mất các sự kiện đã ghi vào outbox. Upload dùng ID cố định để retry không tạo bản ghi trùng. Push gửi sau khi lưu Firebase; nếu mạng lỗi, cảnh báo có thể đến muộn. Retry FCM có thể gửi lại tới thiết bị đã nhận; notification dùng cùng tag eventId để hạn chế trùng.

Nếu nhóm có thuật toán/sensor khác, đặt `EVENT_INGEST_KEY` trên Pi và gọi `POST /api/ingest-event` với `Authorization: Bearer <key>` và JSON `{"kind":"alert"}` hoặc `fall`. Endpoint mặc định bị tắt; không đưa key vào mã app. Điều này chỉ tích hợp sự kiện, không tự tích hợp thuật toán chưa có.

## 8. Kiểm thử

```bash
npm test
python3 -m unittest discover -s pi -p 'test_*.py' -v
```

API tests cần `fastapi`, `httpx`, `python-dotenv`. Các test dùng camera/Firebase giả lập để kiểm tra chủ sở hữu, từ chối tài khoản ẩn danh, chữ ký/hạn HLS, đường dẫn tệp, cooldown API và khôi phục sự kiện thiếu video. Chúng không chứng minh chạy được camera, encoder, AI ARM64, Firebase project hoặc push trên điện thoại thật.

Kiểm tra triển khai: đăng nhập sai UID phải bị từ chối; bật Pi trên Wi-Fi rồi xem bằng điện thoại tắt Wi-Fi dùng 4G; lưu thủ công, đợi video và xem lại từ laptop; tắt mạng Pi rồi tạo sự kiện để kiểm tra outbox và khôi phục tải; đóng app và gửi sự kiện để kiểm tra push. Kiểm tra AI bằng video kiểm thử an toàn và đánh giá nhầm/bỏ sót trước khi sử dụng.

Tài liệu API chính thức: [Picamera2](https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf), [MediaPipe Python](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python), [Firebase Web Push](https://firebase.google.com/docs/cloud-messaging/web/get-started), [FCM Admin](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk).
