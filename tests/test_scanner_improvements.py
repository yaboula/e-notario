from io import BytesIO
import json
from uuid import uuid4

import cv2
import numpy as np
import pytest
from PIL import Image

from cnie_rectifier import CnieRectifier, RectifierConfig, RectificationStatus
from cnie_rectifier.classical import OpenCvDetector
from cnie_rectifier.enhancement import enhance_card
from cnie_rectifier.geometry import quad_iou
from cnie_capture.api import create_app
from fastapi.testclient import TestClient

TOKEN = "local-scanner-test-token-only"


def normalized(corners, dimensions):
    return (corners / np.array([dimensions[0] - 1, dimensions[1] - 1])).tolist()


def test_opencv_recovers_color_and_rounded_borders(portrait_colored_capture):
    payload, corners = portrait_colored_capture
    image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
    result = OpenCvDetector(RectifierConfig()).detect(image)
    assert result.valid, result.summary()
    assert result.metrics["recipe"] == "color_canny"
    assert quad_iou(result.corners, corners) > .98


def test_manual_selection_recovers_weak_edges_without_calling_detectors():
    image = np.full((1800, 2400, 3), 180, np.uint8)
    ok, encoded = cv2.imencode('.png', image)
    assert ok
    engine = CnieRectifier()
    def must_not_run(_):
        raise AssertionError("Manual selection must not run an automatic detector")
    engine.opencv_detector.detect = must_not_run
    engine.docquad_detector.detect = must_not_run
    corners = [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]
    result = engine.rectify(encoded.tobytes(), manual_corners=corners)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.detector_used.value == 'manual'
    assert result.warnings == ['MANUAL_CORNERS']
    assert result.quality_metrics['edge_support'] == 0
    crossed = [corners[0], corners[2], corners[1], corners[3]]
    assert engine.rectify(encoded.tobytes(), manual_corners=crossed).rejection_codes == ['INVALID_MANUAL_CORNERS']
    too_small = [[.3,.3],[.6,.3],[.6,.6],[.3,.6]]
    assert 'INSUFFICIENT_CARD_RESOLUTION' in engine.rectify(encoded.tobytes(), manual_corners=too_small).rejection_codes


def test_manual_coordinates_match_exif_oriented_photo(synthetic_capture):
    payload, corners = synthetic_capture
    image = Image.open(BytesIO(payload))
    raw = image.transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif(); exif[274] = 6
    stream = BytesIO(); raw.save(stream, format='JPEG', quality=96, exif=exif)
    result = CnieRectifier().rectify(stream.getvalue(), manual_corners=normalized(corners, image.size))
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.original_dimensions == image.size
    assert np.allclose(result.corners, corners, atol=.01)


def test_enhancement_preserves_uniform_image_and_limits_shadow_correction():
    uniform = np.full((1008,1600,3), 190, np.uint8)
    output, metrics = enhance_card(uniform)
    assert np.array_equal(output, uniform)
    assert not metrics['illumination_balanced']
    gradient = np.linspace(70,220,1600).astype(np.uint8)
    shaded = np.repeat(np.repeat(gradient[None,:,None],1008,axis=0),3,axis=2)
    # Synthetic text stays present; correction affects broad illumination only.
    cv2.putText(shaded, 'TEST 0123456789', (200,500), cv2.FONT_HERSHEY_SIMPLEX, 2, (25,25,25), 3)
    output, metrics = enhance_card(shaded)
    assert metrics['illumination_balanced']
    assert metrics['max_luminance_correction'] <= 12
    assert output[:100,:200].mean() > shaded[:100,:200].mean()
    assert output[:100,-200:].mean() < shaded[:100,-200:].mean()
    assert output[475:500,230:600].min() < 55


@pytest.fixture
def scanner_client(monkeypatch):
    async def local_only(self, capture):
        capture.ocr_summary.status = 'queued'
    monkeypatch.setattr('cnie_capture.api.State.queue_ocr', local_only)
    with TestClient(create_app(desktop_token=TOKEN, mobile_url="https://192.168.1.20:8788")) as client:
        yield client


def test_preview_is_advisory_authenticated_bounded_and_not_retained(scanner_client, synthetic_capture):
    payload, _ = synthetic_capture
    frame = cv2.imdecode(np.frombuffer(payload,np.uint8),cv2.IMREAD_COLOR)
    ok, encoded = cv2.imencode('.jpg', cv2.resize(frame,(640,480)))
    assert ok
    headers = {'Authorization':f'Bearer {TOKEN}', 'Content-Type':'image/jpeg'}
    assert scanner_client.post('/api/capture-preview', content=encoded.tobytes()).status_code == 401
    response = scanner_client.post('/api/capture-preview',content=encoded.tobytes(),headers=headers)
    assert response.status_code == 200
    assert response.json()['guidance'] == 'ready'
    assert len(response.json()['corners']) == 4
    assert response.headers['cache-control'] == 'no-store'
    state = scanner_client.app.state.capture
    assert state.captures == {} and state.documents == {} and state.ocr_queue.empty()
    assert scanner_client.post('/api/capture-preview',content=payload,headers=headers).status_code in {400,413}
    assert scanner_client.post('/api/capture-preview',content=b'x'*(512*1024+1),headers=headers).status_code == 413
    state.processing = True
    assert scanner_client.post('/api/capture-preview',content=encoded.tobytes(),headers=headers).status_code == 429


def test_correction_replaces_rejected_capture_with_isolation_and_idempotency(scanner_client, synthetic_capture):
    client = scanner_client
    payload, corners = synthetic_capture
    challenge = client.post('/api/pairing',headers={'Authorization':f'Bearer {TOKEN}'}).json()
    phone = client.post('/api/pair',json={'code':challenge['url'].split('#pair=')[1]}).json()['token']
    headers={'Authorization':f'Bearer {phone}','Content-Type':'image/png','Idempotency-Key':str(uuid4())}
    # Deliberately undersized selection produces a rejection, with no OCR.
    headers['X-Document-Corners']=json.dumps({'corners':[[.3,.3],[.6,.3],[.6,.6],[.3,.6]]})
    rejected = client.post('/api/captures',content=payload,headers=headers).json()
    assert rejected['review'] == 'retake'
    query = f"/api/captures?document_id={rejected['document_id']}"
    headers['Idempotency-Key']=str(uuid4())
    headers['X-Document-Corners']=json.dumps({'corners':normalized(corners,(2400,1800))})
    accepted = client.post(query,content=payload,headers=headers)
    assert accepted.status_code == 200
    capture = accepted.json()
    assert capture['review'] == 'accepted' and capture['attempt'] == 2
    assert capture['ocr_summary']['status'] == 'queued'
    assert client.post(query,content=payload,headers=headers).json()['id'] == capture['id']
    headers['X-Document-Corners']=json.dumps({'corners':[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]})
    assert client.post(query,content=payload,headers=headers).status_code == 409
    state=client.app.state.capture
    assert not state.captures[rejected['id']].active
    assert len(state.captures) == 2
    stranger=client.post('/api/pairing',headers={'Authorization':f'Bearer {TOKEN}'}).json()
    other=client.post('/api/pair',json={'code':stranger['url'].split('#pair=')[1]}).json()['token']
    headers['Authorization']=f'Bearer {other}'
    assert client.post(query,content=payload,headers=headers).status_code == 404


@pytest.mark.parametrize('selection', ["bad-json", '{"corners":[]}', '{"corners":[[true,0],[1,0],[1,1],[0,1]]}',
                                      '{"corners":[[-.1,0],[1,0],[1,1],[0,1]]}', '{"corners":[[NaN,0],[1,0],[1,1],[0,1]]}'])
def test_invalid_corner_header_never_creates_capture(scanner_client, selection):
    response=scanner_client.post('/api/captures',content=b'invalid',headers={
        'Authorization':f'Bearer {TOKEN}','Content-Type':'image/png','Idempotency-Key':str(uuid4()),'X-Document-Corners':selection})
    assert response.status_code == 400
    assert response.json()['detail'] == 'INVALID_MANUAL_CORNERS'
    assert scanner_client.app.state.capture.captures == {}
