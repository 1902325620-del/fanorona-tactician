//! Independent Nine Men's Morris rules and search engine.
//!
//! The crate intentionally has no dependency on the application's other game
//! engines. A move represents a complete turn, including the mandatory single
//! capture when placing or moving a stone closes a mill.

mod board;
mod clock;
mod evaluation;
mod ffi;
mod mv;
mod position;
mod search;
mod tablebase;

pub use board::{
    index_to_name, inverse_symmetry, name_to_index, transform_mask, transform_point, ADJACENCY,
    MILL_MASKS, POINT_NAMES, SYMMETRIES,
};
pub use mv::{Move, MoveKind, NO_POINT};
pub use position::{MoveList, Outcome, Player, Position, PositionError, Rules, Undo, MAX_LEGAL_MOVES};
pub use search::{Candidate, Engine, SearchLimits, SearchResult, MATE_SCORE};
pub use tablebase::{Tablebase, TablebaseHit, Wdl};
