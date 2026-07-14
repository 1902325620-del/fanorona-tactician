use core::fmt;

use crate::board::index_to_name;

/// Five-bit sentinel used when a move has no source or capture point.
pub const NO_POINT: u8 = 31;

/// The physical movement performed before an optional capture.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MoveKind {
    Place = 0,
    Slide = 1,
    Fly = 2,
}

/// A compact complete-turn move.
///
/// Encoding (least-significant bit first):
/// - bits 0..=4: destination point (0..23)
/// - bits 5..=9: source point, or 31 for placement
/// - bits 10..=14: captured point, or 31 for no capture
/// - bits 15..=16: [`MoveKind`]
/// - bits 17..=31: reserved and always zero
#[repr(transparent)]
#[derive(Clone, Copy, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Move(u32);

impl Move {
    const POINT_MASK: u32 = 0x1f;

    pub const fn new(kind: MoveKind, from: Option<u8>, to: u8, capture: Option<u8>) -> Self {
        let from = match from {
            Some(point) => point,
            None => NO_POINT,
        };
        let capture = match capture {
            Some(point) => point,
            None => NO_POINT,
        };
        Self(
            (to as u32)
                | ((from as u32) << 5)
                | ((capture as u32) << 10)
                | ((kind as u32) << 15),
        )
    }

    pub const fn place(to: u8, capture: Option<u8>) -> Self {
        Self::new(MoveKind::Place, None, to, capture)
    }

    pub const fn slide(from: u8, to: u8, capture: Option<u8>) -> Self {
        Self::new(MoveKind::Slide, Some(from), to, capture)
    }

    pub const fn fly(from: u8, to: u8, capture: Option<u8>) -> Self {
        Self::new(MoveKind::Fly, Some(from), to, capture)
    }

    pub const fn raw(self) -> u32 {
        self.0
    }

    pub const fn from_raw(raw: u32) -> Option<Self> {
        let to = (raw & Self::POINT_MASK) as u8;
        let from = ((raw >> 5) & Self::POINT_MASK) as u8;
        let capture = ((raw >> 10) & Self::POINT_MASK) as u8;
        let kind = ((raw >> 15) & 0x3) as u8;
        let reserved = raw >> 17;
        if reserved != 0 || to >= 24 || (from >= 24 && from != NO_POINT) || (capture >= 24 && capture != NO_POINT) {
            return None;
        }
        match kind {
            0 if from == NO_POINT => Some(Self(raw)),
            1 | 2 if from != NO_POINT => Some(Self(raw)),
            _ => None,
        }
    }

    pub const fn kind(self) -> MoveKind {
        match (self.0 >> 15) & 0x3 {
            0 => MoveKind::Place,
            1 => MoveKind::Slide,
            2 => MoveKind::Fly,
            _ => unreachable!(),
        }
    }

    pub const fn from(self) -> Option<u8> {
        let point = ((self.0 >> 5) & Self::POINT_MASK) as u8;
        if point == NO_POINT { None } else { Some(point) }
    }

    pub const fn to(self) -> u8 {
        (self.0 & Self::POINT_MASK) as u8
    }

    pub const fn capture(self) -> Option<u8> {
        let point = ((self.0 >> 10) & Self::POINT_MASK) as u8;
        if point == NO_POINT { None } else { Some(point) }
    }

    pub const fn with_capture(self, capture: u8) -> Self {
        Self((self.0 & !(Self::POINT_MASK << 10)) | ((capture as u32) << 10))
    }

    pub fn transformed(self, symmetry: u8) -> Option<Self> {
        let to = crate::transform_point(self.to(), symmetry)?;
        let from = match self.from() {
            Some(point) => Some(crate::transform_point(point, symmetry)?),
            None => None,
        };
        let capture = match self.capture() {
            Some(point) => Some(crate::transform_point(point, symmetry)?),
            None => None,
        };
        Some(Self::new(self.kind(), from, to, capture))
    }
}

impl fmt::Debug for Move {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl fmt::Display for Move {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(from) = self.from() {
            write!(f, "{}-{}", index_to_name(from).unwrap_or("?"), index_to_name(self.to()).unwrap_or("?"))?;
        } else {
            write!(f, "@{}", index_to_name(self.to()).unwrap_or("?"))?;
        }
        if let Some(capture) = self.capture() {
            write!(f, "x{}", index_to_name(capture).unwrap_or("?"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoding_round_trips_every_field() {
        let samples = [
            Move::place(23, None),
            Move::place(0, Some(17)),
            Move::slide(3, 4, Some(22)),
            Move::fly(23, 0, None),
        ];
        for mv in samples {
            assert_eq!(Move::from_raw(mv.raw()), Some(mv));
        }
        assert_eq!(samples[2].kind(), MoveKind::Slide);
        assert_eq!(samples[2].from(), Some(3));
        assert_eq!(samples[2].to(), 4);
        assert_eq!(samples[2].capture(), Some(22));
    }

    #[test]
    fn rejects_malformed_encoding() {
        assert_eq!(Move::from_raw(1 << 31), None);
        assert_eq!(Move::from_raw(Move::new(MoveKind::Place, Some(1), 2, None).raw()), None);
    }
}
