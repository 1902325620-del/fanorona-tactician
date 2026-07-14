use morris_engine::{Move, MoveKind, Outcome, Player, Position, Rules};

fn mask(points: &[u8]) -> u32 {
    points.iter().fold(0, |result, &point| result | (1 << point))
}
#[test]
fn opening_perft_regression() {
    let mut position = Position::standard();
    assert_eq!(position.perft(0), 1);
    assert_eq!(position.perft(1), 24);
    assert_eq!(position.perft(2), 552);
    assert_eq!(position.perft(3), 12_144);
}

#[test]
fn compact_move_layout_is_stable() {
    let mv = Move::new(MoveKind::Fly, Some(23), 0, Some(17));
    let expected = (23_u32 << 5) | (17_u32 << 10) | (2_u32 << 15);
    assert_eq!(mv.raw(), expected);
    assert_eq!(Move::from_raw(expected), Some(mv));
}

#[test]
fn no_capture_rule_is_variant_configurable() {
    let position = Position::from_parts(
        mask(&[0, 3, 6]),
        mask(&[2, 5, 8]),
        0,
        0,
        Player::White as u8,
        100,
    )
    .unwrap();
    assert_eq!(position.outcome(), Outcome::Ongoing);
    assert_eq!(
        position.outcome_with_rules(&Rules {
            repetitions_for_draw: 3,
            plies_without_capture_for_draw: Some(100),
        }),
        Outcome::Draw
    );
}

#[test]
fn all_symmetric_moves_remain_legal() {
    let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 9]), 7, 6, 0, 0).unwrap();
    let source_moves = position.legal_moves();
    for symmetry in 0..16 {
        let transformed_position = position.transformed(symmetry).unwrap();
        let transformed_moves = transformed_position.legal_moves();
        for &mv in source_moves.as_slice() {
            assert!(transformed_moves
                .as_slice()
                .contains(&mv.transformed(symmetry).unwrap()));
        }
    }
}
