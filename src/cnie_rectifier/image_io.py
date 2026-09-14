from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import InvalidImageError


ALLOWED_FORMATS = {"JPEG", "PNG"}


def decode_image(image_bytes: bytes, max_pixels: int) -> tuple[np.ndarray, dict[str, object]]:
    if not isinstance(image_bytes, (bytes, bytearray, memoryview)) or not image_bytes:
        raise InvalidImageError("EMPTY_IMAGE", "The image payload is empty")
    try:
        with Image.open(BytesIO(bytes(image_bytes))) as source:
            detected_format = (source.format or "").upper()
            if detected_format not in ALLOWED_FORMATS:
                raise InvalidImageError(
                    "UNSUPPORTED_IMAGE_FORMAT", "Only JPEG and PNG are supported"
                )
            width, height = source.size
            if width < 2 or height < 2:
                raise InvalidImageError("IMAGE_TOO_SMALL", "Image dimensions are invalid")
            if width * height > max_pixels:
                raise InvalidImageError("IMAGE_TOO_LARGE", "Decoded image exceeds safety limit")
            exif_orientation = source.getexif().get(274)
            rgb = ImageOps.exif_transpose(source).convert("RGB")
            array = np.asarray(rgb, dtype=np.uint8)
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("IMAGE_DECODE_FAILED", "Image cannot be decoded safely") from exc

    bgr = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
    return np.ascontiguousarray(bgr), {
        "format": detected_format.lower(),
        "exif_orientation_applied": exif_orientation not in (None, 1),
    }


def encode_jpeg(image_bgr: np.ndarray, quality: int = 95) -> bytes:
    ok, encoded = cv2.imencode(
        ".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, int(quality)]
    )
    if not ok:
        raise RuntimeError("Could not encode rectified image")
    return encoded.tobytes()
