# FallGuard Camera

**Bản hiện tại dành cho Raspberry Pi + Picamera2:** mở trang chính hoặc `/camera.html`. Có mã agent trên Pi để phát hình, ghi ảnh/video sự kiện, tải Firebase và gửi thông báo. Đọc [hướng dẫn cài đặt Pi và app](pi/README.md) trước khi triển khai. Các phần bên dưới mô tả nguyên mẫu webcam cũ, vẫn giữ ở `/legacy-webcam.html` để tham khảo.

Ứng dụng web tiếng Việt xem webcam/camera điện thoại, ghi video, phát hiện tư thế nghi té ngã, lưu ảnh/video trong IndexedDB và tải Firebase Storage + metadata Firestore.

## Chạy tại máy

Cần Node.js 18+; không cần cài dependencies.

```powershell
npm.cmd start
```

Mở http://localhost:3000 trong Chrome/Edge và cấp quyền camera. Nhấn **Bật camera**. **Ghi video** bắt đầu bản ghi thủ công, **Dừng & lưu** hoàn tất. **Thử lưu sự kiện** kiểm tra chụp ảnh, lưu đoạn trước/sau và tải Firebase; chờ khoảng 10–15 giây để hoàn tất.

Server chỉ lắng nghe loopback. Dùng trên điện thoại cần phục vụ qua HTTPS; mở HTTP bằng IP LAN không đáp ứng quyền camera. Camera IP RTSP chưa được hỗ trợ; cần backend chuyển RTSP sang WebRTC/HLS. Không thu âm.

## Firebase

1. Tạo Firebase project và Web app. Sao chép `firebaseConfig`, đổi thành JSON hợp lệ (khóa có dấu ngoặc kép), dán vào phần cấu hình trong app. Không dùng service-account private key.
2. Bật Authentication → Sign-in method → Anonymous. Thêm domain chạy app vào Authorized domains nếu Firebase yêu cầu.
3. Tạo Cloud Storage và Cloud Firestore. Cấu hình gói thanh toán nếu dự án Firebase yêu cầu để dùng Storage.
4. Áp dụng `storage.rules` và `firestore.rules` trong Firebase Console hoặc `firebase deploy --only storage,firestore:rules --project YOUR_PROJECT_ID` bằng Firebase CLI đã đăng nhập.
5. Bấm **Lưu & kết nối Firebase**, sau đó **Tự tải sự kiện lên Firebase**. Bản ghi thủ công cũng được tự tải nếu tùy chọn này bật. Có thể tải lại thủ công khi mạng phục hồi.

File được lưu ở `users/{anonymousUid}/events/{eventId}/`; metadata ở cùng đường dẫn trong Firestore. Rules chỉ cho phép UID sở hữu truy cập. Không tạo đường dẫn tải công khai. App tái dùng phiên đăng nhập ẩn danh theo project; xóa dữ liệu trình duyệt có thể mất UID và quyền truy cập dữ liệu cũ. Muốn dùng lâu dài/nhiều thiết bị cần thay đăng nhập ẩn danh bằng tài khoản cố định. Nút xóa chỉ xóa dữ liệu cục bộ; dữ liệu Firebase vẫn còn. Kết nối thành công xác nhận Auth, quyền Storage/Firestore được kiểm tra khi tải thật.

## Phát hiện và lưu video

MediaPipe Pose Landmarker Lite chạy trên trình duyệt, theo dõi một người. Heuristic tìm thân người từ đứng sang ngang trong 4,5 giây, giữ ngang hơn 0,8 giây và giãn cảnh báo 20 giây. Đây là nguyên mẫu chưa kiểm định: nằm xuống có thể báo nhầm; té khỏi khung, bị che hoặc góc quay bất lợi có thể bị bỏ sót. Đặt camera cố định nhìn rõ toàn thân; không thử té thật để kiểm tra. Cần hiệu chỉnh và đánh giá bằng dữ liệu thực tế trước khi dùng giám sát an toàn.

Bộ đệm giữ các đoạn video độc lập khoảng 5 giây; sự kiện chứa các đoạn giao với cửa sổ 10 giây trước/10 giây sau. Do ranh giới đoạn, thời lượng có thể dư tối đa khoảng 5 giây mỗi phía. Không ghép Blob tùy tiện thành một file sai container. Tải từng đoạn qua thư viện. Nếu vừa mở/tắt camera, phần trước/sau có thể ngắn hơn. Ảnh chụp ngay khi ghi nhận; bản sự kiện được ghi IndexedDB khi đã đủ phần sau. Đóng trang trước khi hoàn tất có thể mất sự kiện đang thu.

Giữ trang ở phía trước, không khóa màn hình. Ghi thủ công giữ dữ liệu trong RAM đến lúc dừng; tránh ghi liên tục quá lâu. Dữ liệu cục bộ phụ thuộc quota và có thể bị trình duyệt dọn. Không có dịch vụ ghi hình nền, tự khởi động, hay cảnh báo đến người thân trong phiên bản này.

Cần Internet để tải MediaPipe, mô hình, font và Firebase SDK từ CDN. Camera xử lý cục bộ; ảnh/video chỉ tải Firebase khi có thao tác tải hoặc bật đồng bộ. Máy không có mạng chưa tải được AI vẫn có thể ghi thủ công.

## Kiểm tra

```powershell
npm.cmd test
node --check public/app.js
```

Kiểm thử tự động chỉ kiểm tra heuristic tư thế. Cần kiểm thử thủ công quyền camera, ghi/phát video, lỗi mạng/quota và tải Firebase bằng project thật. Tham khảo API: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js và https://firebase.google.com/docs/storage/web/upload-files.


## Web + app tr?n laptop v? ?i?n tho?i (PWA)

B?n n?y b? sung app PWA d?ng chung m? ngu?n v?i web. ??y l? app c?i t? tr?nh duy?t, ch?a ph?i APK hay ?ng d?ng tr?n App Store. Tr?n Android/laptop d?ng Chrome ho?c Edge v? ch?n C?i ?ng d?ng; tr?n iPhone m? Safari ? Chia s? ? Th?m v?o m?n h?nh ch?nh. C?n HTTPS. App l?u ???c giao di?n offline sau l?n truy c?p ??u; xem tr?c ti?p, Firebase v? t?i AI l?n ??u v?n c?n m?ng. Kh?ng h? tr? ch?y camera khi kh?a m?n h?nh.

### M?t m?y ph?t camera, m?y kh?c xem

1. B?t Firebase Authentication **Email/Password** c?ng v?i Anonymous. T?o m?t t?i kho?n t?i Firebase Console ? Authentication ? Users. D?n c?ng Firebase Web config v?o c? hai thi?t b?.
2. ??ng nh?p c?ng t?i kho?n email/m?t kh?u trong m?c **Camera t? xa** tr?n c? hai thi?t b?. Quy?n xem ???c gi?i h?n theo UID t?i kho?n; t?n camera kh?ng ph?i m?t kh?u.
3. Tr?n thi?t b? ph?t, b?m **B?t camera**, nh?p t?n camera (v? d? `camera-nha`), r?i **Ph?t camera thi?t b? n?y**. C? th? d?ng nhi?u m?y ph?t v?i t?n kh?c nhau; ch? d?ng m?t m?y ph?t cho m?i t?n.
4. Tr?n laptop/?i?n tho?i xem, nh?p c?ng t?n, b?m **Xem t? xa**. Kh?ng c?n b?t camera tr?n m?y xem. B?m To?n m?n h?nh ?? xem l?n.
5. Gi? thi?t b? ph?t m? m?n h?nh. AI, l?u ?nh v? video s? ki?n ch?y ? thi?t b? ph?t. B?t t? t?i Firebase tr?n thi?t b? ph?t; thi?t b? xem b?m **T?i th? vi?n ??m m?y** ?? xem l?i 20 s? ki?n g?n nh?t.
6. N?u kh?ng k?t n?i trong 45 gi?y, b?t ph?t tr??c r?i k?t n?i l?i. M?i ng??i xem t?o m?t k?t n?i WebRTC ri?ng n?n nhi?u ng??i xem t?ng t?i m?y ph?t v? b?ng th?ng.

WebRTC truy?n video tr?c ti?p; Firestore trao ??i offer/answer v? ICE. M?c ??nh c? STUN, ch?a c? d?ch v? TURN ?i k?m. K?t n?i gi?a Wi-Fi/4G ho?c m?ng h?n ch? c? th? th?t b?i n?u ch?a cung c?p TURN. M? m?c TURN v? nh?p m?ng ICE servers t? nh? cung c?p c?a b?n tr?n c? hai m?y; d?ng credential ng?n h?n, kh?ng nh?ng secret d?i h?n v?o m? ngu?n. Tr?ng th?i k?t n?i v? l?i ???c hi?n th?; kh?ng cam k?t truy?n xuy?n m?i m?ng khi ch?a c? TURN th?t.

?p d?ng l?i `firestore.rules` m?i ?? cho ph?p signaling. Khi ng?t k?t n?i, app ??ng peer v? c? x?a t?i li?u k?t n?i c?a m?y xem; c?c subcollection ICE c? th? c?n l?i. C?u h?nh TTL/d?n d?p signaling ? backend cho v?n h?nh l?u d?i. T?i kho?n d?ng chung l? c?ch gh?p thi?t b? ban ??u; h? th?ng nhi?u ng??i d?ng n?n c? t?i kho?n ri?ng v? ph?n quy?n chia s?.

### Xem ?nh/video Firebase gi?a c?c thi?t b?

App ??c file b?ng Firebase SDK ?? x?c th?c thay v? t?o URL c?ng khai. Firebase Storage c?n CORS cho domain web ?? `getBlob` ho?t ??ng. S?a domain trong `storage.cors.json` theo domain tri?n khai th?c t? r?i d?ng Google Cloud CLI ?? ??ng nh?p:

```powershell
gcloud storage buckets update gs://YOUR_STORAGE_BUCKET --cors-file=storage.cors.json
```

N?u upload ???c nh?ng kh?ng xem l?i ???c, ki?m tra CORS v? Storage rules. Video c?c b? v?n ch? c? ? thi?t b? ?? ghi; c?n t?i Firebase tr??c khi m?y kh?c xem ???c.

### Tri?n khai HTTPS tr?n Firebase Hosting

?? chu?n b? `firebase.json` v?i hosting public directory. C? th? tri?n khai v?o Firebase project c?a b?n sau khi ??ng nh?p Firebase CLI:

```powershell
firebase deploy --only hosting,storage,firestore:rules --project YOUR_PROJECT_ID
```

Th?m domain Hosting v?o Firebase Auth Authorized domains khi c?n. Kh?ng d?ng ???ng d?n localhost c?a laptop tr?n ?i?n tho?i: localhost lu?n ch? ch?nh thi?t b? ?ang m?. C?n m?t URL HTTPS d?ng ???c tr?n c? hai thi?t b?.

### Ph?m vi ki?m ch?ng b?n web/app

C? test cho ch?n t?i kho?n ?n danh, y?u c?u camera khi ph?t v? lu?ng viewer t?o offer ch? nh?n video, ng?t peer. V?n c?n ki?m th? hai thi?t b? th?t, camera/microphone permission, c?i PWA tr?n Android/iOS, TURN qua m?ng kh?c v? Firebase project th?t tr??c khi v?n h?nh.
