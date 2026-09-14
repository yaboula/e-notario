from io import BytesIO

import numpy as np
from PIL import Image

from cnie_rectifier.image_io import decode_image


def test_exif_orientation_is_applied():
    image = Image.fromarray(np.zeros((20, 40, 3), np.uint8), "RGB")
    exif = Image.Exif()
    exif[274] = 6
    stream = BytesIO()
    image.save(stream, format="JPEG", exif=exif)
    decoded, metrics = decode_image(stream.getvalue(), 1_000_000)
    assert decoded.shape[:2] == (40, 20)
    assert metrics["exif_orientation_applied"] is True
