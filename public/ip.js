const video=document.getElementById('ipVideo'),status=document.getElementById('ipStatus'),form=document.getElementById('ipForm');
let hls=null,run=0,timer;
function stop(){run++;clearTimeout(timer);if(hls){hls.destroy();hls=null;}video.pause();video.removeAttribute('src');video.load();status.textContent='Đã ngắt kết nối.';}
form.onsubmit=async event=>{event.preventDefault();stop();const current=run;try{
  const url=new URL(document.getElementById('streamUrl').value.trim());
  if(url.username||url.password)throw Error('Không đặt tài khoản hoặc mật khẩu camera trong URL phía ứng dụng.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)&&location.hostname===url.hostname))throw Error('Cần URL HTTPS để xem trên điện thoại và qua mạng di động.');
  if(!url.pathname.endsWith('.m3u8'))throw Error('Cần đường dẫn HLS .m3u8 từ máy chủ chuyển luồng. RTSP không phát trực tiếp trong trình duyệt.');
  status.textContent='Đang kết nối camera…';
  timer=setTimeout(()=>{if(current===run&&video.readyState<3)status.textContent='Chưa nhận được video. Kiểm tra máy chủ, quyền truy cập, codec và CORS.';},20000);
  if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url.href;await video.play();}
  else{
    const {default:Hls}=await import('https://cdn.jsdelivr.net/npm/hls.js@1.6.13/+esm');if(current!==run)return;
    if(!Hls.isSupported())throw Error('Trình duyệt không hỗ trợ phát HLS. Hãy dùng Safari trên iPhone hoặc Chrome/Edge tương thích.');
    hls=new Hls();hls.on(Hls.Events.ERROR,(_,data)=>{if(current===run&&data.fatal){hls?.destroy();hls=null;status.textContent='Không phát được camera: '+data.type+'. Kiểm tra máy chủ, quyền truy cập và CORS.';}});
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(current===run)video.play().catch(()=>{status.textContent='Bấm nút phát trên video để bắt đầu.';});});hls.loadSource(url.href);hls.attachMedia(video);
  }
}catch(err){if(current===run){clearTimeout(timer);status.textContent=err.message;}}};
video.addEventListener('playing',()=>{clearTimeout(timer);status.textContent='Đang xem camera trực tiếp.';});
video.addEventListener('waiting',()=>{if(video.currentSrc||hls)status.textContent='Đang chờ dữ liệu video…';});
video.addEventListener('error',()=>{if(video.error)status.textContent='Không đọc được luồng camera. Kiểm tra URL, đăng nhập máy chủ và codec.';});
document.getElementById('disconnectIp').onclick=stop;
document.getElementById('fullIp').onclick=()=>{if(video.requestFullscreen)video.requestFullscreen().catch(err=>{status.textContent=err.message;});else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();};
window.addEventListener('pagehide',stop);
