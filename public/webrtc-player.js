export function createWebRTCPlayer({video, url, token, onError, onTrack, Reader = window.MediaMTXWebRTCReader}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !endpoint.pathname.endsWith('/whep')) throw Error('Cần endpoint WebRTC WHEP HTTPS hợp lệ, không chứa mật khẩu camera.');
  if (!Reader) throw Error('Chưa tải được client WebRTC.');
  let closed = false;
  const reader = new Reader({
    url: endpoint.href, token,
    onError: error => { if (!closed) onError?.(String(error)); },
    onTrack: event => {
      if (closed) return;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch(() => onError?.('Bấm nút phát trên video để bắt đầu.'));
      onTrack?.();
    }
  });
  return {close() { if (closed) return; closed = true; reader.close(); video.srcObject = null; }};
}
