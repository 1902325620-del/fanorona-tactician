//! Stable integer-only C ABI suitable for direct use from a Web Worker.

use std::sync::{Mutex, MutexGuard};

use crate::{Engine, Position, SearchLimits, SearchResult};

const INVALID_MOVE: u32 = u32::MAX;

struct FfiState {
    engine: Option<Engine>,
    active_handle: u32,
    next_generation: u32,
    history: Vec<u64>,
    result: Option<SearchResult>,
}

static STATE: Mutex<FfiState> = Mutex::new(FfiState {
    engine: None,
    active_handle: 0,
    next_generation: 0,
    history: Vec::new(),
    result: None,
});

/// Stable integer ABI revision used by adapters before calling any function
/// whose parameter list may grow in a future release.
#[no_mangle]
pub extern "C" fn morris_engine_abi_version() -> u32 {
    1
}

fn state() -> MutexGuard<'static, FfiState> {
    STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Creates the process-global engine. Each replacement gets a new generation
/// handle so a delayed destroy from an old adapter cannot destroy the new one.
#[no_mangle]
pub extern "C" fn morris_engine_create(tt_megabytes: u32) -> u32 {
    let mut state = state();
    let old_engine = state.engine.take();
    state.active_handle = 0;
    state.history.clear();
    state.result = None;
    drop(old_engine);

    let tt_megabytes = clamp_ffi_tt_megabytes(tt_megabytes);
    state.engine = Some(Engine::new(tt_megabytes as usize));
    state.next_generation = next_handle(state.next_generation);
    state.active_handle = state.next_generation;
    state.active_handle
}

#[no_mangle]
pub extern "C" fn morris_engine_destroy(handle: u32) {
    let mut state = state();
    if !valid_handle(&state, handle) {
        return;
    }
    state.engine = None;
    state.active_handle = 0;
    state.history.clear();
    state.result = None;
}

#[no_mangle]
pub extern "C" fn morris_engine_clear_history(handle: u32) -> i32 {
    let mut state = state();
    if !valid_handle(&state, handle) {
        return -1;
    }
    state.history.clear();
    state.result = None;
    0
}

/// Adds one actual-game position to repetition history. `player0_bits` and
/// `player1_bits` use the absolute player identities represented by side 0 and
/// side 1; they are not automatically swapped to the current player's view.
#[no_mangle]
pub extern "C" fn morris_engine_push_history(
    handle: u32,
    player0_bits: u32,
    player1_bits: u32,
    player0_reserve: u32,
    player1_reserve: u32,
    side_to_move: u32,
) -> i32 {
    let mut state = state();
    if !valid_handle(&state, handle) {
        return -1;
    }
    if player0_reserve > 9 || player1_reserve > 9 || side_to_move > 1 {
        return -2;
    }
    let position = match Position::from_parts(
        player0_bits,
        player1_bits,
        player0_reserve as u8,
        player1_reserve as u8,
        side_to_move as u8,
        0,
    ) {
        Ok(position) => position,
        Err(_) => return -2,
    };
    state.history.push(position.repetition_key());
    state.result = None;
    0
}

/// Searches a position. Returns 0 on success, -1 for an invalid handle or
/// missing engine, and -2 for an invalid position.
#[no_mangle]
pub extern "C" fn morris_engine_search(
    handle: u32,
    player0_bits: u32,
    player1_bits: u32,
    player0_reserve: u32,
    player1_reserve: u32,
    side_to_move: u32,
    plies_without_capture: u32,
    time_ms: u32,
    max_depth: u32,
    top_n: u32,
    finish_placement: u32,
    placement_verification_depth: u32,
) -> i32 {
    let mut state = state();
    if !valid_handle(&state, handle) {
        return -1;
    }
    // A failed search must never leave getters exposing a stale result.
    state.result = None;
    if player0_reserve > 9 || player1_reserve > 9 || side_to_move > 1 {
        return -2;
    }
    let position = match Position::from_parts(
        player0_bits,
        player1_bits,
        player0_reserve as u8,
        player1_reserve as u8,
        side_to_move as u8,
        plies_without_capture.min(u16::MAX as u32) as u16,
    ) {
        Ok(position) => position,
        Err(_) => return -2,
    };

    let history = state.history.clone();
    let Some(engine) = state.engine.as_mut() else {
        return -1;
    };
    let result = engine.search_with_history(
        &position,
        &history,
        SearchLimits {
            time_ms: clamp_ffi_search_time_ms(time_ms) as u64,
            max_depth: max_depth.clamp(1, 126) as u8,
            node_limit: 0,
            top_n: top_n.clamp(1, 3) as u8,
            finish_placement: finish_placement != 0,
            placement_verification_depth: placement_verification_depth.min(64) as u8,
        },
    );
    state.result = Some(result);
    0
}

#[no_mangle]
pub extern "C" fn morris_engine_result_count(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.candidates.len() as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_move(handle: u32, candidate: u32) -> u32 {
    result(handle).map_or(INVALID_MOVE, |result| {
        result
            .candidates
            .get(candidate as usize)
            .map_or(INVALID_MOVE, |candidate| candidate.mv.raw())
    })
}

#[no_mangle]
pub extern "C" fn morris_engine_result_candidate_score(handle: u32, candidate: u32) -> i32 {
    result(handle).map_or(i32::MIN, |result| {
        result
            .candidates
            .get(candidate as usize)
            .map_or(i32::MIN, |candidate| candidate.score)
    })
}

#[no_mangle]
pub extern "C" fn morris_engine_result_candidate_pv_len(handle: u32, candidate: u32) -> u32 {
    result(handle).map_or(0, |result| {
        result
            .candidates
            .get(candidate as usize)
            .map_or(0, |candidate| candidate.pv.len() as u32)
    })
}

#[no_mangle]
pub extern "C" fn morris_engine_result_candidate_pv_move(
    handle: u32,
    candidate: u32,
    ply: u32,
) -> u32 {
    result(handle).map_or(INVALID_MOVE, |result| {
        result
            .candidates
            .get(candidate as usize)
            .and_then(|candidate| candidate.pv.get(ply as usize))
            .map_or(INVALID_MOVE, |mv| mv.raw())
    })
}

#[no_mangle]
pub extern "C" fn morris_engine_result_score(handle: u32) -> i32 {
    result(handle).map_or(i32::MIN, |result| result.score)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_depth(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.depth as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_nodes_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.nodes as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_nodes_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| (result.nodes >> 32) as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_nps_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.nps as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_nps_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| (result.nps >> 32) as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_completed(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.completed as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_timed_out(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.timed_out as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_leaves_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.leaves as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_leaves_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| (result.leaves >> 32) as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_symmetry_tt_hits_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.symmetry_tt_hits as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_symmetry_tt_hits_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| (result.symmetry_tt_hits >> 32) as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_tt_hits_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.tt_hits as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_tt_hits_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| (result.tt_hits >> 32) as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_placement_frontier_leaves_low(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.placement_frontier_leaves as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_placement_frontier_leaves_high(handle: u32) -> u32 {
    result(handle).map_or(0, |result| {
        (result.placement_frontier_leaves >> 32) as u32
    })
}

#[no_mangle]
pub extern "C" fn morris_engine_result_placement_target_depth(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.placement_target_depth as u32)
}

#[no_mangle]
pub extern "C" fn morris_engine_result_placement_complete(handle: u32) -> u32 {
    result(handle).map_or(0, |result| result.placement_complete as u32)
}

fn result(handle: u32) -> Option<SearchResult> {
    let state = state();
    valid_handle(&state, handle).then(|| state.result.clone()).flatten()
}

fn valid_handle(state: &FfiState, handle: u32) -> bool {
    handle != 0 && state.active_handle == handle && state.engine.is_some()
}

fn next_handle(previous: u32) -> u32 {
    let next = previous.wrapping_add(1);
    if next == 0 { 1 } else { next }
}

fn clamp_ffi_tt_megabytes(requested: u32) -> u32 {
    #[cfg(target_arch = "wasm32")]
    const MAX_TT_MB: u32 = 64;
    #[cfg(not(target_arch = "wasm32"))]
    const MAX_TT_MB: u32 = 1_024;
    requested.clamp(1, MAX_TT_MB)
}

fn clamp_ffi_search_time_ms(requested: u32) -> u32 {
    requested.min(60_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integer_abi_returns_candidates_and_pv() {
        assert_eq!(morris_engine_abi_version(), 1);
        assert_eq!(clamp_ffi_search_time_ms(u32::MAX), 60_000);
        let old_handle = morris_engine_create(1);
        assert_ne!(old_handle, 0);
        let handle = morris_engine_create(1);
        assert_ne!(handle, old_handle);
        morris_engine_destroy(old_handle);
        assert_eq!(
            morris_engine_search(handle, 0, 0, 9, 9, 0, 0, 0, 1, 3, 0, 0),
            0
        );
        assert_eq!(morris_engine_result_count(handle), 3);
        assert_ne!(morris_engine_result_move(handle, 0), INVALID_MOVE);
        assert!(morris_engine_result_candidate_pv_len(handle, 0) >= 1);
        assert_ne!(
            morris_engine_result_candidate_pv_move(handle, 0, 0),
            INVALID_MOVE
        );
        assert_eq!(morris_engine_result_timed_out(handle), 0);

        assert_eq!(morris_engine_push_history(handle, 0, 0, 9, 9, 0), 0);
        assert_eq!(morris_engine_result_count(handle), 0);
        assert_eq!(
            morris_engine_search(handle, 0, 0, 9, 9, 0, 0, 0, 1, 1, 0, 0),
            0
        );
        assert!(morris_engine_result_count(handle) > 0);
        assert_eq!(
            morris_engine_search(handle, 1, 1, 8, 8, 0, 0, 0, 1, 1, 0, 0),
            -2
        );
        assert_eq!(morris_engine_result_count(handle), 0);
        morris_engine_destroy(handle);
    }
}
