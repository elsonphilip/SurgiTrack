"""Fingertip tracking with MediaPipe Hands (landmark 8 = index fingertip).

Optional dependencies (only on the Pi): pip install -r requirements-camera.txt
NOT yet tested against a real camera — written to the MediaPipe 'solutions' API. Imports are lazy so the rest of the
software (simulator, tests) runs without OpenCV/MediaPipe installed.
"""

INDEX_TIP = 8


class FingertipTracker:
    def __init__(self, camera_index=0, width=640, height=480, min_conf=0.5):
        import cv2
        import mediapipe as mp

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(camera_index)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.hands = mp.solutions.hands.Hands(
            max_num_hands=1, min_detection_confidence=min_conf, min_tracking_confidence=min_conf
        )
        self.width, self.height = width, height

    def read(self):
        """Return (x_px, y_px) of the index fingertip, or None if no hand / no frame."""
        ok, frame = self.cap.read()
        if not ok:
            return None
        res = self.hands.process(self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB))
        if not res.multi_hand_landmarks:
            return None
        lm = res.multi_hand_landmarks[0].landmark[INDEX_TIP]
        return (lm.x * self.width, lm.y * self.height)

    def close(self):
        self.cap.release()
        self.hands.close()
