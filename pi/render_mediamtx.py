"""Render MediaMTX config from private .env without printing RTSP credentials."""
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from dotenv import load_dotenv


def build_config(env):
    source = env.get('RTSP_SOURCE_URL', '')
    path = env.get('MEDIA_PATH', 'camera')
    if urlsplit(source).scheme not in {'rtsp', 'rtsps'}:
        raise ValueError('RTSP_SOURCE_URL must be rtsp:// or rtsps://')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', path):
        raise ValueError('MEDIA_PATH must be a simple stream name')
    origins = [value.strip().rstrip('/') for value in env.get('APP_ORIGINS', '').split(',') if value.strip()]
    if not origins or '*' in origins:
        raise ValueError('APP_ORIGINS must list your actual app origins')
    result = {
        'logLevel': 'warn', 'authMethod': 'http',
        'authHTTPAddress': 'http://127.0.0.1:8000/internal/media-auth', 'authHTTPExclude': [],
        'rtsp': True, 'rtspAddress': '127.0.0.1:8555', 'rtspTransports': ['tcp'],
        'rtmp': False, 'hls': False, 'srt': False, 'api': False,
        'webrtc': True, 'webrtcAddress': '127.0.0.1:8889',
        'webrtcAllowOrigins': origins, 'webrtcLocalUDPAddress': ':8189',
        'webrtcLocalTCPAddress': ':8189',
        'webrtcAdditionalHosts': [value.strip() for value in env.get('WEBRTC_PUBLIC_HOSTS', '').split(',') if value.strip()],
        'paths': {path: {'source': source, 'rtspTransport': 'tcp'}},
    }
    ice = env.get('WEBRTC_ICE_SERVERS_JSON', '')
    if ice:
        servers = json.loads(ice)
        if not isinstance(servers, list):
            raise ValueError('WEBRTC_ICE_SERVERS_JSON must be a JSON array')
        result['webrtcICEServers2'] = servers
    return result


if __name__ == '__main__':
    load_dotenv(Path(__file__).with_name('.env'))
    target = Path(__file__).with_name('mediamtx.generated.yml')
    # JSON is a valid YAML subset. This generated file can contain upstream secrets.
    with target.open('w', encoding='utf-8') as output:
        os.chmod(target, 0o600)
        json.dump(build_config(os.environ), output, indent=2)
    print('MediaMTX private config generated. Keep it out of public/ and Git.')
