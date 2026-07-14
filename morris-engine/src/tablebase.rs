use crate::Position;

/// Game-theoretic value relative to the side to move in the probed position.
#[repr(i8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Wdl {
    Loss = -1,
    Draw = 0,
    Win = 1,
}
/// An exact result and distance-to-conversion/win measured in complete plies.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TablebaseHit {
    pub wdl: Wdl,
    pub dtw: u16,
}

/// Pluggable exact knowledge. The first generated implementation will cover
/// 3-vs-3 movement positions; the search intentionally does not depend on its
/// storage format.
pub trait Tablebase: Send + Sync {
    fn probe(&self, position: &Position) -> Option<TablebaseHit>;
}

pub(crate) fn is_initially_supported(position: &Position) -> bool {
    position.reserve(crate::Player::White) == 0
        && position.reserve(crate::Player::Black) == 0
        && position.on_board(crate::Player::White) == 3
        && position.on_board(crate::Player::Black) == 3
}
