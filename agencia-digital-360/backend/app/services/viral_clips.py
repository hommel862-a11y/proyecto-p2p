from pathlib import Path
from typing import Optional
import uuid
from app.core.security import validate_local_inbox_path


class Kalman1DCropFilter:
    """
    1D Kalman + dead-zone smoothing filter for MediaPipe / OpenCV 16:9 -> 9:16
    speaker face tracking. Prevents frame-to-frame horizontal jitter.
    """

    def __init__(
        self,
        source_width: int = 1920,
        source_height: int = 1080,
        process_variance: float = 1e-2,
        measurement_variance: float = 0.18,
    ) -> None:
        self.source_width = source_width
        self.source_height = source_height
        self.crop_h = source_height
        self.crop_w = int(round(source_height * (9.0 / 16.0)))
        if self.crop_w % 2 != 0:
            self.crop_w += 1  # Ensure even pixel width (608px for 1080p) for H.264 YUV420p
        self._q = process_variance
        self._r = measurement_variance
        self._estimate_x: Optional[float] = None
        self._error_cov: float = 1.0

    def compute_916_crop_box(self, detected_face_center_x: float) -> dict:
        if self._estimate_x is None:
            self._estimate_x = float(detected_face_center_x)
        else:
            # Prediction update
            prior_cov = self._error_cov + self._q
            # Measurement update (Kalman gain)
            kalman_gain = prior_cov / (prior_cov + self._r)
            self._estimate_x = self._estimate_x + kalman_gain * (
                float(detected_face_center_x) - self._estimate_x
            )
            self._error_cov = (1.0 - kalman_gain) * prior_cov

        half_w = self.crop_w // 2
        center_x = int(round(self._estimate_x))
        crop_x = max(0, min(self.source_width - self.crop_w, center_x - half_w))

        return {
            "crop_x": crop_x,
            "crop_y": 0,
            "crop_w": self.crop_w,
            "crop_h": self.crop_h,
            "target_resolution": "1080x1920",
        }


class ViralClipsService:
    """
    Dual-Input Surgical Viral Clips Extractor:
    - Mode A (PC_LOCAL_INBOX): Strictly confined to E:\\Agencia_Inbox\\ in read-only mode.
    - Mode B (YOUTUBE_SURGICAL): Uses `yt-dlp --download-sections` to download ONLY the
      Gemini-curated timestamp window rather than the full video.
    """

    def __init__(self, allowed_inbox_root: Optional[Path] = None) -> None:
        self._allowed_inbox_root = allowed_inbox_root or Path(r"E:\Agencia_Inbox")

    def prepare_local_inbox_clip(
        self,
        brand_id: str,
        file_path: str,
        start_sec: float,
        end_sec: float,
    ) -> dict:
        if end_sec <= start_sec:
            raise ValueError("end_sec must be greater than start_sec")
        resolved = validate_local_inbox_path(
            file_path,
            allowed_root=self._allowed_inbox_root,
        )
        clip_id = f"clip_loc_{uuid.uuid4().hex[:8]}"
        return {
            "clip_id": clip_id,
            "brand_id": brand_id,
            "source_mode": "PC_LOCAL_INBOX",
            "validated_source_path": str(resolved),
            "start_sec": round(start_sec, 2),
            "end_sec": round(end_sec, 2),
            "duration_sec": round(end_sec - start_sec, 2),
            "output_aspect_ratio": "9:16",
            "reframe_engine": "mediapipe_facemesh_kalman_1d",
            "subtitle_engine": "faster-whisper",
            "worker_queue": "video_heavy",
            "concurrency_slot": 1,
        }

    def prepare_youtube_surgical_clip(
        self,
        brand_id: str,
        youtube_url: str,
        start_timestamp: str,
        end_timestamp: str,
    ) -> dict:
        if not youtube_url.startswith(("https://www.youtube.com/", "https://youtu.be/")):
            raise ValueError("Invalid YouTube URL")
        clip_id = f"clip_yt_{uuid.uuid4().hex[:8]}"
        section_arg = f"*{start_timestamp}-{end_timestamp}"
        yt_dlp_cmd = [
            "yt-dlp",
            "--no-playlist",
            "--download-sections",
            section_arg,
            "--force-keyframes-at-cuts",
            "-f",
            "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]",
            "-o",
            f"storage/clips/{clip_id}.%(ext)s",
            youtube_url,
        ]
        return {
            "clip_id": clip_id,
            "brand_id": brand_id,
            "source_mode": "YOUTUBE_SURGICAL",
            "youtube_url": youtube_url,
            "section_range": section_arg,
            "yt_dlp_command": yt_dlp_cmd,
            "output_aspect_ratio": "9:16",
            "reframe_engine": "mediapipe_facemesh_kalman_1d",
            "subtitle_engine": "faster-whisper",
            "worker_queue": "video_heavy",
            "concurrency_slot": 1,
        }
