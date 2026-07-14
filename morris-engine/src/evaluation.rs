use crate::board::{
    mill_count, point_is_in_mill, potential_mill_count, ADJACENCY, MILL_MASKS,
};
use crate::{Player, Position};

/// Static score from the side-to-move's perspective. Exact terminal and
/// tablebase scores are handled by the search and deliberately dominate this.
pub(crate) fn evaluate(position: &Position) -> i32 {
    let white = features(position, Player::White);
    let black = features(position, Player::Black);
    let absolute = (white.material - black.material) * 1_000
        + (white.mills - black.mills) * 140
        + (white.potential_mills - black.potential_mills) * 42
        + (white.double_threats - black.double_threats) * 95
        + (white.mobility - black.mobility) * 8
        + (black.blocked - white.blocked) * 18;
    if position.side_to_move() == Player::White {
        absolute
    } else {
        -absolute
    }
}

/// Clean-room placement baseline matched to the observed local opponent:
/// material, empty adjacent edges, and completed mills only.
pub(crate) fn evaluate_placement(position: &Position) -> i32 {
    let material = position.total_material(Player::White) as i32
        - position.total_material(Player::Black) as i32;
    let freedom = adjacent_freedom(position, Player::White)
        - adjacent_freedom(position, Player::Black);
    let mills = mill_count(position.stones(Player::White)) as i32
        - mill_count(position.stones(Player::Black)) as i32;
    let absolute = material * 500 + freedom * 100 + mills * 80;
    if position.side_to_move() == Player::White {
        absolute
    } else {
        -absolute
    }
}

pub(crate) fn immediate_mill_points(stones: u32, occupied: u32) -> u32 {
    let mut points = 0;
    for mill in MILL_MASKS {
        if (stones & mill).count_ones() == 2 && (occupied & mill).count_ones() == 2 {
            points |= mill & !occupied;
        }
    }
    points
}

pub(crate) fn potential_lines(stones: u32, occupied: u32) -> i32 {
    potential_mill_count(stones, occupied) as i32
}

#[derive(Clone, Copy)]
struct Features {
    material: i32,
    mills: i32,
    potential_mills: i32,
    double_threats: i32,
    mobility: i32,
    blocked: i32,
}

fn features(position: &Position, player: Player) -> Features {
    let stones = position.stones(player);
    let occupied = position.occupied();
    Features {
        material: position.total_material(player) as i32,
        mills: mill_count(stones) as i32,
        potential_mills: potential_mill_count(stones, occupied) as i32,
        double_threats: double_threat_count(position, player),
        mobility: mobility(position, player),
        blocked: blocked_stones(position, player),
    }
}

fn double_threat_count(position: &Position, player: Player) -> i32 {
    let targets = executable_mill_targets(position, player).count_ones() as i32;
    (targets - 1).max(0)
}

/// Distinct destinations where `player` can close at least one mill with its
/// next legal base action. Two lines sharing one destination are one threat.
pub(crate) fn executable_mill_targets(position: &Position, player: Player) -> u32 {
    let stones = position.stones(player);
    let occupied = position.occupied();
    let empty = position.empty();
    if position.reserve(player) > 0 {
        return immediate_mill_points(stones, occupied);
    }
    if stones.count_ones() < 3 {
        return 0;
    }

    let flying = stones.count_ones() == 3;
    let mut targets = 0;
    let mut sources = stones;
    while sources != 0 {
        let from = sources.trailing_zeros() as usize;
        sources &= sources - 1;
        let mut destinations = if flying {
            empty
        } else {
            ADJACENCY[from] & empty
        };
        while destinations != 0 {
            let to = destinations.trailing_zeros() as u8;
            destinations &= destinations - 1;
            let stones_after = (stones & !(1 << from)) | (1 << to);
            if point_is_in_mill(stones_after, to) {
                targets |= 1 << to;
            }
        }
    }
    targets
}

fn mobility(position: &Position, player: Player) -> i32 {
    let empty = position.empty();
    if position.reserve(player) > 0 {
        return empty.count_ones() as i32;
    }
    let stones = position.stones(player);
    if stones.count_ones() == 3 {
        return (3 * empty.count_ones()) as i32;
    }
    let mut result = 0;
    let mut scan = stones;
    while scan != 0 {
        let point = scan.trailing_zeros() as usize;
        scan &= scan - 1;
        result += (ADJACENCY[point] & empty).count_ones() as i32;
    }
    result
}

fn blocked_stones(position: &Position, player: Player) -> i32 {
    if position.reserve(player) > 0 || position.is_flying(player) {
        return 0;
    }
    let empty = position.empty();
    let mut blocked = 0;
    let mut scan = position.stones(player);
    while scan != 0 {
        let point = scan.trailing_zeros() as usize;
        scan &= scan - 1;
        if ADJACENCY[point] & empty == 0 {
            blocked += 1;
        }
    }
    blocked
}

fn adjacent_freedom(position: &Position, player: Player) -> i32 {
    let empty = position.empty();
    let mut freedom = 0;
    let mut stones = position.stones(player);
    while stones != 0 {
        let point = stones.trailing_zeros() as usize;
        stones &= stones - 1;
        freedom += (ADJACENCY[point] & empty).count_ones() as i32;
    }
    freedom
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(points: &[u8]) -> u32 {
        points.iter().fold(0, |mask, &point| mask | (1 << point))
    }

    #[test]
    fn two_lines_sharing_one_destination_are_one_threat() {
        let position = Position::from_parts(bits(&[0, 2, 4, 7]), 0, 5, 9, 0, 0).unwrap();
        let targets = executable_mill_targets(&position, Player::White);

        assert_eq!(targets, 1 << 1);
        assert_eq!(double_threat_count(&position, Player::White), 0);
    }

    #[test]
    fn two_executable_destinations_are_a_double_threat() {
        let position = Position::from_parts(bits(&[0, 1, 12, 13]), 0, 5, 9, 0, 0).unwrap();
        let targets = executable_mill_targets(&position, Player::White);

        assert_eq!(targets, (1 << 2) | (1 << 14));
        assert_eq!(double_threat_count(&position, Player::White), 1);
    }

    #[test]
    fn adjacent_freedom_counts_each_empty_edge_from_each_stone() {
        let position = Position::from_parts(bits(&[0, 4]), bits(&[1, 5]), 7, 6, 0, 0).unwrap();

        assert_eq!(adjacent_freedom(&position, Player::White), 3);
        assert_eq!(adjacent_freedom(&position, Player::Black), 2);
    }

    #[test]
    fn placement_baseline_uses_confirmed_material_freedom_and_mill_formula() {
        let material_and_freedom =
            Position::from_parts(bits(&[0, 4]), bits(&[1, 5]), 7, 6, 0, 0).unwrap();
        let mill_only =
            Position::from_parts(bits(&[0, 1, 2]), bits(&[21, 22]), 5, 6, 0, 0).unwrap();

        assert_eq!(evaluate_placement(&material_and_freedom), 600);
        assert_eq!(evaluate_placement(&mill_only), 80);
    }

    #[test]
    fn placement_baseline_is_color_symmetric() {
        let white = 0x60_0003;
        let black = 0x88_0094;
        let original = Position::from_parts(white, black, 5, 4, 0, 0).unwrap();
        let swapped = Position::from_parts(black, white, 4, 5, 1, 0).unwrap();

        assert_eq!(evaluate_placement(&original), evaluate_placement(&swapped));
    }

    #[test]
    fn replay_position_exposes_the_expected_distinct_mill_targets() {
        let original = Position::from_parts(0x60_0003, 0x88_0094, 5, 4, 0, 0).unwrap();

        assert_eq!(
            executable_mill_targets(&original, Player::White),
            1 << 9
        );
        assert_eq!(
            executable_mill_targets(&original, Player::Black),
            1 << 14
        );
    }
}
