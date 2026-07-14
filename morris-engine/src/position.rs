use core::fmt;

use crate::board::{point_is_in_mill, ADJACENCY, BOARD_MASK};
use crate::{Move, MoveKind};

/// A deliberately generous fixed limit. The theoretical maximum is lower for
/// every reachable standard position, including capture choices.
pub const MAX_LEGAL_MOVES: usize = 640;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Player {
    White = 0,
    Black = 1,
}

impl Player {
    pub const fn index(self) -> usize {
        self as usize
    }

    pub const fn opponent(self) -> Self {
        match self {
            Self::White => Self::Black,
            Self::Black => Self::White,
        }
    }

    pub const fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::White),
            1 => Some(Self::Black),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    Ongoing,
    Draw,
    Win(Player),
}

/// Variant-sensitive draw rules. Captures and all board mechanics remain the
/// standard Gasser rules; callers may disable a move-count draw by leaving it
/// as `None`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Rules {
    pub repetitions_for_draw: u8,
    pub plies_without_capture_for_draw: Option<u16>,
}

impl Default for Rules {
    fn default() -> Self {
        Self {
            repetitions_for_draw: 3,
            plies_without_capture_for_draw: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PositionError {
    OffBoardBits,
    OverlappingStones,
    TooManyStones,
    InvalidPlayer,
    IllegalMove,
}

impl fmt::Display for PositionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::OffBoardBits => "a bitboard contains points outside the 24-point board",
            Self::OverlappingStones => "the players' bitboards overlap",
            Self::TooManyStones => "a player has more than nine stones on the board and in reserve",
            Self::InvalidPlayer => "side to move must be 0 (white) or 1 (black)",
            Self::IllegalMove => "move is not legal in this position",
        };
        f.write_str(message)
    }
}

impl std::error::Error for PositionError {}

/// A compact position. Bitboards use the point indices documented in
/// `board::POINT_NAMES`; the low 24 bits are significant.
#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Position {
    stones: [u32; 2],
    reserves: [u8; 2],
    side_to_move: Player,
    plies_without_capture: u16,
}

/// Restoring a position is a small fixed-size copy and avoids reconstructing
/// phase and capture-counter state in the hot search path.
#[derive(Clone, Copy, Debug)]
pub struct Undo(Position);

/// Allocation-free legal move storage used by the search.
pub struct MoveList {
    moves: [Move; MAX_LEGAL_MOVES],
    len: usize,
}

impl Default for MoveList {
    fn default() -> Self {
        Self {
            moves: [Move::default(); MAX_LEGAL_MOVES],
            len: 0,
        }
    }
}

impl MoveList {
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_slice(&self) -> &[Move] {
        &self.moves[..self.len]
    }

    pub(crate) fn as_mut_slice(&mut self) -> &mut [Move] {
        &mut self.moves[..self.len]
    }

    fn push(&mut self, mv: Move) {
        assert!(self.len < MAX_LEGAL_MOVES, "legal move buffer exhausted");
        self.moves[self.len] = mv;
        self.len += 1;
    }
}

impl<'a> IntoIterator for &'a MoveList {
    type Item = &'a Move;
    type IntoIter = core::slice::Iter<'a, Move>;

    fn into_iter(self) -> Self::IntoIter {
        self.as_slice().iter()
    }
}

impl Position {
    /// Empty standard starting position, with nine stones in each reserve.
    pub const fn standard() -> Self {
        Self {
            stones: [0, 0],
            reserves: [9, 9],
            side_to_move: Player::White,
            plies_without_capture: 0,
        }
    }

    pub fn from_parts(
        white: u32,
        black: u32,
        white_reserve: u8,
        black_reserve: u8,
        side_to_move: u8,
        plies_without_capture: u16,
    ) -> Result<Self, PositionError> {
        if (white | black) & !BOARD_MASK != 0 {
            return Err(PositionError::OffBoardBits);
        }
        if white & black != 0 {
            return Err(PositionError::OverlappingStones);
        }
        if white.count_ones() + white_reserve as u32 > 9
            || black.count_ones() + black_reserve as u32 > 9
        {
            return Err(PositionError::TooManyStones);
        }
        let side_to_move = Player::from_index(side_to_move).ok_or(PositionError::InvalidPlayer)?;
        Ok(Self {
            stones: [white, black],
            reserves: [white_reserve, black_reserve],
            side_to_move,
            plies_without_capture,
        })
    }

    pub const fn stones(self, player: Player) -> u32 {
        self.stones[player.index()]
    }

    pub const fn reserve(self, player: Player) -> u8 {
        self.reserves[player.index()]
    }

    pub const fn side_to_move(self) -> Player {
        self.side_to_move
    }

    pub const fn plies_without_capture(self) -> u16 {
        self.plies_without_capture
    }

    pub const fn occupied(self) -> u32 {
        self.stones[0] | self.stones[1]
    }

    pub const fn empty(self) -> u32 {
        BOARD_MASK & !self.occupied()
    }

    pub fn on_board(self, player: Player) -> u8 {
        self.stones(player).count_ones() as u8
    }

    pub fn total_material(self, player: Player) -> u8 {
        self.on_board(player) + self.reserve(player)
    }

    pub fn is_flying(self, player: Player) -> bool {
        self.reserve(player) == 0 && self.on_board(player) == 3
    }

    pub fn legal_moves(&self) -> MoveList {
        let mut result = MoveList::default();
        self.legal_moves_into(&mut result);
        result
    }

    pub(crate) fn legal_moves_into(&self, result: &mut MoveList) {
        result.len = 0;
        if self.intrinsic_winner().is_some() {
            return;
        }

        let player = self.side_to_move;
        let player_index = player.index();
        let own = self.stones[player_index];
        let empty = self.empty();

        if self.reserves[player_index] > 0 {
            let mut destinations = empty;
            while destinations != 0 {
                let to = pop_point(&mut destinations);
                let own_after = own | (1 << to);
                self.expand_capture(Move::place(to, None), own_after, result);
            }
            return;
        }

        let flying = own.count_ones() == 3;
        let mut sources = own;
        while sources != 0 {
            let from = pop_point(&mut sources);
            let mut destinations = if flying {
                empty
            } else {
                ADJACENCY[from as usize] & empty
            };
            while destinations != 0 {
                let to = pop_point(&mut destinations);
                let own_after = (own & !(1 << from)) | (1 << to);
                let base = if flying {
                    Move::fly(from, to, None)
                } else {
                    Move::slide(from, to, None)
                };
                self.expand_capture(base, own_after, result);
            }
        }
    }

    fn expand_capture(&self, base: Move, own_after: u32, result: &mut MoveList) {
        if !point_is_in_mill(own_after, base.to()) {
            result.push(base);
            return;
        }

        let opponent = self.stones[self.side_to_move.opponent().index()];
        if opponent == 0 {
            result.push(base);
            return;
        }

        let mut outside_mills = opponent;
        let mut scan = opponent;
        while scan != 0 {
            let point = pop_point(&mut scan);
            if point_is_in_mill(opponent, point) {
                outside_mills &= !(1 << point);
            }
        }
        let mut captures = if outside_mills != 0 {
            outside_mills
        } else {
            opponent
        };
        while captures != 0 {
            result.push(base.with_capture(pop_point(&mut captures)));
        }
    }

    pub fn has_legal_move(&self) -> bool {
        if self.intrinsic_winner().is_some() {
            return false;
        }
        let player = self.side_to_move;
        if self.reserve(player) > 0 {
            return self.empty() != 0;
        }
        let own = self.stones(player);
        if own.count_ones() == 3 {
            return self.empty() != 0;
        }
        let empty = self.empty();
        let mut stones = own;
        while stones != 0 {
            let from = pop_point(&mut stones);
            if ADJACENCY[from as usize] & empty != 0 {
                return true;
            }
        }
        false
    }

    pub fn outcome(&self) -> Outcome {
        self.outcome_with_rules(&Rules::default())
    }

    pub fn outcome_with_rules(&self, rules: &Rules) -> Outcome {
        if let Some(winner) = self.intrinsic_winner() {
            return Outcome::Win(winner);
        }
        if !self.has_legal_move() {
            return Outcome::Win(self.side_to_move.opponent());
        }
        if rules
            .plies_without_capture_for_draw
            .is_some_and(|limit| self.plies_without_capture >= limit)
        {
            return Outcome::Draw;
        }
        Outcome::Ongoing
    }

    fn intrinsic_winner(&self) -> Option<Player> {
        let white_lost = self.total_material(Player::White) < 3;
        let black_lost = self.total_material(Player::Black) < 3;
        match (white_lost, black_lost) {
            (true, false) => Some(Player::Black),
            (false, true) => Some(Player::White),
            // Invalid synthetic positions are treated as a loss for the side
            // to move, which keeps search behavior deterministic.
            (true, true) => Some(self.side_to_move.opponent()),
            (false, false) => None,
        }
    }

    pub fn is_legal(&self, mv: Move) -> bool {
        self.legal_moves().as_slice().contains(&mv)
    }

    pub fn make_move(&mut self, mv: Move) -> Result<Undo, PositionError> {
        if !self.is_legal(mv) {
            return Err(PositionError::IllegalMove);
        }
        Ok(self.make_move_unchecked(mv))
    }

    pub(crate) fn make_move_unchecked(&mut self, mv: Move) -> Undo {
        let undo = Undo(*self);
        let player = self.side_to_move;
        let opponent = player.opponent();
        let player_index = player.index();

        match mv.kind() {
            MoveKind::Place => {
                self.reserves[player_index] -= 1;
            }
            MoveKind::Slide | MoveKind::Fly => {
                self.stones[player_index] &= !(1 << mv.from().expect("movement has a source"));
            }
        }
        self.stones[player_index] |= 1 << mv.to();

        if let Some(capture) = mv.capture() {
            self.stones[opponent.index()] &= !(1 << capture);
            self.plies_without_capture = 0;
        } else {
            self.plies_without_capture = self.plies_without_capture.saturating_add(1);
        }
        self.side_to_move = opponent;
        undo
    }

    pub fn undo_move(&mut self, undo: Undo) {
        *self = undo.0;
    }

    /// Position identity for repetition. Capture counters are deliberately not
    /// included because repetition concerns board, reserves, and side to move.
    pub fn repetition_key(&self) -> u64 {
        splitmix64(self.packed_identity())
    }

    /// Deterministic transposition key, including the optional draw counter.
    pub fn transposition_key(&self) -> u64 {
        self.canonical_transposition().0
    }

    /// Orientation-sensitive counterpart used only for measuring how many TT
    /// hits came from a different member of the same symmetry orbit.
    pub fn raw_transposition_key(&self) -> u64 {
        splitmix64(self.packed_identity())
            ^ splitmix64(0x6a09_e667_f3bc_c909 ^ self.plies_without_capture as u64)
    }

    pub fn transformed(&self, symmetry: u8) -> Option<Self> {
        Some(Self {
            stones: [
                crate::transform_mask(self.stones[0], symmetry)?,
                crate::transform_mask(self.stones[1], symmetry)?,
            ],
            reserves: self.reserves,
            side_to_move: self.side_to_move,
            plies_without_capture: self.plies_without_capture,
        })
    }

    pub(crate) fn canonical_transposition(&self) -> (u64, u8) {
        let (identity, symmetry) = self.canonical_identity_and_symmetry();
        (
            splitmix64(identity)
                ^ splitmix64(0x6a09_e667_f3bc_c909 ^ self.plies_without_capture as u64),
            symmetry,
        )
    }

    fn canonical_identity_and_symmetry(&self) -> (u64, u8) {
        let mut best = u64::MAX;
        let mut best_symmetry = 0;
        for symmetry in 0..16 {
            let transformed = self.transformed(symmetry).expect("valid symmetry");
            let identity = transformed.packed_identity();
            if identity < best {
                best = identity;
                best_symmetry = symmetry;
            }
        }
        (best, best_symmetry)
    }

    fn packed_identity(&self) -> u64 {
        (self.stones[0] as u64)
            | ((self.stones[1] as u64) << 24)
            | ((self.reserves[0] as u64) << 48)
            | ((self.reserves[1] as u64) << 52)
            | ((self.side_to_move as u64) << 56)
    }

    pub fn perft(&mut self, depth: u8) -> u64 {
        if depth == 0 {
            return 1;
        }
        let moves = self.legal_moves();
        let mut nodes = 0_u64;
        for &mv in moves.as_slice() {
            let undo = self.make_move_unchecked(mv);
            nodes += self.perft(depth - 1);
            self.undo_move(undo);
        }
        nodes
    }
}

#[inline]
fn pop_point(mask: &mut u32) -> u8 {
    let point = mask.trailing_zeros() as u8;
    *mask &= *mask - 1;
    point
}

#[inline]
fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask(points: &[u8]) -> u32 {
        points.iter().fold(0, |result, &point| result | (1 << point))
    }

    #[test]
    fn standard_opening_has_twenty_four_moves() {
        assert_eq!(Position::standard().legal_moves().len(), 24);
    }

    #[test]
    fn closing_mill_requires_one_capture() {
        let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 9]), 7, 6, 0, 0).unwrap();
        let moves = position.legal_moves();
        let completions: Vec<_> = moves
            .as_slice()
            .iter()
            .copied()
            .filter(|mv| mv.to() == 2)
            .collect();
        assert_eq!(completions.len(), 3);
        assert!(completions.iter().all(|mv| mv.capture().is_some()));
    }

    #[test]
    fn mill_stones_are_protected_when_an_outside_stone_exists() {
        let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 5, 9]), 7, 5, 0, 0).unwrap();
        let completion = position
            .legal_moves()
            .as_slice()
            .iter()
            .copied()
            .find(|mv| mv.to() == 2)
            .unwrap();
        assert_eq!(completion.capture(), Some(9));
    }

    #[test]
    fn any_stone_can_be_captured_when_all_are_in_mills() {
        let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 5]), 7, 6, 0, 0).unwrap();
        let captures: Vec<_> = position
            .legal_moves()
            .as_slice()
            .iter()
            .filter(|mv| mv.to() == 2)
            .filter_map(|mv| mv.capture())
            .collect();
        assert_eq!(captures, vec![3, 4, 5]);
    }

    #[test]
    fn three_stones_can_fly_to_non_adjacent_points() {
        let position = Position::from_parts(mask(&[0, 1, 9]), mask(&[3, 4, 5, 6]), 0, 0, 0, 0).unwrap();
        assert!(position
            .legal_moves()
            .as_slice()
            .contains(&Move::fly(0, 23, None)));
    }

    #[test]
    fn make_and_undo_restore_every_field() {
        let mut position = Position::standard();
        let before = position;
        let undo = position.make_move(Move::place(0, None)).unwrap();
        assert_ne!(position, before);
        position.undo_move(undo);
        assert_eq!(position, before);
    }

    #[test]
    fn fewer_than_three_total_stones_loses() {
        let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 5]), 0, 0, 0, 0).unwrap();
        assert_eq!(position.outcome(), Outcome::Win(Player::Black));
    }

    #[test]
    fn blocked_side_loses() {
        let position = Position::from_parts(
            mask(&[0, 2, 3, 5]),
            mask(&[1, 4, 9, 10, 13, 14]),
            0,
            0,
            0,
            0,
        )
        .unwrap();
        assert_eq!(position.outcome(), Outcome::Win(Player::Black));
    }

    #[test]
    fn opening_perft_depth_two_is_552() {
        let mut position = Position::standard();
        assert_eq!(position.perft(1), 24);
        assert_eq!(position.perft(2), 24 * 23);
    }

    #[test]
    fn color_swap_preserves_role_relative_legal_moves() {
        let original = Position::from_parts(mask(&[0, 1]), mask(&[3, 4]), 7, 7, 0, 0).unwrap();
        let swapped = Position::from_parts(mask(&[3, 4]), mask(&[0, 1]), 7, 7, 1, 0).unwrap();
        assert_eq!(original.legal_moves().as_slice(), swapped.legal_moves().as_slice());
    }

    #[test]
    fn symmetric_positions_share_a_transposition_key() {
        let position = Position::from_parts(mask(&[0, 4, 11]), mask(&[2, 13, 21]), 6, 6, 1, 7).unwrap();
        for symmetry in 0..16 {
            assert_eq!(
                position.transposition_key(),
                position.transformed(symmetry).unwrap().transposition_key()
            );
        }
    }
}
