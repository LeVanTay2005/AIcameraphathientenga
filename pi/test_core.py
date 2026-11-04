import unittest
from types import SimpleNamespace
from core import FallDetector, issue_session, valid_session


def pose(horizontal=False, visible=True):
    points = [SimpleNamespace(x=.5, y=.5, visibility=1) for _ in range(33)]
    points[11] = points[12] = SimpleNamespace(x=.2 if horizontal else .5, y=.3, visibility=1 if visible else .1)
    points[23] = points[24] = SimpleNamespace(x=.5, y=.32 if horizontal else .6, visibility=1)
    return points


class StreamAuthorizationTests(unittest.TestCase):
    def test_valid_expired_forged_and_wrong_key(self):
        token = issue_session('a' * 32, 1000)
        self.assertTrue(valid_session(token, 'a' * 32, 1001))
        self.assertFalse(valid_session(token, 'a' * 32, 1600))
        self.assertFalse(valid_session(token, 'b' * 32, 1001))
        self.assertFalse(valid_session('99999999.' + token.split('.', 1)[1], 'a' * 32, 1001))

    def test_rejects_bad_tokens_and_distant_future(self):
        for token in ['', None, 'a.b.c', '1.a.b', 'x', '1.2.3.4']:
            self.assertFalse(valid_session(token, 'a' * 32, 1000))
        self.assertFalse(valid_session(issue_session('a' * 32, 1000, ttl=3600), 'a' * 32, 1000))


class FallDetectionTests(unittest.TestCase):
    def test_requires_upright_then_sustained_horizontal_and_cooldown(self):
        detector = FallDetector()
        self.assertFalse(detector.update(pose(True), 0, 640, 480))
        detector.update(pose(), .1, 640, 480)
        self.assertFalse(detector.update(pose(True), .3, 640, 480))
        self.assertTrue(detector.update(pose(True), 1.2, 640, 480))
        detector.update(pose(), 2, 640, 480)
        detector.update(pose(True), 2.2, 640, 480)
        self.assertFalse(detector.update(pose(True), 3.2, 640, 480))

    def test_ignores_missing_occluded_and_stale_poses(self):
        detector = FallDetector()
        detector.update(pose(), 0, 640, 480)
        self.assertFalse(detector.update(pose(True), 5, 640, 480))
        self.assertFalse(detector.update(None, 6, 640, 480))
        detector.update(pose(), 7, 640, 480)
        self.assertFalse(detector.update(pose(True, False), 7.1, 640, 480))
        self.assertFalse(detector.update(pose(True, False), 8.2, 640, 480))


if __name__ == '__main__':
    unittest.main()
