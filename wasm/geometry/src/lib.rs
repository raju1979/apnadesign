//! Batched canvas geometry. ABI v1 records: x, y, width, height, degrees,
//! ellipse (1 = centre-origin ellipse, 0 = top-left-origin rectangle).

const STRIDE: usize = 6;

#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn alloc_f64(len: usize) -> *mut f64 {
    Box::into_raw(vec![0.0; len].into_boxed_slice()) as *mut f64
}

/// # Safety
/// `ptr` must be an unreleased allocation from alloc_f64 with this exact len.
#[no_mangle]
pub unsafe extern "C" fn free_f64(ptr: *mut f64, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

fn bounds(records: &[f64]) -> Option<[f64; 4]> {
    if records.len() % STRIDE != 0 {
        return None;
    }
    let mut result = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    let mut found = false;
    for s in records.chunks_exact(STRIDE) {
        if s.iter().any(|n| !n.is_finite()) || s[2] <= 0.0 || s[3] <= 0.0 {
            continue;
        }
        let (x, y, w, h) = (s[0], s[1], s[2], s[3]);
        let radians = (s[4] % 360.0).to_radians();
        let (sin, cos) = radians.sin_cos();
        let b = if s[5] == 1.0 {
            let rx = w / 2.0;
            let ry = h / 2.0;
            let dx = (rx * cos).hypot(ry * sin);
            let dy = (rx * sin).hypot(ry * cos);
            [x + rx - dx, y + ry - dy, x + rx + dx, y + ry + dy]
        } else {
            let xs = [x, x + w * cos, x - h * sin, x + w * cos - h * sin];
            let ys = [y, y + w * sin, y + h * cos, y + w * sin + h * cos];
            [
                xs.iter().copied().fold(f64::INFINITY, f64::min),
                ys.iter().copied().fold(f64::INFINITY, f64::min),
                xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            ]
        };
        if b.iter().any(|n| !n.is_finite()) {
            continue;
        }
        result[0] = result[0].min(b[0]);
        result[1] = result[1].min(b[1]);
        result[2] = result[2].max(b[2]);
        result[3] = result[3].max(b[3]);
        found = true;
    }
    found.then_some(result)
}

/// Returns 1 and writes min_x, min_y, max_x, max_y, or returns 0 for no bounds.
/// # Safety
/// Input must contain len initialized f64s; output must hold four f64s. Both
/// must be live alloc_f64 allocations. The JavaScript adapter owns/frees them.
#[no_mangle]
pub unsafe extern "C" fn scene_bounds(input: *const f64, len: usize, output: *mut f64) -> u32 {
    if len == 0 || input.is_null() || output.is_null() {
        return 0;
    }
    match bounds(std::slice::from_raw_parts(input, len)) {
        Some(result) => {
            std::ptr::copy_nonoverlapping(result.as_ptr(), output, 4);
            1
        }
        None => 0,
    }
}

/// Writes one bounds record per input shape, or NaNs for invalid records.
/// # Safety
/// Input must hold len f64s, output must hold (len / STRIDE) * 4 f64s.
#[no_mangle]
pub unsafe extern "C" fn shape_bounds(input: *const f64, len: usize, output: *mut f64) {
    if input.is_null() || output.is_null() || len % STRIDE != 0 {
        return;
    }
    for (i, record) in std::slice::from_raw_parts(input, len)
        .chunks_exact(STRIDE)
        .enumerate()
    {
        let result = bounds(record).unwrap_or([f64::NAN; 4]);
        std::ptr::copy_nonoverlapping(result.as_ptr(), output.add(i * 4), 4);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(actual: [f64; 4], expected: [f64; 4]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-9, "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn rectangle_rotates_about_top_left() {
        near(
            bounds(&[10.0, 20.0, 100.0, 50.0, 90.0, 0.0]).unwrap(),
            [-40.0, 20.0, 10.0, 120.0],
        );
    }

    #[test]
    fn ellipse_rotates_about_centre() {
        near(
            bounds(&[10.0, 20.0, 100.0, 50.0, 90.0, 1.0]).unwrap(),
            [35.0, -5.0, 85.0, 95.0],
        );
    }

    #[test]
    fn empty_invalid_and_incomplete_input_has_no_bounds() {
        assert_eq!(bounds(&[]), None);
        assert_eq!(bounds(&[0.0; 5]), None);
        assert_eq!(bounds(&[f64::NAN, 0.0, 10.0, 10.0, 0.0, 0.0]), None);
        assert_eq!(bounds(&[0.0, 0.0, -10.0, 10.0, 0.0, 0.0]), None);
    }
}
