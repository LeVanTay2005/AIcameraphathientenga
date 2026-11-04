"""API/contract tests with fake camera/cloud; never accesses a real camera."""
import importlib.util
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

AVAILABLE = all(importlib.util.find_spec(name) for name in ('fastapi', 'httpx', 'dotenv'))
if AVAILABLE:
    from fastapi.testclient import TestClient
    import agent


@unittest.skipUnless(AVAILABLE, 'API tests need fastapi, httpx and python-dotenv')
class AgentAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.live = self.root / 'live'
        self.live.mkdir()
        self.outbox = self.root / 'outbox'
        self.outbox.mkdir()
        (self.live / 'index.m3u8').write_text('#EXTM3U\n#EXTINF:2,\nseg_000000001.ts\n')
        (self.live / 'seg_000000001.ts').write_bytes(b'test-segment')
        self.fake_service = SimpleNamespace(last_frame=time.monotonic(), camera_error='', ai_ready=True,
                                            ai_error='', upload_error='', trigger=Mock(return_value='event123'))
        auth = Mock()
        auth.verify_id_token.return_value = {'uid': 'group-user', 'firebase': {'sign_in_provider': 'password'}}
        self.patches = [patch.object(agent, 'LIVE', self.live), patch.object(agent, 'OUTBOX', self.outbox),
                        patch.object(agent, 'KEY', 'a' * 32), patch.object(agent, 'OWNER', 'group-user'),
                        patch.object(agent, 'service', self.fake_service), patch.object(agent, 'admin_auth', auth)]
        for item in self.patches:
            item.start()
        # Do not enter lifespan: hardware and Firebase are replaced above.
        self.client = TestClient(agent.app)
        self.headers = {'Authorization': 'Bearer valid-firebase-id-token'}

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def test_private_api_requires_owner_and_rejects_anonymous(self):
        self.assertEqual(self.client.get('/api/status').status_code, 401)
        self.assertEqual(self.client.get('/api/status', headers=self.headers).status_code, 200)
        agent.admin_auth.verify_id_token.return_value = {'uid': 'another-user'}
        self.assertEqual(self.client.get('/api/status', headers=self.headers).status_code, 403)
        agent.admin_auth.verify_id_token.return_value = {'uid': 'group-user', 'firebase': {'sign_in_provider': 'anonymous'}}
        self.assertEqual(self.client.get('/api/status', headers=self.headers).status_code, 403)

    def test_hls_session_signs_playlist_and_segments_and_rejects_forgery(self):
        response = self.client.post('/api/session', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        playlist = self.client.get(response.json()['playlist'])
        self.assertEqual(playlist.status_code, 200)
        self.assertEqual(playlist.headers['cache-control'], 'no-store')
        segment = [line for line in playlist.text.splitlines() if line and not line.startswith('#')][0]
        self.assertEqual(self.client.get('/hls/' + segment).content, b'test-segment')
        self.assertEqual(self.client.get('/hls/index.m3u8?session=forged').status_code, 401)
        signed = response.json()['playlist'].split('?', 1)[1]
        self.assertEqual(self.client.get('/hls/service-account.json?' + signed).status_code, 404)

    def test_manual_event_limits_and_errors(self):
        response = self.client.post('/api/events', headers=self.headers, json={'kind': 'manual'})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()['state'], 'collecting')
        self.assertEqual(self.client.post('/api/events', headers=self.headers, json={'kind': 'fall'}).status_code, 400)
        self.fake_service.trigger.return_value = None
        self.assertEqual(self.client.post('/api/events', headers=self.headers, json={}).status_code, 429)
        self.fake_service.trigger.side_effect = RuntimeError('Camera chưa có hình mới')
        self.assertEqual(self.client.post('/api/events', headers=self.headers, json={}).status_code, 503)

    def test_existing_detector_endpoint_is_disabled_without_matching_key(self):
        with patch.dict('os.environ', {'EVENT_INGEST_KEY': ''}):
            self.assertEqual(self.client.post('/api/ingest-event', json={'kind': 'fall'}).status_code, 403)
        with patch.dict('os.environ', {'EVENT_INGEST_KEY': 'private-key'}):
            self.assertEqual(self.client.post('/api/ingest-event', headers={'Authorization': 'Bearer wrong'}, json={'kind': 'fall'}).status_code, 403)
            result = self.client.post('/api/ingest-event', headers={'Authorization': 'Bearer private-key'}, json={'kind': 'fall'})
            self.assertEqual(result.status_code, 202)

    def test_camera_not_ready_does_not_issue_session(self):
        self.fake_service.last_frame = 0
        self.assertEqual(self.client.post('/api/session', headers=self.headers).status_code, 503)

    def test_mediamtx_webrtc_auth_checks_owner_path_and_read_only(self):
        request = {'action': 'read', 'protocol': 'webrtc', 'path': agent.MEDIA_PATH, 'token': 'firebase-token'}
        result = self.client.post('/internal/media-auth', json=request)
        self.assertEqual(result.status_code, 200)
        self.assertIn('expireAt', result.json())
        self.assertEqual(self.client.post('/internal/media-auth', json={**request, 'action': 'publish'}).status_code, 403)
        self.assertEqual(self.client.post('/internal/media-auth', json={**request, 'path': 'other-camera'}).status_code, 403)
        agent.admin_auth.verify_id_token.return_value = {'uid': 'not-the-owner'}
        self.assertEqual(self.client.post('/internal/media-auth', json=request).status_code, 403)

    def test_mediamtx_native_rtsp_requires_separate_credentials_and_allowed_ip(self):
        request = {'action': 'read', 'protocol': 'rtsp', 'path': agent.MEDIA_PATH,
                   'user': 'viewer', 'password': 'private-password', 'ip': '127.0.0.1'}
        with patch.dict('os.environ', {'MEDIA_RTSP_USER': 'viewer', 'MEDIA_RTSP_PASSWORD': 'private-password', 'MEDIA_RTSP_NETWORKS': '127.0.0.0/8'}):
            self.assertEqual(self.client.post('/internal/media-auth', json=request).status_code, 200)
            self.assertEqual(self.client.post('/internal/media-auth', json={**request, 'ip': '8.8.8.8'}).status_code, 401)
            self.assertEqual(self.client.post('/internal/media-auth', json={**request, 'password': 'wrong'}).status_code, 401)

    def test_recovered_snapshot_only_event_is_marked_partial(self):
        folder = self.outbox / 'event1'
        folder.mkdir()
        (folder / 'event.json').write_text(json.dumps({'id': 'event1', 'kind': 'fall', 'time': time.time() - 60, 'phase': 'collecting', 'partial': False}))
        service = agent.CameraService()
        service.finish_event(folder, recovered=True)
        event = json.loads((folder / 'event.json').read_text())
        self.assertEqual(event['phase'], 'ready')
        self.assertTrue(event['partial'])


if __name__ == '__main__':
    unittest.main()
