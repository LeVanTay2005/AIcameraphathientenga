import importlib.util
import unittest

AVAILABLE = bool(importlib.util.find_spec('dotenv'))
if AVAILABLE:
    from render_mediamtx import build_config


@unittest.skipUnless(AVAILABLE, 'Needs python-dotenv')
class MediaMTXConfigTests(unittest.TestCase):
    def test_rtsp_source_relay_webrtc_and_turn_are_configured_without_anonymous_access(self):
        config = build_config({'RTSP_SOURCE_URL': 'rtsp://camera/live', 'APP_ORIGINS': 'https://app.example',
                               'WEBRTC_PUBLIC_HOSTS': 'rtc.example,192.168.1.2',
                               'WEBRTC_ICE_SERVERS_JSON': '[{"url":"turn:turn.example:3478","username":"u","password":"p"}]'})
        self.assertEqual(config['paths']['camera']['source'], 'rtsp://camera/live')
        self.assertEqual(config['rtspAddress'], '127.0.0.1:8555')
        self.assertEqual(config['authMethod'], 'http')
        self.assertEqual(config['authHTTPExclude'], [])
        self.assertEqual(config['webrtcICEServers2'][0]['url'], 'turn:turn.example:3478')
        self.assertEqual(config['webrtcAllowOrigins'], ['https://app.example'])

    def test_rejects_non_rtsp_source_and_wildcard_app_origins(self):
        with self.assertRaises(ValueError):
            build_config({'RTSP_SOURCE_URL': 'http://camera/live', 'APP_ORIGINS': 'https://app.example'})
        with self.assertRaises(ValueError):
            build_config({'RTSP_SOURCE_URL': 'rtsp://camera/live', 'APP_ORIGINS': '*'})
