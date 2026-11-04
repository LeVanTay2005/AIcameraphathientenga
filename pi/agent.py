"""Picamera2 -> authenticated HLS + event recordings -> Firebase + Web Push.

Run one process/worker on Raspberry Pi OS. Do not run alongside another process
that already owns the CSI camera. All camera credentials remain on the Pi.
"""
import json
import logging
import os
import queue
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
import ipaddress
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from core import FallDetector, issue_session, valid_session

load_dotenv(Path(__file__).with_name('.env'))
log = logging.getLogger('fallguard')
DATA = Path(os.environ.get('DATA_DIR', str(Path.home() / 'fallguard-data'))).resolve()
LIVE = DATA / 'live'
OUTBOX = DATA / 'outbox'
OWNER = os.environ.get('OWNER_UID', '')
BUCKET = os.environ.get('FIREBASE_STORAGE_BUCKET', '')
KEY = os.environ.get('STREAM_SIGNING_KEY', '')
ORIGINS = [x.strip().rstrip('/') for x in os.environ.get('APP_ORIGINS', '').split(',') if x.strip()]
WIDTH, HEIGHT, FPS = (int(os.environ.get(k, v)) for k, v in [('WIDTH', '640'), ('HEIGHT', '480'), ('FPS', '12')])
FALL = os.environ.get('ENABLE_FALL', 'true').lower() == 'true'
MOTION = os.environ.get('ENABLE_MOTION', 'false').lower() == 'true'
POSE_MODEL = os.environ.get('POSE_MODEL', '')
RTSP_SOURCE = os.environ.get('RTSP_SOURCE_URL', '')
WHEP_PUBLIC_URL = os.environ.get('WHEP_PUBLIC_URL', '')
MEDIA_PATH = os.environ.get('MEDIA_PATH', 'camera')
STOP = threading.Event()
service = None
db = bucket = admin_auth = messaging = None


def write_json(path, content):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(content), encoding='utf-8')
    temporary.replace(path)


class CameraService:
    def __init__(self):
        self.lock = threading.Lock()
        self.event_lock = threading.Lock()
        self.latest = None
        self.last_frame = 0
        self.last_event = float('-inf')
        self.camera_error = 'Camera đang khởi tạo'
        self.ai_ready = False
        self.ai_error = ''
        self.upload_error = ''
        self.proc = None
        self.ai_queue = queue.Queue(maxsize=1)
        self.threads = []

    def start(self):
        LIVE.mkdir(parents=True, exist_ok=True)
        OUTBOX.mkdir(parents=True, exist_ok=True)
        # Only this generated live directory is cleared, never the durable outbox.
        for file in LIVE.iterdir():
            if file.is_file() and re.fullmatch(r'(index\.m3u8(?:\.tmp)?|seg_\d+\.ts(?:\.tmp)?)', file.name):
                file.unlink()
        for target in (self.capture_loop, self.analyze, self.upload_loop):
            thread = threading.Thread(target=target, daemon=True)
            self.threads.append(thread)
            thread.start()

    def close(self):
        STOP.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        for thread in self.threads:
            thread.join(timeout=3)
        if self.proc and self.proc.poll() is None:
            self.proc.kill()

    def capture(self):
        camera = None
        try:
            import cv2
            camera = cv2.VideoCapture(RTSP_SOURCE, cv2.CAP_FFMPEG, [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000])
            if not camera.isOpened():
                raise RuntimeError('RTSP source unavailable')
            command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                       '-f', 'rawvideo', '-pixel_format', 'bgr24', '-video_size', f'{WIDTH}x{HEIGHT}',
                       '-framerate', str(FPS), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
                       '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
                       '-g', str(FPS * 2), '-sc_threshold', '0', '-f', 'hls', '-hls_time', '2',
                       '-hls_start_number_source', 'epoch',
                       '-hls_list_size', '20', '-hls_delete_threshold', '10',
                       '-hls_flags', 'delete_segments+temp_file', '-hls_segment_filename',
                       str(LIVE / 'seg_%09d.ts'), str(LIVE / 'index.m3u8')]
            with (DATA / 'encoder.log').open('ab') as errors:
                self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
                next_encode = time.monotonic()
                while not STOP.is_set():
                    ok, frame = camera.read()
                    if not ok:
                        raise RuntimeError('RTSP stream disconnected')
                    now = time.monotonic()
                    # Drain the RTSP decoder at source rate and drop excess frames.
                    # This avoids accumulating latency when source FPS exceeds FPS.
                    if now < next_encode:
                        continue
                    next_encode += 1 / FPS
                    if next_encode < now - 1 / FPS:
                        next_encode = now + 1 / FPS
                    source_height, source_width = frame.shape[:2]
                    scale = min(WIDTH / source_width, HEIGHT / source_height)
                    fitted = cv2.resize(frame, (max(1, int(source_width * scale)), max(1, int(source_height * scale))))
                    top, left = (HEIGHT - fitted.shape[0]) // 2, (WIDTH - fitted.shape[1]) // 2
                    frame = cv2.copyMakeBorder(fitted, top, HEIGHT - fitted.shape[0] - top,
                                              left, WIDTH - fitted.shape[1] - left, cv2.BORDER_CONSTANT)
                    with self.lock:
                        self.latest, self.last_frame, self.camera_error = frame.copy(), time.monotonic(), ''
                    if self.proc.poll() is not None:
                        raise RuntimeError('Video encoder stopped')
                    self.proc.stdin.write(frame.tobytes())
                    if FALL or MOTION:
                        try:
                            self.ai_queue.put_nowait(frame.copy())
                        except queue.Full:
                            pass
        except Exception:
            log.exception('Camera/encoder stopped')
            self.camera_error = 'Không đọc được RTSP hoặc FFmpeg. Kiểm tra luồng nguồn và dịch vụ trên máy chủ.'
        finally:
            if camera:
                try:
                    camera.release()
                except Exception:
                    pass
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()

    def capture_loop(self):
        while not STOP.is_set():
            self.capture()
            if STOP.wait(5):
                return

    def analyze(self):
        import cv2
        model = mp = None
        detector, previous, motion_since, last_inference = FallDetector(), None, None, 0
        if FALL:
            try:
                import mediapipe as mp
                from mediapipe.tasks.python import BaseOptions, vision
                model = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=POSE_MODEL),
                    running_mode=vision.RunningMode.VIDEO, num_poses=1))
                self.ai_ready = True
            except Exception:
                log.exception('Pose model unavailable')
                self.ai_error = 'AI chưa chạy: kiểm tra MediaPipe và POSE_MODEL trên Pi.'
        try:
            while not STOP.is_set():
                try:
                    frame = self.ai_queue.get(timeout=1)
                except queue.Empty:
                    continue
                now = time.monotonic()
                if now - last_inference < .2:
                    continue
                last_inference = now
                if model:
                    try:
                        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                        result = model.detect_for_video(image, int(now * 1000))
                        points = result.pose_landmarks[0] if result.pose_landmarks else None
                        if detector.update(points, now, WIDTH, HEIGHT):
                            self.trigger('fall')
                    except Exception:
                        self.ai_ready = False
                        self.ai_error = 'AI gặp lỗi xử lý; camera vẫn ghi hình. Kiểm tra log trên Pi.'
                        log.exception('Pose inference failed')
                        model.close()
                        model = None
                if MOTION:
                    gray = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(frame, (160, 120)), cv2.COLOR_BGR2GRAY), (9, 9), 0)
                    if previous is not None:
                        changed = (cv2.absdiff(gray, previous) > 25).mean()
                        if changed > .12:
                            motion_since = motion_since if motion_since is not None else now
                            if now - motion_since > .8:
                                self.trigger('motion')
                                motion_since = None
                        else:
                            motion_since = None
                    previous = gray
        finally:
            if model:
                model.close()

    def segments(self):
        return sorted(LIVE.glob('seg_*.ts'), key=lambda path: path.name)

    def trigger(self, kind):
        import cv2
        # One clip at a time; prevents overlapping events exhausting storage.
        with self.event_lock:
            if time.monotonic() - self.last_event < 25:
                return None
            if shutil.disk_usage(DATA).free < 200 * 1024 * 1024:
                raise RuntimeError('Pi sắp hết dung lượng. Cần ít nhất 200 MB trống để lưu sự kiện.')
            with self.lock:
                if self.latest is None or time.monotonic() - self.last_frame > 5:
                    raise RuntimeError('Camera chưa có hình mới')
                frame = self.latest.copy()
            # Keep evidence local if Internet/Firebase is unavailable.
            event_id = uuid.uuid4().hex
            folder = OUTBOX / event_id
            folder.mkdir()
            ok, image = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ok:
                raise RuntimeError('Không chụp được ảnh')
            (folder / 'photo.jpg').write_bytes(image.tobytes())
            started = time.time()
            pre = []
            for path in self.segments():
                try:
                    if path.stat().st_mtime >= started - 12:
                        pre.append(path)
                except FileNotFoundError:
                    pass
            for path in pre:
                try:
                    shutil.copy2(path, folder / path.name)
                except FileNotFoundError:
                    pass
            write_json(folder / 'event.json', {'id': event_id, 'kind': kind, 'time': started,
                                             'phase': 'collecting', 'partial': len(pre) < 5})
            self.last_event = time.monotonic()
            thread = threading.Thread(target=self.finish_event, args=(folder,), daemon=True)
            self.threads = [item for item in self.threads if item.is_alive()]
            self.threads.append(thread)
            thread.start()
            return event_id

    def finish_event(self, folder, recovered=False):
        try:
            event = json.loads((folder / 'event.json').read_text())
            wait = max(0, event['time'] + 12 - time.time())
            interrupted = STOP.wait(wait)
            if interrupted:
                return  # Durable collecting event is recovered next startup.
            if not recovered:
                for path in self.segments():
                    try:
                        if event['time'] - 12 <= path.stat().st_mtime <= time.time():
                            shutil.copy2(path, folder / path.name)
                    except FileNotFoundError:
                        pass
            files = sorted(folder.glob('seg_*.ts'), key=lambda path: path.name)
            if files:
                listing = folder / 'concat.txt'
                listing.write_text(''.join(f"file '{path.name}'\n" for path in files))
                result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                                         '-f', 'concat', '-safe', '1', '-i', str(listing),
                                         '-c:v', 'copy', '-an', '-movflags', '+faststart',
                                         str(folder / 'video.mp4')], capture_output=True, timeout=90)
                if result.returncode:
                    raise RuntimeError('Không hoàn tất được video sự kiện; giữ bản gốc trên Pi')
            event['partial'] = event['partial'] or recovered or not files
            event['phase'] = 'ready'
            write_json(folder / 'event.json', event)
        except Exception:
            log.exception('Event clip finalization failed: %s', folder.name)

    def upload_event(self, folder, event):
        from firebase_admin import firestore
        base = f"users/{OWNER}/events/{event['id']}"
        files = []
        for name, content_type in [('photo.jpg', 'image/jpeg'), ('video.mp4', 'video/mp4')]:
            path = folder / name
            if path.exists():
                remote = f'{base}/{name}'
                bucket.blob(remote).upload_from_filename(str(path), content_type=content_type, timeout=60)
                files.append(remote)
        # The ID is stable across retries; a retry does not create duplicate events.
        db.document(base).set({'kind': event['kind'], 'cameraId': os.environ.get('CAMERA_ID', 'pi-camera-1'),
                               'createdAt': datetime.fromtimestamp(event['time'], timezone.utc),
                               'uploadedAt': firestore.SERVER_TIMESTAMP, 'files': files,
                               'clipCount': int((folder / 'video.mp4').exists()), 'partial': event['partial']})
        event['phase'] = 'uploaded'
        write_json(folder / 'event.json', event)

    def send_push(self, event):
        title = {'fall': 'Nghi ngờ té ngã', 'motion': 'Phát hiện chuyển động',
                 'manual': 'Đã lưu ảnh/video camera', 'alert': 'Cảnh báo từ camera'}.get(event['kind'], 'Sự kiện camera')
        token_docs = list(db.collection(f'users/{OWNER}/pushTokens').stream())
        for offset in range(0, len(token_docs), 500):
            batch = [doc for doc in token_docs[offset:offset + 500] if doc.to_dict().get('token')]
            if not batch:
                continue
            result = messaging.send_each_for_multicast(messaging.MulticastMessage(
                tokens=[doc.to_dict()['token'] for doc in batch],
                data={'title': title, 'body': 'Có ảnh/video mới. Mở ứng dụng để kiểm tra.', 'eventId': event['id']},
                webpush=messaging.WebpushConfig(headers={'Urgency': 'high', 'TTL': '3600'})))
            retry = False
            for doc, response in zip(batch, result.responses):
                if response.success:
                    continue
                if isinstance(response.exception, messaging.UnregisteredError):
                    doc.reference.delete()
                else:
                    retry = True
            if retry:
                raise RuntimeError('Một số thiết bị chưa nhận được yêu cầu push')

    def upload_loop(self):
        # Recover incomplete evidence after reboot, keeping the pre-event segments.
        for path in OUTBOX.glob('*/event.json'):
            try:
                event = json.loads(path.read_text())
                if event['phase'] == 'collecting':
                    self.finish_event(path.parent, recovered=True)
            except Exception:
                log.exception('Outbox recovery failed')
        while not STOP.is_set():
            for path in OUTBOX.glob('*/event.json'):
                if STOP.is_set():
                    return
                try:
                    event = json.loads(path.read_text())
                    if event['phase'] == 'ready':
                        self.upload_event(path.parent, event)
                    if event['phase'] == 'uploaded':
                        self.send_push(event)
                        event['phase'] = 'notified'
                        write_json(path, event)
                        self.upload_error = ''
                    # Keep a local copy for one day after successful cloud save.
                    if event['phase'] == 'notified' and time.time() - event['time'] > 86400:
                        shutil.rmtree(path.parent)
                except Exception:
                    log.exception('Cloud upload or notification pending: %s', path.parent.name)
                    self.upload_error = 'Có dữ liệu chờ tải/thông báo. Pi sẽ tự thử lại.'
            STOP.wait(15)


@asynccontextmanager
async def lifespan(app):
    global service, db, bucket, admin_auth, messaging
    if not OWNER or not BUCKET or not ORIGINS:
        raise RuntimeError('Cần OWNER_UID, FIREBASE_STORAGE_BUCKET và APP_ORIGINS trong pi/.env')
    if len(KEY) < 32 or KEY.startswith('REPLACE_'):
        raise RuntimeError('Cần STREAM_SIGNING_KEY ngẫu nhiên tối thiểu 32 ký tự')
    if urlsplit(RTSP_SOURCE).scheme not in {'rtsp', 'rtsps'}:
        raise RuntimeError('Cần RTSP_SOURCE_URL trỏ tới luồng RTSP camera đã có')
    if WHEP_PUBLIC_URL:
        parsed = urlsplit(WHEP_PUBLIC_URL)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
            raise RuntimeError('WHEP_PUBLIC_URL phải là HTTPS, không chứa tài khoản camera')
    if WIDTH < 160 or HEIGHT < 120 or WIDTH % 2 or HEIGHT % 2 or not 1 <= FPS <= 30:
        raise RuntimeError('Kích thước camera phải chẵn, tối thiểu 160x120; FPS từ 1 đến 30')
    import firebase_admin
    from firebase_admin import auth, firestore, storage, messaging as firebase_messaging
    firebase_admin.initialize_app(options={'storageBucket': BUCKET})
    db, bucket, admin_auth, messaging = firestore.client(), storage.bucket(), auth, firebase_messaging
    STOP.clear()
    service = CameraService()
    service.start()
    try:
        yield
    finally:
        service.close()


app = FastAPI(title='FallGuard RTSP Camera', lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST'],
                   allow_headers=['Authorization', 'Content-Type'], expose_headers=['Content-Length'])


def owner(authorization: str = Header(default='')):
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Cần đăng nhập')
    try:
        claims = admin_auth.verify_id_token(authorization[7:])
        if claims['uid'] != OWNER or claims.get('firebase', {}).get('sign_in_provider') == 'anonymous':
            raise ValueError('Forbidden')
        return claims
    except Exception:
        raise HTTPException(403, 'Tài khoản không được cấp quyền xem Pi này') from None


@app.get('/api/status')
def status(_=Depends(owner)):
    count = 0
    for file in OUTBOX.glob('*/event.json'):
        try:
            if json.loads(file.read_text())['phase'] != 'notified':
                count += 1
        except (OSError, ValueError, KeyError):
            pass
    return {'cameraReady': time.monotonic() - service.last_frame < 5 and (LIVE / 'index.m3u8').exists(),
            'cameraError': service.camera_error, 'width': WIDTH, 'height': HEIGHT, 'fps': FPS,
            'fallEnabled': FALL, 'motionEnabled': MOTION, 'aiReady': service.ai_ready,
            'aiError': service.ai_error, 'pendingUploads': count, 'uploadError': service.upload_error}


@app.post('/api/session')
def session(_=Depends(owner)):
    if time.monotonic() - service.last_frame > 5 or not (LIVE / 'index.m3u8').exists():
        raise HTTPException(503, 'Pi chưa sẵn sàng phát hình. Kiểm tra Picamera2/FFmpeg.')
    token = issue_session(KEY, time.time())
    return {'playlist': '/hls/index.m3u8?session=' + token, 'whep': WHEP_PUBLIC_URL, 'expiresIn': 600}


@app.get('/hls/{name}')
def hls_file(name: str, session: str = ''):
    if not valid_session(session, KEY, time.time()):
        raise HTTPException(401, 'Phiên xem đã hết hạn; hãy kết nối lại')
    headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}
    if name == 'index.m3u8':
        try:
            playlist = (LIVE / name).read_text()
        except FileNotFoundError:
            raise HTTPException(503, 'Camera đang khởi tạo') from None
        lines = [f'{line}?session={session}' if line and not line.startswith('#') else line for line in playlist.splitlines()]
        return PlainTextResponse('\n'.join(lines) + '\n', media_type='application/vnd.apple.mpegurl', headers=headers)
    if not re.fullmatch(r'seg_\d+\.ts', name) or not (LIVE / name).is_file():
        raise HTTPException(404, 'Không tìm thấy đoạn video')
    return FileResponse(LIVE / name, media_type='video/mp2t', headers=headers)


class EventRequest(BaseModel):
    kind: str = 'manual'


def create_event(kind):
    if kind not in {'fall', 'motion', 'manual', 'alert'}:
        raise HTTPException(400, 'Loại sự kiện không hợp lệ')
    try:
        event_id = service.trigger(kind)
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from None
    if event_id is None:
        raise HTTPException(429, 'Đang giữ video cho sự kiện trước. Vui lòng đợi khoảng 25 giây.')
    return {'id': event_id, 'state': 'collecting'}


@app.post('/api/events', status_code=202)
def manual_event(body: EventRequest, _=Depends(owner)):
    if body.kind != 'manual':
        raise HTTPException(400, 'App chỉ được tạo sự kiện thủ công')
    return create_event(body.kind)


@app.post('/api/ingest-event', status_code=202)
def detector_event(body: EventRequest, authorization: str = Header(default='')):
    expected = os.environ.get('EVENT_INGEST_KEY', '')
    if not expected or not secrets.compare_digest(authorization, 'Bearer ' + expected):
        raise HTTPException(403, 'Tích hợp sự kiện chưa được cấp quyền')
    return create_event(body.kind)


class MediaAuthRequest(BaseModel):
    action: str = ''
    protocol: str = ''
    path: str = ''
    token: str = ''
    user: str = ''
    password: str = ''
    ip: str = ''


@app.post('/internal/media-auth')
def media_auth(body: MediaAuthRequest):
    """MediaMTX HTTP auth callback. Reverse proxy must block /internal/* publicly."""
    if body.action != 'read' or body.path != MEDIA_PATH:
        raise HTTPException(403, 'Không có quyền thao tác luồng này')
    if body.protocol == 'webrtc' and body.token:
        claims = owner('Bearer ' + body.token)
        expires = datetime.fromtimestamp(claims.get('exp', time.time() + 600), timezone.utc)
        return {'expireAt': expires.isoformat().replace('+00:00', 'Z')}
    user, password = os.environ.get('MEDIA_RTSP_USER', ''), os.environ.get('MEDIA_RTSP_PASSWORD', '')
    try:
        networks = [ipaddress.ip_network(value.strip()) for value in os.environ.get('MEDIA_RTSP_NETWORKS', '127.0.0.0/8,::1/128').split(',')]
        allowed_ip = any(ipaddress.ip_address(body.ip) in network for network in networks)
    except ValueError:
        allowed_ip = False
    if (body.protocol == 'rtsp' and user and password and allowed_ip
            and secrets.compare_digest(body.user, user) and secrets.compare_digest(body.password, password)):
        return {}
    raise HTTPException(401, 'Cần thông tin xác thực hợp lệ')


if __name__ == '__main__':
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    # Access logs must not capture the short-lived signed stream URL.
    uvicorn.run(app, host=os.environ.get('HOST', '127.0.0.1'),
                port=int(os.environ.get('PORT', '8000')), access_log=False)
