//! Board geometry using the conventional a7..g1 coordinate names.

/// Human-readable names for the 24 playable points.
pub const POINT_NAMES: [&str; 24] = [
    "a7", "d7", "g7", "b6", "d6", "f6", "c5", "d5", "e5", "a4", "b4", "c4",
    "e4", "f4", "g4", "c3", "d3", "e3", "b2", "d2", "f2", "a1", "d1", "g1",
];

/// Adjacent destinations for each point, represented as a 24-bit mask.
pub const ADJACENCY: [u32; 24] = [
    bits(&[1, 9]),
    bits(&[0, 2, 4]),
    bits(&[1, 14]),
    bits(&[4, 10]),
    bits(&[1, 3, 5, 7]),
    bits(&[4, 13]),
    bits(&[7, 11]),
    bits(&[4, 6, 8]),
    bits(&[7, 12]),
    bits(&[0, 10, 21]),
    bits(&[3, 9, 11, 18]),
    bits(&[6, 10, 15]),
    bits(&[8, 13, 17]),
    bits(&[5, 12, 14, 20]),
    bits(&[2, 13, 23]),
    bits(&[11, 16]),
    bits(&[15, 17, 19]),
    bits(&[12, 16]),
    bits(&[10, 19]),
    bits(&[16, 18, 20, 22]),
    bits(&[13, 19]),
    bits(&[9, 22]),
    bits(&[19, 21, 23]),
    bits(&[14, 22]),
];

/// The sixteen possible mills on a standard board.
pub const MILL_MASKS: [u32; 16] = [
    bits(&[0, 1, 2]),
    bits(&[3, 4, 5]),
    bits(&[6, 7, 8]),
    bits(&[9, 10, 11]),
    bits(&[12, 13, 14]),
    bits(&[15, 16, 17]),
    bits(&[18, 19, 20]),
    bits(&[21, 22, 23]),
    bits(&[0, 9, 21]),
    bits(&[3, 10, 18]),
    bits(&[6, 11, 15]),
    bits(&[1, 4, 7]),
    bits(&[16, 19, 22]),
    bits(&[8, 12, 17]),
    bits(&[5, 13, 20]),
    bits(&[2, 14, 23]),
];

const COORDINATES: [(u8, u8); 24] = [
    (0, 0), (3, 0), (6, 0), (1, 1), (3, 1), (5, 1), (2, 2), (3, 2), (4, 2),
    (0, 3), (1, 3), (2, 3), (4, 3), (5, 3), (6, 3), (2, 4), (3, 4), (4, 4),
    (1, 5), (3, 5), (5, 5), (0, 6), (3, 6), (6, 6),
];

const RING_INVERSION: [u8; 24] = [
    6, 7, 8, 3, 4, 5, 0, 1, 2, 11, 10, 9, 14, 13, 12, 21, 22, 23, 18, 19, 20,
    15, 16, 17,
];

/// The board graph's sixteen automorphisms: eight square symmetries, with and
/// without exchanging the outer and inner rings.
pub const SYMMETRIES: [[u8; 24]; 16] = build_symmetries();

const fn build_symmetries() -> [[u8; 24]; 16] {
    let mut result = [[0_u8; 24]; 16];
    let mut symmetry = 0;
    while symmetry < 16 {
        let mut point = 0;
        while point < 24 {
            let initial = if symmetry >= 8 {
                RING_INVERSION[point]
            } else {
                point as u8
            };
            let (x, y) = COORDINATES[initial as usize];
            let transform = symmetry & 7;
            let (tx, ty) = match transform {
                0 => (x, y),
                1 => (6 - y, x),
                2 => (6 - x, 6 - y),
                3 => (y, 6 - x),
                4 => (6 - x, y),
                5 => (6 - y, 6 - x),
                6 => (x, 6 - y),
                _ => (y, x),
            };
            result[symmetry][point] = coordinate_index(tx, ty);
            point += 1;
        }
        symmetry += 1;
    }
    result
}

const fn coordinate_index(x: u8, y: u8) -> u8 {
    let mut point = 0;
    while point < 24 {
        if COORDINATES[point].0 == x && COORDINATES[point].1 == y {
            return point as u8;
        }
        point += 1;
    }
    panic!("transformed coordinate is not a board point")
}

const fn bits(points: &[u8]) -> u32 {
    let mut mask = 0;
    let mut i = 0;
    while i < points.len() {
        mask |= 1_u32 << points[i];
        i += 1;
    }
    mask
}

pub(crate) const BOARD_MASK: u32 = (1_u32 << 24) - 1;

#[inline]
pub(crate) fn point_is_in_mill(stones: u32, point: u8) -> bool {
    let point_bit = 1_u32 << point;
    MILL_MASKS
        .iter()
        .any(|&mill| mill & point_bit != 0 && stones & mill == mill)
}

#[inline]
pub(crate) fn mill_count(stones: u32) -> u8 {
    MILL_MASKS
        .iter()
        .filter(|&&mill| stones & mill == mill)
        .count() as u8
}

#[inline]
pub(crate) fn potential_mill_count(stones: u32, occupied: u32) -> u8 {
    MILL_MASKS
        .iter()
        .filter(|&&mill| (stones & mill).count_ones() == 2 && (occupied & mill).count_ones() == 2)
        .count() as u8
}

pub fn index_to_name(index: u8) -> Option<&'static str> {
    POINT_NAMES.get(index as usize).copied()
}

pub fn name_to_index(name: &str) -> Option<u8> {
    POINT_NAMES
        .iter()
        .position(|candidate| candidate.eq_ignore_ascii_case(name))
        .map(|index| index as u8)
}

pub fn transform_point(point: u8, symmetry: u8) -> Option<u8> {
    SYMMETRIES
        .get(symmetry as usize)
        .and_then(|mapping| mapping.get(point as usize))
        .copied()
}

pub fn transform_mask(mut mask: u32, symmetry: u8) -> Option<u32> {
    let mapping = SYMMETRIES.get(symmetry as usize)?;
    if mask & !BOARD_MASK != 0 {
        return None;
    }
    let mut result = 0;
    while mask != 0 {
        let point = mask.trailing_zeros() as usize;
        mask &= mask - 1;
        result |= 1 << mapping[point];
    }
    Some(result)
}

pub fn inverse_symmetry(symmetry: u8) -> Option<u8> {
    let mapping = SYMMETRIES.get(symmetry as usize)?;
    for candidate in 0..16_u8 {
        let inverse = &SYMMETRIES[candidate as usize];
        if (0..24).all(|point| inverse[mapping[point] as usize] == point as u8) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacency_is_symmetric() {
        for point in 0..24_u8 {
            let mut neighbours = ADJACENCY[point as usize];
            while neighbours != 0 {
                let other = neighbours.trailing_zeros() as u8;
                neighbours &= neighbours - 1;
                assert_ne!(ADJACENCY[other as usize] & (1 << point), 0);
            }
        }
    }

    #[test]
    fn geometry_has_sixteen_unique_mills() {
        assert_eq!(MILL_MASKS.len(), 16);
        for (index, &mill) in MILL_MASKS.iter().enumerate() {
            assert_eq!(mill.count_ones(), 3);
            assert!(!MILL_MASKS[..index].contains(&mill));
        }
    }

    #[test]
    fn every_symmetry_preserves_edges_and_mills() {
        for symmetry in 0..16_u8 {
            for point in 0..24_u8 {
                let transformed = transform_point(point, symmetry).unwrap();
                assert_eq!(
                    transform_mask(ADJACENCY[point as usize], symmetry).unwrap(),
                    ADJACENCY[transformed as usize]
                );
            }
            for mill in MILL_MASKS {
                assert!(MILL_MASKS.contains(&transform_mask(mill, symmetry).unwrap()));
            }
            let inverse = inverse_symmetry(symmetry).unwrap();
            for point in 0..24_u8 {
                let transformed = transform_point(point, symmetry).unwrap();
                assert_eq!(transform_point(transformed, inverse), Some(point));
            }
        }
    }
}
