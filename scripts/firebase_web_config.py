"""Read a project's Web config; never write the service-account key to disk.

Run interactively and pass service-account JSON on hidden stdin. The caller must
have permission to list Firebase Web apps and read their config. Does not create
users, change Authentication, or create new Web apps.
"""
import json
from pathlib import Path
import sys


def read_hidden_json():
    if not sys.stdin.isatty():
        return json.load(sys.stdin)
    print('Ready for service-account JSON on hidden stdin.', flush=True)
    if sys.platform == 'win32':
        import msvcrt
        characters = []
        while True:
            char = msvcrt.getwch()
            if char == '\x03':
                raise KeyboardInterrupt
            if char in ('\r', '\n'):
                break
            if char == '\b':
                if characters:
                    characters.pop()
            else:
                characters.append(char)
        return json.loads(''.join(characters))
    import getpass
    return json.loads(getpass.getpass(''))


def main():
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request, AuthorizedSession

    class TimedRequest(Request):
        def __call__(self, *args, **kwargs):
            kwargs['timeout'] = 20
            return super().__call__(*args, **kwargs)

    account = read_hidden_json()
    project = account.get('project_id', '')
    if not project or '/' in project:
        raise ValueError('Invalid project ID')
    credentials = service_account.Credentials.from_service_account_info(account, scopes=[
        'https://www.googleapis.com/auth/firebase.readonly'])
    account.clear()
    credentials.refresh(TimedRequest())
    session = AuthorizedSession(credentials)
    base = f'https://firebase.googleapis.com/v1beta1/projects/{project}'
    response = session.get(base + '/webApps', timeout=20)
    if not response.ok:
        print(json.dumps({'ok': False, 'step': 'list_web_apps', 'status': response.status_code,
                          'reason': response.json().get('error', {}).get('status', 'request_failed')}))
        return 1
    apps = response.json().get('apps', [])
    if not apps:
        print(json.dumps({'ok': False, 'reason': 'no_web_app_registered', 'projectId': project}))
        return 1
    app = apps[0]
    name = app.get('name', '')
    if not name.startswith(f'projects/{project}/webApps/'):
        raise ValueError('Unexpected Firebase app resource')
    response = session.get(f'https://firebase.googleapis.com/v1beta1/{name}/config', timeout=20)
    if not response.ok:
        print(json.dumps({'ok': False, 'step': 'read_web_config', 'status': response.status_code}))
        return 1
    allowed = {'apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL'}
    config = {key: value for key, value in response.json().items() if key in allowed}
    if not config.get('apiKey') or not config.get('appId') or config.get('projectId') != project:
        raise ValueError('Incomplete Web config')
    output = Path(__file__).resolve().parent.parent / 'public' / 'firebase-config.json'
    output.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'projectId': project, 'output': 'public/firebase-config.json'}))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        # Never print exception values: upstream errors may include credentials.
        print(json.dumps({'ok': False, 'reason': type(error).__name__}))
        sys.exit(1)
