"""Pure helpers for posture detection and short-lived stream authorization."""
import hashlib
import hmac
import secrets


def issue_session(key, now, ttl=600):
    payload = f"{int(now) + ttl}.{secrets.token_hex(12)}"
    signature = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def valid_session(token, key, now):
    try:
        expires, nonce, signature = token.split(".")
        if len(nonce) != 24 or len(signature) != 64:
            return False
        if not int(now) < int(expires) <= int(now) + 601:
            return False
        expected = hmac.new(key.encode(), f"{expires}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
    except (AttributeError, ValueError, TypeError):
        return False


class FallDetector:
    """Unvalidated upright-to-horizontal heuristic; never a medical diagnosis."""
    def __init__(self):
        self.upright = float("-inf")
        self.horizontal = None
        self.last_trigger = float("-inf")

    def update(self, points, now, width, height):
        if not points or any(points[i].visibility < .6 for i in (11, 12, 23, 24)):
            self.horizontal = None
            return False
        shoulder_x = (points[11].x + points[12].x) * width / 2
        shoulder_y = (points[11].y + points[12].y) * height / 2
        hip_x = (points[23].x + points[24].x) * width / 2
        hip_y = (points[23].y + points[24].y) * height / 2
        dx, dy = abs(shoulder_x - hip_x), abs(shoulder_y - hip_y)
        if dy > dx * 1.6:
            self.upright, self.horizontal = now, None
            return False
        if dx > dy * 1.4 and now - self.upright < 4.5:
            if self.horizontal is None:
                self.horizontal = now
            if now - self.horizontal > .8 and now - self.last_trigger > 30:
                self.last_trigger, self.upright, self.horizontal = now, float("-inf"), None
                return True
        else:
            self.horizontal = None
        return False
