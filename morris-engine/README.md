# morris-engine

Independent standard Nine Men's Morris rules and search core. It shares no
logic with the Fanorona or draughts engines and contains no copied third-party
game code.

This first milestone provides the exact rules core and a deterministic search
foundation. The `Tablebase` trait is the boundary for the separately generated
3-vs-3 WDL/DTW database; no large database is bundled yet.

## Board and rules

The low 24 bits of each `u32` bitboard use these indices:

```text
00-----------01-----------02
|            |            |
|   03-------04-------05   |
|   |        |        |    |
|   |   06---07---08   |   |
|   |   |         |    |   |
09--10--11        12--13--14
|   |   |         |    |   |
|   |   15---16---17   |   |
|   |        |        |    |
|   18-------19-------20   |
|            |            |
21-----------22-----------23
```

`POINT_NAMES` maps those points to the conventional `a7`, `d7`, ... `g1`
coordinates. A generated move is a complete turn: placement/slide/flight plus
the mandatory single capture when the destination closes a mill. A mill stone
is protected while the opponent has a stone outside every mill; if all their
stones are in mills, any one may be captured.

## Move encoding

`Move` is a stable `u32` value:

| Bits | Meaning |
| --- | --- |
| 0-4 | destination, 0-23 |
| 5-9 | source, or 31 for placement |
| 10-14 | captured point, or 31 for none |
| 15-16 | kind: 0 placement, 1 slide, 2 flight |
| 17-31 | reserved, zero |

Use `Move::from_raw` rather than accepting unvalidated integers.

## Search

`Engine` implements iterative-deepening PVS/alpha-beta with:

- fixed-size transposition table;
- deterministic 16-way board-symmetry keys;
- TT, capture, killer, and history move ordering;
- a dedicated placement PVS with mill, forced-block, double-threat, and point-connectivity ordering;
- a placement frontier score based on total material, real empty adjacent edges, and completed mills;
- paired-ply iterative depths before the placement frontier to avoid one-sided horizon swings;
- bounded placement extensions for captures, forced mill blocks, and distinct executable mill targets;
- mill-capture quiescence;
- make/unmake with fixed-size move lists;
- actual-game plus search-path threefold repetition detection;
- a `Tablebase` probe boundary for exact 3-vs-3 WDL/DTW values;
- up to three candidates, each with score and principal variation.

Placement TT entries use canonical board orientation and store their best move
in that orientation; probes transform it back and validate it against the legal
move list. Movement TT entries additionally include the complete ordered game
history/search path, so a bound can never cross into a different repetition
context. Changing `Rules` or the tablebase clears all cached bounds.

MultiPV uses repeated root PVS. Null-window fail-low values are never published
as candidate scores: each returned rank has won a full-window root search, and
is returned with an exact score and reconstructed PV.

With `finish_placement` enabled, the target depth is automatically raised to
all remaining placements plus `placement_verification_depth` movement plies.
This prevents the final choice from being based only on the appearance of the
board immediately before movement begins. Time and node limits still apply;
`placement_complete` reports whether that full target was actually completed.

The placement frontier uses `materialDiff * 500 + adjacentFreedomDiff * 100 +
millsDiff * 80`. Adjacent freedom is counted for every stone already on the
board even while reserves remain. Tactical shapes are handled by search and
move ordering rather than being mixed into that horizon score. Movement uses a
separate phase-aware evaluation. A tablebase hit or terminal result always
outranks every heuristic term.

## Native CLI

```powershell
cargo test --release
cargo run --release -- perft 4
cargo run --release -- divide 3
cargo run --release -- bench 2000 64
cargo run --release -- placement-bench 2000 4
cargo run --release -- search
cargo run --release -- search 0x3 0x218 7 6 white 2000 20 3
```

`bench` reports completed depth, score, nodes, elapsed-search NPS, timeout state,
and the top three PVs.

`placement-bench` additionally reports total evaluation leaves, placement
frontier leaves, whether the placement endpoint plus verification was fully
searched, and ordinary/cross-symmetry transposition-table hits.

## Raw WebAssembly ABI

Build with:

```powershell
rustup target add wasm32-unknown-unknown
cargo rustc --release --target wasm32-unknown-unknown --lib -- --crate-type=cdylib
```

Raw `wasm32-unknown-unknown` has no monotonic clock. Instantiate it in a Worker
with the required import:

```js
const imports = { env: { now_ms: () => performance.now() } };
const { instance } = await WebAssembly.instantiate(bytes, imports);
const api = instance.exports;
```

The integer-only ABI is:

```text
morris_engine_abi_version() -> 1
morris_engine_create(tt_mb) -> handle
morris_engine_destroy(handle)
morris_engine_clear_history(handle) -> status
morris_engine_push_history(handle, p0, p1, reserve0, reserve1, side) -> status
morris_engine_search(handle, p0, p1, reserve0, reserve1, side,
                     plies_without_capture, time_ms, max_depth, top_n,
                     finish_placement, placement_verification_depth) -> status
```

Player bitboards are absolute player 0/player 1 identities, not reordered from
the side-to-move perspective. Before each search, clear and repopulate history
with the actual positions from the game. Including the current root is allowed.

Result getters expose:

```text
morris_engine_result_count
morris_engine_result_move
morris_engine_result_candidate_score
morris_engine_result_candidate_pv_len
morris_engine_result_candidate_pv_move
morris_engine_result_score
morris_engine_result_depth
morris_engine_result_nodes_low / _high
morris_engine_result_nps_low / _high
morris_engine_result_completed
morris_engine_result_timed_out
morris_engine_result_leaves_low / _high
morris_engine_result_symmetry_tt_hits_low / _high
morris_engine_result_tt_hits_low / _high
morris_engine_result_placement_frontier_leaves_low / _high
morris_engine_result_placement_target_depth
morris_engine_result_placement_complete
```

Handles are generation values. Calling `morris_engine_create` replaces the
single engine and invalidates every older handle; an old `destroy` call cannot
affect the replacement. On WebAssembly the requested transposition table is
clamped to 64 MiB, and ABI search time is clamped to 60,000 ms.

The ABI intentionally has no incremental-search or cooperative-cancel entry
point in this release. Production Workers hard-cancel an in-flight search with
`Worker.terminate()` and create a fresh Worker/engine generation afterward.

Invalid candidate/PV getters return `0xffffffff`; invalid scores return
`i32::MIN`. Combine high and low counters as unsigned 64-bit values in JS.

## Verification boundary

The test suite checks geometry, legal placement/movement/flight, capture
protection, all-in-mills capture, terminal blocking/material, move-code
roundtrips, make/unmake, opening perft, color-role invariance, and all sixteen
board automorphisms. A future tablebase implementation must additionally pass
an independent verifier for every WDL/DTW state.
