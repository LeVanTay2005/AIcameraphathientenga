import {createWebRTCPlayer} from './webrtc-player.js';
import {parseFirebaseConfig, loginError} from './auth-help.js';
import {loadFirebaseDefaults} from './firebase-defaults.js';
const $ = id => document.getElementById(id);
const video = $('piVideo');
let config, cloud, stopAuth, stopEvents, stopMessage, hls, rtc, renew, healthTimer;
let identity = 0, playback = 0, limit = 20, eventRows = [], mediaUrls = [], pushTokenDoc;
const tokenStorageKey = uid => `piPushToken:${config.firebase.projectId}:${uid}`;
const sdkBase = 'https://www.gstatic.com/firebasejs/11.6.0/';
const say = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
const loginStatus = (text, error = false) => { $('loginStatus').textContent = text; $('loginStatus').classList.toggle('error', error); };
const labels = { fall: 'Nghi ngờ té ngã', motion: 'Phát hiện chuyển động', manual: 'Lưu thủ công', alert: 'Cảnh báo từ hệ thống' };
function origin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Địa chỉ Pi chỉ gồm HTTPS và tên miền, không có mật khẩu, đường dẫn hoặc query.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Địa chỉ Pi cần HTTPS để dùng từ điện thoại.');
  return url.origin;
}
async function api(path, options = {}) {
  const user = cloud?.auth.currentUser;
  if (!user || user.isAnonymous) throw Error('Hãy đăng nhập tài khoản email trước.');
  if (!config.piOrigin) throw Error('Đã đăng nhập Firebase nhưng chưa cấu hình địa chỉ máy chủ Pi trong Thiết lập.');
  const token = await user.getIdToken();
  const response = await fetch(config.piOrigin + path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof body.detail === 'string' ? body.detail : `Máy chủ Pi trả lỗi ${response.status}`);
  return body;
}
function stopVideo() {
  playback++; clearTimeout(renew); clearInterval(healthTimer);
  rtc?.close(); rtc = null; hls?.destroy(); hls = null; video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  $('liveEmpty').hidden = false; $('liveBadge').textContent = '● OFFLINE';
}
function closeMedia() {
  $('eventMedia').replaceChildren(); mediaUrls.forEach(URL.revokeObjectURL); mediaUrls = [];
}
async function health() {
  try {
    if (!config.piOrigin) { $('piState').textContent = 'Chưa cấu hình'; $('piDetail').textContent = 'Bạn có thể dùng đăng nhập và thư viện Firebase trước khi kết nối Pi.'; return; }
    const state = await api('/api/status');
    $('piState').textContent = state.cameraReady ? 'Đang hoạt động' : 'Chưa có hình';
    $('piDetail').textContent = state.cameraReady ? `${state.width} × ${state.height} · ${state.fps} fps cấu hình` : state.cameraError || 'Kiểm tra camera CSI trên Pi';
    $('aiState').textContent = state.fallEnabled ? (state.aiReady ? 'Đang theo dõi' : 'Không khả dụng') : 'Đang tắt';
    $('aiDetail').textContent = state.aiError || (state.motionEnabled ? 'Có bật sự kiện chuyển động' : 'Chuyển động không tạo cảnh báo');
    $('backendNote').textContent = `Pi: ${state.pendingUploads} sự kiện đang chờ tải. ${state.uploadError || ''}`;
  } catch (err) { $('piState').textContent = 'Mất kết nối'; $('piDetail').textContent = err.message; }
}
async function startVideo() {
  stopVideo(); const run = playback;
  try {
    say('Đang xác thực và kết nối camera trên Pi…');
    const session = await api('/api/session', { method: 'POST' });
    if (run !== playback) return;
    if ($('streamProtocol').value === 'webrtc') {
      if (!session.whep) throw Error('Máy chủ chưa cấu hình WHEP_PUBLIC_URL cho MediaMTX.');
      const token = await cloud.auth.currentUser.getIdToken();
      await import('./vendor/mediamtx-reader.js');
      if (run !== playback) return;
      rtc = createWebRTCPlayer({video, url: session.whep, token,
        onError: error => { if (run === playback) { $('liveBadge').textContent = '● ĐANG KẾT NỐI LẠI'; say('WebRTC: ' + error + '. Nếu không xem được qua 4G/5G, kiểm tra TURN hoặc chọn HLS.', true); } },
        onTrack: () => { if (run === playback) { $('liveEmpty').hidden = true; $('liveBadge').textContent = '● WEBRTC'; } }
      });
      renew = setTimeout(() => { if (run === playback) startVideo(); }, 9 * 60 * 1000);
      await health(); if (run === playback) healthTimer = setInterval(health, 15000);
      return;
    }
    const url = new URL(session.playlist, config.piOrigin);
    if (url.origin !== config.piOrigin || !url.pathname.startsWith('/hls/')) throw Error('Máy chủ trả đường dẫn video không hợp lệ.');
    $('liveBadge').textContent = '● ĐANG KẾT NỐI';
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url.href;
      video.play().catch(() => say('Bấm nút phát trên video để bắt đầu.'));
    } else {
      const { default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1.6.13/+esm');
      if (run !== playback) return;
      if (!Hls.isSupported()) throw Error('Trình duyệt chưa hỗ trợ video HLS. Hãy dùng Safari, Chrome hoặc Edge tương thích.');
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, data) => { if (run === playback && data.fatal) { stopVideo(); say('Không đọc được video. Kiểm tra camera, HTTPS và quyền truy cập máy chủ Pi.', true); } });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (run === playback) video.play().catch(() => say('Bấm nút phát trên video để bắt đầu.')); });
      hls.loadSource(url.href); hls.attachMedia(video);
    }
    // Renew short-lived stream access; no camera password is exposed to the app.
    renew = setTimeout(() => { if (run === playback) startVideo(); }, Math.max(30000, (session.expiresIn - 60) * 1000));
    await health();
    if (run === playback) healthTimer = setInterval(health, 15000);
  } catch (err) { if (run === playback) { stopVideo(); say(err.message, true); } }
}
function clearAccount() {
  identity++; stopVideo(); stopEvents?.(); stopEvents = null; stopMessage?.(); stopMessage = null;
  eventRows = []; renderEvents(); closeMedia(); $('eventDialog').close();
  $('accountBadge').textContent = 'Chưa đăng nhập'; $('pushState').textContent = 'Chưa bật';
  $('piState').textContent = 'Chưa kết nối'; $('aiState').textContent = 'Chưa xác định';
  pushTokenDoc = null;
}
async function initialize(next) {
  stopAuth?.(); clearAccount(); cloud = null; config = next;
  const [appSdk, authSdk, dbSdk, storageSdk] = await Promise.all(['firebase-app', 'firebase-auth', 'firebase-firestore', 'firebase-storage'].map(name => import(sdkBase + name + '.js')));
  const name = `pi-${next.firebase.projectId}-${next.firebase.apiKey}`;
  const app = appSdk.getApps().find(item => item.name === name) || appSdk.initializeApp(next.firebase, name);
  const auth = authSdk.getAuth(app); await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
  cloud = { app, auth, authSdk, db: dbSdk.getFirestore(app), dbSdk, storage: storageSdk.getStorage(app), storageSdk };
  stopAuth = authSdk.onAuthStateChanged(auth, user => {
    clearAccount();
    if (!user || user.isAnonymous) return;
    $('accountBadge').textContent = user.email || 'Đã đăng nhập';
    loginStatus('Đã đăng nhập: ' + (user.email || 'tài khoản Firebase'));
    $('loginEmail').value = user.email || '';
    const storedToken = localStorage.getItem(tokenStorageKey(user.uid));
    if (storedToken) { pushTokenDoc = cloud.dbSdk.doc(cloud.db, 'users', user.uid, 'pushTokens', storedToken); $('pushState').textContent = 'Đã đăng ký trước'; }
    subscribeEvents(); health();
    attachMessages().catch(err => say('Chưa khởi tạo được thông báo: ' + err.message, true));
  });
}
function subscribeEvents() {
  stopEvents?.(); const c = cloud, user = c?.auth.currentUser;
  if (!user || user.isAnonymous) return;
  const run = identity, f = c.dbSdk;
  $('eventSummary').textContent = 'Đang tải sự kiện…';
  stopEvents = f.onSnapshot(f.query(f.collection(c.db, 'users', user.uid, 'events'), f.orderBy('createdAt', 'desc'), f.limit(limit)), snap => {
    if (run !== identity) return;
    eventRows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })); renderEvents();
    $('eventSummary').textContent = `Đã tải ${eventRows.length} sự kiện gần nhất. Dữ liệu cập nhật tự động.`;
    $('moreEvents').disabled = snap.size < limit || limit >= 200;
  }, err => say('Không tải được thư viện Firebase: ' + err.message, true));
}
function renderEvents() {
  const container = $('piEvents'); container.replaceChildren();
  const rows = eventRows.filter(row => $('eventFilter').value === 'all' || row.kind === $('eventFilter').value);
  if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = cloud?.auth.currentUser ? 'Chưa có sự kiện phù hợp. Bấm Lưu ảnh & đoạn video để thử.' : 'Đăng nhập để xem lại ảnh/video.'; container.append(empty); }
  for (const row of rows) {
    const card = document.createElement('article'); card.className = 'event';
    if (new URL(location.href).searchParams.get('event') === row.id) card.classList.add('highlight');
    const body = document.createElement('div'); body.className = 'event-body';
    const title = document.createElement('h3'); title.textContent = labels[row.kind] || 'Sự kiện camera';
    const time = document.createElement('p'); time.textContent = row.createdAt?.toDate?.().toLocaleString('vi-VN') || 'Đang cập nhật thời gian';
    const state = document.createElement('p'); state.className = 'event-status'; state.textContent = row.partial ? '☁ Đã lưu · video có thể ngắn hơn do khởi động lại' : '☁ Đã lưu trên Firebase';
    const actions = document.createElement('div'); actions.className = 'event-actions';
    const uid = cloud?.auth.currentUser?.uid;
    const files = Array.isArray(row.files) ? row.files.filter(path => typeof path === 'string' && path.startsWith(`users/${uid}/events/${row.id}/`)) : [];
    for (const path of files) {
      const button = document.createElement('button'); button.textContent = /\.(jpg|jpeg|png)$/i.test(path) ? 'Xem ảnh' : '▶ Xem video';
      button.onclick = () => openMedia(row, path, button); actions.append(button);
    }
    if (!files.length) { const text = document.createElement('small'); text.textContent = 'Sự kiện chưa có tệp đính kèm.'; actions.append(text); }
    body.append(title, time, state, actions); card.append(body); container.append(card);
  }
}
async function openMedia(row, path, button) {
  const run = identity, c = cloud; button.disabled = true;
  try {
    const blob = await c.storageSdk.getBlob(c.storageSdk.ref(c.storage, path));
    if (run !== identity) return;
    closeMedia(); const url = URL.createObjectURL(blob); mediaUrls.push(url);
    const isImage = blob.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(path);
    const media = document.createElement(isImage ? 'img' : 'video'); media.src = url;
    if (isImage) media.alt = 'Ảnh tại thời điểm ghi nhận sự kiện'; else { media.controls = true; media.playsInline = true; media.autoplay = true; }
    const download = document.createElement('a'); download.href = url; download.download = `${row.id}-${path.split('/').pop()}`; download.textContent = '↓ Tải về thiết bị';
    $('eventMedia').append(media, download); $('eventTitle').textContent = labels[row.kind] || 'Sự kiện';
    if (!$('eventDialog').open) $('eventDialog').showModal();
  } catch (err) { say('Không mở được tệp: ' + err.message + '. Kiểm tra Storage rules và CORS.', true); }
  finally { button.disabled = false; }
}
async function attachMessages() {
  const run = identity, c = cloud;
  const m = await import(sdkBase + 'firebase-messaging.js');
  if (run !== identity || !await m.isSupported()) return;
  stopMessage = m.onMessage(m.getMessaging(c.app), payload => { if (run === identity) { say(`${payload.data?.title || 'Sự kiện camera'}: ${payload.data?.body || 'Có ảnh/video mới trong thư viện.'}`); subscribeEvents(); } });
}
async function configureFromForm() {
  const firebase = parseFirebaseConfig($('firebaseJson').value);
  const pi = $('piOrigin').value.trim();
  const next = { piOrigin: pi ? origin(pi) : '', firebase, vapidKey: $('vapidKey').value.trim() };
  await initialize(next);
  localStorage.setItem('piViewerConfig', JSON.stringify(next));
}
$('piConfigForm').onsubmit = async event => {
  event.preventDefault();
  try {
    await configureFromForm(); say('Đã lưu cấu hình Firebase. Bạn có thể đăng nhập; địa chỉ Pi có thể bổ sung sau.'); loginStatus('Cấu hình đã sẵn sàng. Nhập tài khoản đã tạo trong Firebase Authentication.');
  } catch (err) { say('Không lưu được cấu hình: ' + err.message, true); loginStatus(err.message, true); }
};
$('piLoginForm').onsubmit = async event => {
  event.preventDefault(); $('loginButton').disabled = true;
  loginStatus('Đang đăng nhập…');
  try {
    if (!cloud) {
      if (!$('firebaseJson').value.trim()) throw Error('Chưa có Firebase Web config. Điền cấu hình ở bên cạnh rồi đăng nhập. App chưa có tài khoản mặc định.');
      await configureFromForm();
    }
    await cloud.authSdk.signInWithEmailAndPassword(cloud.auth, $('loginEmail').value.trim(), $('loginPassword').value);
    $('loginPassword').value = ''; say('Đã đăng nhập. Bấm Xem camera để kết nối Pi.');
  } catch (err) { const message = loginError(err); loginStatus(message, true); say('Đăng nhập thất bại: ' + message, true); }
  finally { $('loginButton').disabled = false; }
};
$('registerButton').onclick = async () => {
  if (!$('piLoginForm').reportValidity()) return;
  $('registerButton').disabled = true; $('loginButton').disabled = true;
  loginStatus('Đang tạo tài khoản Firebase…');
  try {
    if (!cloud) await configureFromForm();
    await cloud.authSdk.createUserWithEmailAndPassword(cloud.auth, $('loginEmail').value.trim(), $('loginPassword').value);
    $('loginPassword').value = '';
    say('Đã tạo tài khoản và đăng nhập. Cần cấp quyền UID của tài khoản trên Pi để xem camera.');
  } catch (err) { const message = loginError(err); loginStatus(message, true); say('Chưa tạo được tài khoản: ' + message, true); }
  finally { $('registerButton').disabled = false; $('loginButton').disabled = false; }
};
$('logoutButton').onclick = async () => {
  try {
    if (pushTokenDoc && cloud) await cloud.dbSdk.deleteDoc(pushTokenDoc);
    if (cloud?.auth.currentUser) localStorage.removeItem(tokenStorageKey(cloud.auth.currentUser.uid));
    if (cloud && pushTokenDoc) { const m = await import(sdkBase + 'firebase-messaging.js'); await m.deleteToken(m.getMessaging(cloud.app)); }
    if (cloud) await cloud.authSdk.signOut(cloud.auth);
    clearAccount(); loginStatus('Đã đăng xuất.'); say('Đã đăng xuất thiết bị này.');
  } catch (err) { say('Chưa đăng xuất được: ' + err.message, true); }
};
$('playPi').onclick = startVideo; $('stopPi').onclick = stopVideo;
$('fullscreenPi').onclick = () => { if (video.requestFullscreen) video.requestFullscreen().catch(err => say(err.message, true)); else video.webkitEnterFullscreen?.(); };
$('saveClip').onclick = async () => {
  $('saveClip').disabled = true;
  try { const result = await api('/api/events', { method: 'POST', body: JSON.stringify({ kind: 'manual' }) }); say(`Pi đã nhận sự kiện ${result.id.slice(0, 8)}. Đang giữ thêm 10 giây video; ảnh/video sẽ xuất hiện khi tải Firebase xong.`); }
  catch (err) { say('Không lưu được sự kiện: ' + err.message, true); }
  finally { $('saveClip').disabled = false; }
};
$('enablePush').onclick = async () => {
  try {
    const c = cloud, user = c?.auth.currentUser, run = identity;
    if (!user || user.isAnonymous) throw Error('Đăng nhập trước khi bật thông báo.');
    if (!config.vapidKey || !config.firebase.messagingSenderId) throw Error('Cần messagingSenderId trong Firebase config và VAPID public key.');
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw Error('Thiết bị chưa hỗ trợ. Trên iPhone, thêm app vào màn hình chính rồi mở app để bật thông báo.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw Error('Chưa cấp quyền thông báo. Có thể đổi trong cài đặt trình duyệt/thiết bị.');
    const m = await import(sdkBase + 'firebase-messaging.js');
    if (!await m.isSupported()) throw Error('Trình duyệt chưa hỗ trợ Firebase Web Push.');
    const encoded = encodeURIComponent(JSON.stringify(config.firebase));
    const registration = await navigator.serviceWorker.register('/push-sw.js?config=' + encoded, { scope: '/push/' });
    await new Promise((resolve, reject) => { if (registration.active) return resolve(); const worker = registration.installing || registration.waiting; if (!worker) return reject(Error('Chưa khởi tạo được push worker.')); const timeout = setTimeout(() => reject(Error('Khởi tạo push worker quá lâu, hãy thử lại.')), 15000); worker.addEventListener('statechange', () => { if (worker.state === 'activated') { clearTimeout(timeout); resolve(); } else if (worker.state === 'redundant') { clearTimeout(timeout); reject(Error('Push worker không khả dụng.')); } }); });
    const token = await m.getToken(m.getMessaging(c.app), { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
    if (run !== identity) return;
    if (!token) throw Error('Chưa lấy được mã thông báo.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2, '0')).join('');
    pushTokenDoc = c.dbSdk.doc(c.db, 'users', user.uid, 'pushTokens', hash);
    await c.dbSdk.setDoc(pushTokenDoc, { token, updatedAt: c.dbSdk.serverTimestamp() });
    localStorage.setItem(tokenStorageKey(user.uid), hash);
    $('pushState').textContent = 'Đã đăng ký'; say('Đã đăng ký nhận thông báo trên thiết bị này. Cần Pi gửi một sự kiện để kiểm tra nhận thực tế.');
  } catch (err) { say('Chưa bật được thông báo: ' + err.message, true); }
};
$('eventFilter').onchange = renderEvents;
$('moreEvents').onclick = () => { limit = Math.min(200, limit + 20); subscribeEvents(); };
video.addEventListener('playing', () => { $('liveEmpty').hidden = true; $('liveBadge').textContent = '● LIVE'; say('Đang xem camera Raspberry Pi.'); });
video.addEventListener('error', () => { if (video.error) say('Không phát được camera. Kiểm tra Pi, HTTPS và định dạng HLS.', true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && video.src && cloud?.auth.currentUser) health(); });
window.addEventListener('pagehide', stopVideo);
// A separate dialog keeps playback uninterrupted when a new event arrives.
const dialog = document.createElement('dialog'); dialog.id = 'eventDialog';
const heading = document.createElement('h2'); heading.id = 'eventTitle';
const close = document.createElement('button'); close.textContent = 'Đóng'; close.onclick = () => dialog.close();
const media = document.createElement('div'); media.id = 'eventMedia'; media.className = 'event-media';
dialog.append(heading, close, media); dialog.addEventListener('close', closeMedia); document.body.append(dialog);
loginStatus('Đang tải cấu hình Firebase của nhóm…');
try {
  const saved = localStorage.getItem('piViewerConfig');
  if (saved) { const next = JSON.parse(saved); next.piOrigin = next.piOrigin ? origin(next.piOrigin) : ''; $('piOrigin').value = next.piOrigin; $('firebaseJson').value = JSON.stringify(next.firebase, null, 2); $('vapidKey').value = next.vapidKey || ''; initialize(next).catch(err => { loginStatus(loginError(err), true); say('Chưa kết nối được Firebase: ' + err.message, true); }); }
  else {
    const firebase = await loadFirebaseDefaults();
    const next = {firebase, piOrigin: '', vapidKey: ''};
    $('firebaseJson').value = JSON.stringify(firebase, null, 2);
    await initialize(next);
    localStorage.setItem('piViewerConfig', JSON.stringify(next));
  }
  if (!cloud?.auth.currentUser) loginStatus('Đã cấu hình Firebase. Nhập email/mật khẩu để đăng nhập, hoặc bấm Tạo tài khoản nếu chưa có.');
} catch (err) { loginStatus(loginError(err), true); say('Không đọc được cấu hình: ' + err.message, true); }
