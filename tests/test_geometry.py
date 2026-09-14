import numpy as np

from cnie_rectifier.geometry import (
    card_diagonal_ratio,
    is_convex,
    is_self_intersecting,
    mean_corner_distance_ratio,
    order_quad,
    quad_iou,
    quad_inside_image,
    refine_quad_with_edges,
)


def test_order_quad_is_tl_tr_br_bl():
    shuffled = np.array([[90, 80], [10, 10], [15, 85], [95, 12]], np.float32)
    ordered = order_quad(shuffled)
    assert np.allclose(ordered, [[10, 10], [95, 12], [90, 80], [15, 85]])
    assert is_convex(ordered)
    assert not is_self_intersecting(ordered)


def test_iou_and_normalized_corner_distance():
    a = np.array([[10, 10], [90, 10], [90, 70], [10, 70]], np.float32)
    b = a + np.array([2, 0], np.float32)
    assert 0.94 < quad_iou(a, b) < 1.0
    assert 0 < mean_corner_distance_ratio(a, b, 100, 80) < 0.02


def test_out_of_bounds_is_rejected():
    quad = np.array([[-2, 5], [90, 5], [90, 70], [5, 70]], np.float32)
    assert not quad_inside_image(quad, 100, 80)


def test_refinement_fallback_preserves_original_coordinate_scale():
    image = np.full((2400, 1800, 3), 127, np.uint8)
    quad = np.array([[180, 500], [1620, 500], [1620, 1400], [180, 1400]], np.float32)
    assert np.allclose(refine_quad_with_edges(image, quad), quad)


def test_diagonal_occupancy_is_orientation_independent():
    quad = np.array([[350, 1280], [2750, 1280], [2750, 2750], [350, 2750]], np.float32)
    assert 0.54 < card_diagonal_ratio(quad, 3024, 4032) < 0.58
