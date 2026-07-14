use core::mem::size_of;

use crate::clock::Clock;
use crate::board::ADJACENCY;
use crate::evaluation::{
    evaluate, evaluate_placement, executable_mill_targets, immediate_mill_points,
    potential_lines,
};
use crate::position::MoveList;
use crate::tablebase::is_initially_supported;
use crate::{inverse_symmetry, Move, Outcome, Player, Position, Rules, Tablebase, Wdl};

pub const MATE_SCORE: i32 = 30_000;
const TABLEBASE_SCORE: i32 = 28_000;
const DISTANCE_SCORE_THRESHOLD: i32 = TABLEBASE_SCORE - MAX_PLY as i32;
const INF: i32 = 32_000;
const MAX_PLY: usize = 128;
const MAX_PLACEMENT_QDEPTH: u8 = 3;
const DEFAULT_TT_MB: usize = 32;
const PATH_CONTEXT_SEED: u64 = 0x243f_6a88_85a3_08d3;

#[derive(Clone, Copy, Debug)]
pub struct SearchLimits {
    /// Zero disables the wall-clock limit.
    pub time_ms: u64,
    pub max_depth: u8,
    /// Zero disables the node limit.
    pub node_limit: u64,
    /// Number of root candidates to return, clamped to 1..=3.
    pub top_n: u8,
    /// When the root is in placement, raise the target depth far enough to
    /// reach the movement phase rather than trusting a shallow placement
    /// evaluation.
    pub finish_placement: bool,
    /// Additional movement plies searched beyond the final placement.
    pub placement_verification_depth: u8,
}

impl Default for SearchLimits {
    fn default() -> Self {
        Self {
            time_ms: 2_000,
            max_depth: 64,
            node_limit: 0,
            top_n: 3,
            finish_placement: true,
            placement_verification_depth: 4,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Candidate {
    pub mv: Move,
    pub score: i32,
    pub pv: Vec<Move>,
}

#[derive(Clone, Debug)]
pub struct SearchResult {
    pub candidates: Vec<Candidate>,
    pub score: i32,
    pub depth: u8,
    pub nodes: u64,
    pub nps: u64,
    pub leaves: u64,
    pub placement_frontier_leaves: u64,
    pub tt_hits: u64,
    pub symmetry_tt_hits: u64,
    pub placement_target_depth: u8,
    pub placement_complete: bool,
    /// True only when the requested depth was fully completed or the root was
    /// already terminal. An interrupted search still returns its last complete
    /// iterative-deepening result.
    pub completed: bool,
    pub timed_out: bool,
}

impl SearchResult {
    pub fn best_move(&self) -> Option<Move> {
        self.candidates.first().map(|candidate| candidate.mv)
    }

    pub fn pv(&self) -> &[Move] {
        self.candidates
            .first()
            .map_or(&[], |candidate| candidate.pv.as_slice())
    }
}

pub struct Engine {
    rules: Rules,
    tt: TranspositionTable,
    tablebase: Option<Box<dyn Tablebase>>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(DEFAULT_TT_MB)
    }
}

impl Engine {
    pub fn new(tt_megabytes: usize) -> Self {
        Self {
            rules: Rules::default(),
            tt: TranspositionTable::new(tt_megabytes),
            tablebase: None,
        }
    }

    pub fn rules(&self) -> Rules {
        self.rules
    }

    pub fn set_rules(&mut self, rules: Rules) {
        self.tt.clear();
        self.rules = rules;
    }

    pub fn set_tablebase(&mut self, tablebase: Option<Box<dyn Tablebase>>) {
        self.tt.clear();
        self.tablebase = tablebase;
    }

    pub fn clear_hash(&mut self) {
        self.tt.clear();
    }

    pub fn search(&mut self, position: &Position, limits: SearchLimits) -> SearchResult {
        self.search_with_history(position, &[], limits)
    }

    /// `history` contains repetition keys for positions already seen in the
    /// real game. It may include the root; a duplicate trailing root is not
    /// added. Descendant keys are maintained by make/unmake during search.
    pub fn search_with_history(
        &mut self,
        position: &Position,
        history: &[u64],
        mut limits: SearchLimits,
    ) -> SearchResult {
        limits.max_depth = limits.max_depth.clamp(1, (MAX_PLY - 2) as u8);
        limits.top_n = limits.top_n.clamp(1, 3);
        limits.placement_verification_depth = limits
            .placement_verification_depth
            .min((MAX_PLY - 20) as u8);
        self.tt.next_generation();

        let tablebase = self.tablebase.as_deref();
        let mut state = SearchState::new(
            &mut self.tt,
            tablebase,
            self.rules,
            limits,
            position,
            history,
        );
        state.iterative_deepening(*position)
    }
}

struct SearchState<'a> {
    tt: &'a mut TranspositionTable,
    tablebase: Option<&'a dyn Tablebase>,
    rules: Rules,
    limits: SearchLimits,
    clock: Clock,
    nodes: u64,
    leaves: u64,
    placement_frontier_leaves: u64,
    tt_hits: u64,
    symmetry_tt_hits: u64,
    placement_target_depth: u8,
    stopped: bool,
    timed_out: bool,
    path: Vec<u64>,
    path_contexts: Vec<u64>,
    killers: [[Option<Move>; 2]; MAX_PLY],
    history_scores: [[i32; 24]; 25],
    pv: [[Move; MAX_PLY]; MAX_PLY],
    pv_len: [usize; MAX_PLY],
}

impl<'a> SearchState<'a> {
    fn new(
        tt: &'a mut TranspositionTable,
        tablebase: Option<&'a dyn Tablebase>,
        rules: Rules,
        mut limits: SearchLimits,
        root: &Position,
        history: &[u64],
    ) -> Self {
        let mut path = history.to_vec();
        let root_key = root.repetition_key();
        if path.last().copied() != Some(root_key) {
            path.push(root_key);
        }
        let mut path_contexts = Vec::with_capacity(path.len() + MAX_PLY);
        let mut context = PATH_CONTEXT_SEED;
        for (index, &key) in path.iter().enumerate() {
            context = extend_path_context(context, key, index);
            path_contexts.push(context);
        }
        let placements_remaining = root.reserve(Player::White) + root.reserve(Player::Black);
        let placement_target_depth = if placements_remaining > 0 && limits.finish_placement {
            placements_remaining.saturating_add(limits.placement_verification_depth)
        } else {
            0
        };
        if placement_target_depth > 0 {
            limits.max_depth = limits.max_depth.max(placement_target_depth);
        }
        Self {
            tt,
            tablebase,
            rules,
            limits,
            clock: Clock::start(),
            nodes: 0,
            leaves: 0,
            placement_frontier_leaves: 0,
            tt_hits: 0,
            symmetry_tt_hits: 0,
            placement_target_depth,
            stopped: false,
            timed_out: false,
            path,
            path_contexts,
            killers: [[None; 2]; MAX_PLY],
            history_scores: [[0; 24]; 25],
            pv: [[Move::default(); MAX_PLY]; MAX_PLY],
            pv_len: [0; MAX_PLY],
        }
    }

    fn iterative_deepening(&mut self, mut root: Position) -> SearchResult {
        if self.is_repetition() {
            return self.finish(Vec::new(), 0, 0, true);
        }

        match root.outcome_with_rules(&self.rules) {
            Outcome::Win(winner) => {
                let score = if winner == root.side_to_move() {
                    MATE_SCORE
                } else {
                    -MATE_SCORE
                };
                return self.finish(Vec::new(), score, 0, true);
            }
            Outcome::Draw => return self.finish(Vec::new(), 0, 0, true),
            Outcome::Ongoing => {}
        }

        if let Some(score) = self.probe_tablebase(&root, 0) {
            // Keep searching one ply to turn an exact root value into an
            // actionable tablebase-preserving move.
            if root.legal_moves().is_empty() {
                return self.finish(Vec::new(), score, 0, true);
            }
        }

        let mut root_moves = root.legal_moves();
        let root_is_placement = root.reserve(Player::White) > 0 || root.reserve(Player::Black) > 0;
        let root_placements_remaining =
            root.reserve(Player::White) + root.reserve(Player::Black);
        self.order_moves(&root, &mut root_moves, None, 0, root_is_placement);
        let mut ordering: Vec<Move> = root_moves.as_slice().to_vec();
        let mut last_complete = self.fallback_candidates(&mut root, &ordering);
        let mut completed_depth = 0_u8;

        for depth in 1..=self.limits.max_depth {
            // Before the placement frontier, compare positions after complete
            // move pairs. An odd frontier gives one side an extra on-board
            // stone and caused large depth-parity swings under short budgets.
            // Depth one remains as an emergency result, and every depth is
            // searched again once the remaining placements are exhausted.
            if !should_search_iteration_depth(
                root_is_placement,
                self.limits.finish_placement,
                depth,
                root_placements_remaining,
            ) {
                continue;
            }
            let requested = (self.limits.top_n as usize).min(ordering.len());
            let mut remaining = ordering.clone();
            let mut iteration = Vec::with_capacity(requested);
            for _ in 0..requested {
                let Some(candidate) = self.search_best_root_line(&mut root, depth, &remaining) else {
                    break;
                };
                remaining.retain(|&mv| mv != candidate.mv);
                iteration.push(candidate);
            }

            if self.stopped || iteration.len() != requested {
                break;
            }

            iteration.sort_by(|left, right| {
                right
                    .score
                    .cmp(&left.score)
                    .then_with(|| left.mv.raw().cmp(&right.mv.raw()))
            });
            ordering.clear();
            ordering.extend(iteration.iter().map(|candidate| candidate.mv));
            ordering.extend(remaining);
            last_complete = iteration;
            completed_depth = depth;

            if last_complete
                .first()
                .is_some_and(|candidate| candidate.score.abs() >= TABLEBASE_SCORE - MAX_PLY as i32)
            {
                // An exact-distance result cannot improve by going deeper.
                break;
            }
        }

        if self.stopped && completed_depth == 0 {
            last_complete.clear();
        }
        let completed = !self.stopped || completed_depth == self.limits.max_depth;
        let score = last_complete.first().map_or(0, |candidate| candidate.score);
        last_complete.truncate(self.limits.top_n as usize);
        self.finish(last_complete, score, completed_depth, completed)
    }

    /// Finds one exact best line among `moves`. Non-leading moves use a null
    /// window only as a probe; every move that can become the winner is
    /// re-searched with the full remaining root window before being returned.
    fn search_best_root_line(
        &mut self,
        root: &mut Position,
        depth: u8,
        moves: &[Move],
    ) -> Option<Candidate> {
        let mut alpha = -INF;
        let mut best = None;

        for (index, &mv) in moves.iter().enumerate() {
            let undo = root.make_move_unchecked(mv);
            self.push_path_key(root.repetition_key());
            let mut exact = index == 0;
            let mut score = if exact {
                -self.search_node(root, depth as i16 - 1, -INF, INF, 1)
            } else {
                -self.search_node(root, depth as i16 - 1, -alpha - 1, -alpha, 1)
            };
            if !self.stopped && !exact && score > alpha {
                score = -self.search_node(root, depth as i16 - 1, -INF, -alpha, 1);
                exact = true;
            }

            let candidate = if !self.stopped && exact && score > alpha {
                let mut pv = Vec::with_capacity(self.pv_len[1].saturating_sub(1) + 1);
                pv.push(mv);
                for ply in 1..self.pv_len[1] {
                    pv.push(self.pv[1][ply]);
                }
                let tt_pv = self.collect_tt_root_pv(mv, root, depth.saturating_sub(1));
                if tt_pv.len() > pv.len() {
                    pv = tt_pv;
                }
                Some(Candidate { mv, score, pv })
            } else {
                None
            };
            self.pop_path_key();
            root.undo_move(undo);

            if self.stopped {
                return None;
            }
            if let Some(candidate) = candidate {
                alpha = score;
                best = Some(candidate);
            }
        }
        best
    }

    fn collect_tt_root_pv(
        &mut self,
        root_move: Move,
        child: &Position,
        remaining_depth: u8,
    ) -> Vec<Move> {
        let mut result = vec![root_move];
        let mut cursor = *child;
        let mut pushed = 0;

        for _ in 0..remaining_depth {
            if self.is_repetition()
                || !matches!(cursor.outcome_with_rules(&self.rules), Outcome::Ongoing)
            {
                break;
            }
            let placement = cursor.reserve(Player::White) > 0 || cursor.reserve(Player::Black) > 0;
            let context = self.tt_context(&cursor, placement);
            let Some(entry) = self.tt.probe(context.key) else {
                break;
            };
            let Some(mv) = decode_tt_move(context, entry) else {
                break;
            };
            if !cursor.legal_moves().as_slice().contains(&mv) {
                break;
            }
            result.push(mv);
            cursor.make_move_unchecked(mv);
            self.push_path_key(cursor.repetition_key());
            pushed += 1;
        }

        for _ in 0..pushed {
            self.pop_path_key();
        }
        result
    }

    fn fallback_candidates(&mut self, root: &mut Position, moves: &[Move]) -> Vec<Candidate> {
        let mut result = Vec::with_capacity(moves.len());
        for &mv in moves {
            let undo = root.make_move_unchecked(mv);
            let score = if root.reserve(Player::White) > 0 || root.reserve(Player::Black) > 0 {
                -evaluate_placement(root)
            } else {
                -evaluate(root)
            };
            root.undo_move(undo);
            result.push(Candidate {
                mv,
                score,
                pv: vec![mv],
            });
        }
        result.sort_by(|left, right| right.score.cmp(&left.score));
        result
    }

    fn finish(
        &self,
        candidates: Vec<Candidate>,
        score: i32,
        depth: u8,
        completed: bool,
    ) -> SearchResult {
        let elapsed_seconds = (self.clock.elapsed_ms() / 1_000.0).max(0.000_001);
        // `depth` is the last fully completed iterative-deepening iteration.
        // Reaching the placement target stays valid even if a later, optional
        // iteration times out before the configured maximum depth.
        let placement_complete = self.placement_target_depth == 0
            || depth >= self.placement_target_depth
            || (completed
                && (candidates.is_empty() || score.abs() >= TABLEBASE_SCORE - MAX_PLY as i32));
        SearchResult {
            candidates,
            score,
            depth,
            nodes: self.nodes,
            nps: (self.nodes as f64 / elapsed_seconds) as u64,
            leaves: self.leaves,
            placement_frontier_leaves: self.placement_frontier_leaves,
            tt_hits: self.tt_hits,
            symmetry_tt_hits: self.symmetry_tt_hits,
            placement_target_depth: self.placement_target_depth,
            placement_complete,
            completed,
            timed_out: self.timed_out,
        }
    }

    fn search_node(
        &mut self,
        position: &mut Position,
        depth: i16,
        alpha: i32,
        beta: i32,
        ply: usize,
    ) -> i32 {
        if position.reserve(Player::White) > 0 || position.reserve(Player::Black) > 0 {
            self.placement_negamax(position, depth, alpha, beta, ply)
        } else {
            self.negamax(position, depth, alpha, beta, ply)
        }
    }

    /// Placement-specific entry point. It shares only the sound PVS mechanics
    /// with movement search; evaluation and move ordering are phase-aware.
    fn placement_negamax(
        &mut self,
        position: &mut Position,
        depth: i16,
        alpha: i32,
        beta: i32,
        ply: usize,
    ) -> i32 {
        self.pvs_node(position, depth, alpha, beta, ply, true)
    }

    fn negamax(
        &mut self,
        position: &mut Position,
        depth: i16,
        alpha: i32,
        beta: i32,
        ply: usize,
    ) -> i32 {
        self.pvs_node(position, depth, alpha, beta, ply, false)
    }

    fn pvs_node(
        &mut self,
        position: &mut Position,
        depth: i16,
        mut alpha: i32,
        beta: i32,
        ply: usize,
        placement: bool,
    ) -> i32 {
        self.pv_len[ply] = ply;
        self.nodes = self.nodes.saturating_add(1);
        if self.should_stop() {
            return 0;
        }
        if self.is_repetition() {
            return 0;
        }

        match position.outcome_with_rules(&self.rules) {
            Outcome::Win(winner) => {
                return if winner == position.side_to_move() {
                    MATE_SCORE - ply as i32
                } else {
                    -MATE_SCORE + ply as i32
                };
            }
            Outcome::Draw => return 0,
            Outcome::Ongoing => {}
        }
        if let Some(score) = self.probe_tablebase(position, ply) {
            return score;
        }
        if depth <= 0 || ply + 1 >= MAX_PLY {
            if placement {
                return self.placement_quiescence(position, alpha, beta, ply, 0);
            }
            return self.quiescence(position, alpha, beta, ply, 0);
        }

        let tt_context = self.tt_context(position, placement);
        let tt_entry = self.tt.probe(tt_context.key);
        if let Some(entry) = tt_entry {
            self.tt_hits = self.tt_hits.saturating_add(1);
            if tt_context.to_canonical.is_some() && entry.raw_key != tt_context.raw_key {
                self.symmetry_tt_hits = self.symmetry_tt_hits.saturating_add(1);
            }
        }
        if let Some(entry) = tt_entry.filter(|entry| entry.depth >= depth) {
            let score = score_from_tt(entry.score, ply);
            match entry.bound {
                Bound::Exact => return score,
                Bound::Lower if score >= beta => return score,
                Bound::Upper if score <= alpha => return score,
                _ => {}
            }
        }

        let original_alpha = alpha;
        let mut moves = position.legal_moves();
        let tt_move = tt_entry
            .and_then(|entry| decode_tt_move(tt_context, entry))
            .filter(|mv| moves.as_slice().contains(mv));
        self.order_moves(position, &mut moves, tt_move, ply, placement);
        let mut best_score = -INF;
        let mut best_move = Move::default();

        for (index, &mv) in moves.as_slice().iter().enumerate() {
            let undo = position.make_move_unchecked(mv);
            self.push_path_key(position.repetition_key());
            if placement
                && position.reserve(Player::White) == 0
                && position.reserve(Player::Black) == 0
            {
                self.placement_frontier_leaves =
                    self.placement_frontier_leaves.saturating_add(1);
            }

            let mut score = if index == 0 {
                -self.search_node(position, depth - 1, -beta, -alpha, ply + 1)
            } else {
                -self.search_node(position, depth - 1, -alpha - 1, -alpha, ply + 1)
            };
            if !self.stopped && index != 0 && score > alpha && score < beta {
                score = -self.search_node(position, depth - 1, -beta, -alpha, ply + 1);
            }

            self.pop_path_key();
            position.undo_move(undo);
            if self.stopped {
                return 0;
            }

            if score > best_score {
                best_score = score;
                best_move = mv;
            }
            if score > alpha {
                alpha = score;
                self.update_pv(ply, mv);
            }
            if alpha >= beta {
                if mv.capture().is_none() {
                    self.record_quiet_cutoff(mv, depth, ply);
                }
                break;
            }
        }

        let bound = if best_score <= original_alpha {
            Bound::Upper
        } else if best_score >= beta {
            Bound::Lower
        } else {
            Bound::Exact
        };
        let generation = self.tt.generation;
        let stored_best = match tt_context.to_canonical {
            Some(symmetry) => best_move
                .transformed(symmetry)
                .expect("a legal move transforms with the board"),
            None => best_move,
        };
        self.tt.store(TtEntry {
            key: tt_context.key,
            raw_key: tt_context.raw_key,
            best: stored_best,
            score: score_to_tt(best_score, ply),
            depth,
            bound,
            generation,
        });
        best_score
    }

    fn placement_quiescence(
        &mut self,
        position: &mut Position,
        mut alpha: i32,
        beta: i32,
        ply: usize,
        qdepth: u8,
    ) -> i32 {
        if self.should_stop() || self.is_repetition() {
            return 0;
        }
        match position.outcome_with_rules(&self.rules) {
            Outcome::Win(winner) => {
                return if winner == position.side_to_move() {
                    MATE_SCORE - ply as i32
                } else {
                    -MATE_SCORE + ply as i32
                };
            }
            Outcome::Draw => return 0,
            Outcome::Ongoing => {}
        }
        if let Some(score) = self.probe_tablebase(position, ply) {
            return score;
        }

        self.leaves = self.leaves.saturating_add(1);
        let mover = position.side_to_move();
        let opponent_targets = executable_mill_targets(position, mover.opponent());
        // At the first frontier ply, an immediate opposing mill is analogous
        // to check: standing pat would hide the capture, so examine every
        // reply. Deeper extension plies remain selective and bounded.
        let must_answer_threat = qdepth == 0 && opponent_targets != 0;
        if !must_answer_threat {
            let stand_pat = evaluate_placement(position);
            if stand_pat >= beta {
                return stand_pat;
            }
            alpha = alpha.max(stand_pat);
        }
        if qdepth >= MAX_PLACEMENT_QDEPTH || ply + 1 >= MAX_PLY {
            return alpha;
        }

        let mut moves = position.legal_moves();
        self.order_moves(position, &mut moves, None, ply, true);
        for &mv in moves.as_slice() {
            let undo = position.make_move_unchecked(mv);
            if !must_answer_threat
                && !placement_move_is_tactical(position, mv, mover, opponent_targets)
            {
                position.undo_move(undo);
                continue;
            }

            self.push_path_key(position.repetition_key());
            self.nodes = self.nodes.saturating_add(1);
            if position.reserve(Player::White) == 0 && position.reserve(Player::Black) == 0 {
                self.placement_frontier_leaves =
                    self.placement_frontier_leaves.saturating_add(1);
            }
            let score = if self.is_repetition() {
                0
            } else if position.reserve(Player::White) > 0
                || position.reserve(Player::Black) > 0
            {
                -self.placement_quiescence(
                    position,
                    -beta,
                    -alpha,
                    ply + 1,
                    qdepth + 1,
                )
            } else {
                -self.quiescence(position, -beta, -alpha, ply + 1, 0)
            };
            self.pop_path_key();
            position.undo_move(undo);
            if self.should_stop() {
                return 0;
            }
            if score >= beta {
                return score;
            }
            alpha = alpha.max(score);
        }
        alpha
    }

    fn quiescence(
        &mut self,
        position: &mut Position,
        mut alpha: i32,
        beta: i32,
        ply: usize,
        qdepth: u8,
    ) -> i32 {
        if self.should_stop() || self.is_repetition() {
            return 0;
        }
        match position.outcome_with_rules(&self.rules) {
            Outcome::Win(winner) => {
                return if winner == position.side_to_move() {
                    MATE_SCORE - ply as i32
                } else {
                    -MATE_SCORE + ply as i32
                };
            }
            Outcome::Draw => return 0,
            Outcome::Ongoing => {}
        }
        if let Some(score) = self.probe_tablebase(position, ply) {
            return score;
        }
        self.leaves = self.leaves.saturating_add(1);
        let stand_pat = evaluate(position);
        if stand_pat >= beta {
            return stand_pat;
        }
        alpha = alpha.max(stand_pat);
        if qdepth >= 4 || ply + 1 >= MAX_PLY {
            return alpha;
        }

        let mut moves = position.legal_moves();
        self.order_moves(position, &mut moves, None, ply, false);
        for &mv in moves.as_slice() {
            if mv.capture().is_none() {
                continue;
            }
            let undo = position.make_move_unchecked(mv);
            self.push_path_key(position.repetition_key());
            self.nodes = self.nodes.saturating_add(1);
            let score = if self.is_repetition() {
                0
            } else {
                -self.quiescence(position, -beta, -alpha, ply + 1, qdepth + 1)
            };
            self.pop_path_key();
            position.undo_move(undo);
            if self.should_stop() {
                return 0;
            }
            if score >= beta {
                return score;
            }
            alpha = alpha.max(score);
        }
        alpha
    }

    fn probe_tablebase(&self, position: &Position, ply: usize) -> Option<i32> {
        if !is_initially_supported(position) {
            return None;
        }
        let hit = self.tablebase?.probe(position)?;
        let total_distance = (hit.dtw as usize).saturating_add(ply).min(MAX_PLY) as i32;
        Some(match hit.wdl {
            Wdl::Win => TABLEBASE_SCORE - total_distance,
            Wdl::Draw => 0,
            Wdl::Loss => -TABLEBASE_SCORE + total_distance,
        })
    }

    fn tt_context(&self, position: &Position, placement: bool) -> TtContext {
        let raw_key = position.raw_transposition_key();
        if placement {
            let (key, symmetry) = position.canonical_transposition();
            TtContext {
                key,
                raw_key,
                to_canonical: Some(symmetry),
            }
        } else {
            // Movement can cycle. The exact ordered path is intentionally part
            // of the key so a bound derived with one repetition history cannot
            // be reused under another history.
            let path_context = self
                .path_contexts
                .last()
                .copied()
                .unwrap_or(PATH_CONTEXT_SEED);
            TtContext {
                key: mix64(raw_key ^ path_context.rotate_left(23)),
                raw_key,
                to_canonical: None,
            }
        }
    }

    fn order_moves(
        &self,
        position: &Position,
        moves: &mut MoveList,
        tt_move: Option<Move>,
        ply: usize,
        placement: bool,
    ) {
        let slice = moves.as_mut_slice();
        for index in 1..slice.len() {
            let candidate = slice[index];
            let candidate_score =
                self.move_order_score(position, candidate, tt_move, ply, placement);
            let mut insertion = index;
            while insertion > 0
                && self.move_order_score(
                    position,
                    slice[insertion - 1],
                    tt_move,
                    ply,
                    placement,
                ) < candidate_score
            {
                slice[insertion] = slice[insertion - 1];
                insertion -= 1;
            }
            slice[insertion] = candidate;
        }
    }

    fn move_order_score(
        &self,
        position: &Position,
        mv: Move,
        tt_move: Option<Move>,
        ply: usize,
        placement: bool,
    ) -> i32 {
        if tt_move == Some(mv) {
            return 2_000_000;
        }
        let mut score = 0;
        if mv.capture().is_some() {
            score += 1_500_000;
        }
        if placement {
            score += placement_order_score(position, mv);
        }
        if ply < MAX_PLY {
            if self.killers[ply][0] == Some(mv) {
                score += if placement { 250_000 } else { 800_000 };
            } else if self.killers[ply][1] == Some(mv) {
                score += if placement { 200_000 } else { 700_000 };
            }
        }
        let source = mv.from().map_or(24, usize::from);
        score + self.history_scores[source][mv.to() as usize]
    }

    fn record_quiet_cutoff(&mut self, mv: Move, depth: i16, ply: usize) {
        if self.killers[ply][0] != Some(mv) {
            self.killers[ply][1] = self.killers[ply][0];
            self.killers[ply][0] = Some(mv);
        }
        let source = mv.from().map_or(24, usize::from);
        let bonus = i32::from(depth).saturating_mul(i32::from(depth)).min(4_000);
        let entry = &mut self.history_scores[source][mv.to() as usize];
        *entry = (*entry + bonus).min(1_000_000);
    }

    fn update_pv(&mut self, ply: usize, mv: Move) {
        self.pv[ply][ply] = mv;
        let child_len = self.pv_len[ply + 1];
        for index in (ply + 1)..child_len {
            self.pv[ply][index] = self.pv[ply + 1][index];
        }
        self.pv_len[ply] = child_len.max(ply + 1);
    }

    fn is_repetition(&self) -> bool {
        let Some(&current) = self.path.last() else {
            return false;
        };
        let required = self.rules.repetitions_for_draw;
        required > 0
            && self.path.iter().filter(|&&key| key == current).count() >= required as usize
    }

    fn push_path_key(&mut self, key: u64) {
        let previous = self
            .path_contexts
            .last()
            .copied()
            .unwrap_or(PATH_CONTEXT_SEED);
        let context = extend_path_context(previous, key, self.path.len());
        self.path.push(key);
        self.path_contexts.push(context);
    }

    fn pop_path_key(&mut self) {
        self.path.pop();
        self.path_contexts.pop();
    }

    fn should_stop(&mut self) -> bool {
        if self.stopped {
            return true;
        }
        if self.limits.node_limit > 0 && self.nodes >= self.limits.node_limit {
            self.stopped = true;
            return true;
        }
        if self.nodes & 0x3ff == 0
            && self.limits.time_ms > 0
            && self.clock.elapsed_ms() >= self.limits.time_ms as f64
        {
            self.stopped = true;
            self.timed_out = true;
        }
        self.stopped
    }
}

fn should_search_iteration_depth(
    root_is_placement: bool,
    finish_placement: bool,
    depth: u8,
    placements_remaining: u8,
) -> bool {
    !root_is_placement
        || !finish_placement
        || depth <= 1
        || depth >= placements_remaining
        || depth % 2 == 0
}

fn placement_move_is_tactical(
    position_after: &Position,
    mv: Move,
    mover: Player,
    opponent_targets: u32,
) -> bool {
    mv.capture().is_some()
        || opponent_targets & (1 << mv.to()) != 0
        || executable_mill_targets(position_after, mover).count_ones() >= 2
}

#[derive(Clone, Copy)]
struct TtContext {
    key: u64,
    raw_key: u64,
    to_canonical: Option<u8>,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Bound {
    Exact,
    Lower,
    Upper,
}

#[derive(Clone, Copy, Debug)]
struct TtEntry {
    key: u64,
    raw_key: u64,
    best: Move,
    score: i32,
    depth: i16,
    bound: Bound,
    generation: u8,
}

impl Default for TtEntry {
    fn default() -> Self {
        Self {
            key: 0,
            raw_key: 0,
            best: Move::default(),
            score: 0,
            depth: -1,
            bound: Bound::Upper,
            generation: 0,
        }
    }
}

fn decode_tt_move(context: TtContext, entry: TtEntry) -> Option<Move> {
    match context.to_canonical {
        Some(symmetry) => entry.best.transformed(inverse_symmetry(symmetry)?),
        None => Some(entry.best),
    }
}

fn placement_order_score(position: &Position, mv: Move) -> i32 {
    let player = position.side_to_move();
    let opponent = player.opponent();
    let own_before = position.stones(player);
    let opponent_before = position.stones(opponent);
    let occupied_before = position.occupied();

    let mut own_after = own_before;
    if let Some(from) = mv.from() {
        own_after &= !(1 << from);
    }
    own_after |= 1 << mv.to();
    let mut opponent_after = opponent_before;
    if let Some(capture) = mv.capture() {
        opponent_after &= !(1 << capture);
    }
    let occupied_after = own_after | opponent_after;

    let opponent_threats = immediate_mill_points(opponent_before, occupied_before);
    let before_lines = potential_lines(own_before, occupied_before);
    let after_lines = potential_lines(own_after, occupied_after);
    let after_threats = immediate_mill_points(own_after, occupied_after);

    let mut score = 0;
    if opponent_threats & (1 << mv.to()) != 0 {
        score += 900_000;
    }
    if after_threats.count_ones() >= 2 && after_lines > before_lines {
        score += 600_000 + (after_lines - before_lines) * 20_000;
    } else if after_lines > before_lines {
        score += (after_lines - before_lines) * 80_000;
    }
    score += ADJACENCY[mv.to() as usize].count_ones() as i32 * 2_000;
    score += (ADJACENCY[mv.to() as usize] & own_after).count_ones() as i32 * 1_000;
    score
}

struct TranspositionTable {
    entries: Vec<TtEntry>,
    mask: usize,
    generation: u8,
}

impl TranspositionTable {
    fn new(megabytes: usize) -> Self {
        let requested = megabytes.max(1) * 1024 * 1024 / size_of::<TtEntry>();
        let capacity = floor_power_of_two(requested.max(1));
        Self {
            entries: vec![TtEntry::default(); capacity],
            mask: capacity - 1,
            generation: 0,
        }
    }

    fn clear(&mut self) {
        self.entries.fill(TtEntry::default());
    }

    #[cfg(test)]
    fn occupied(&self) -> usize {
        self.entries.iter().filter(|entry| entry.depth >= 0).count()
    }

    fn next_generation(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }

    fn probe(&self, key: u64) -> Option<TtEntry> {
        let entry = self.entries[key as usize & self.mask];
        (entry.key == key && entry.depth >= 0).then_some(entry)
    }

    fn store(&mut self, entry: TtEntry) {
        let slot = &mut self.entries[entry.key as usize & self.mask];
        if slot.key != entry.key
            && slot.generation == self.generation
            && slot.depth > entry.depth
            && entry.bound != Bound::Exact
        {
            return;
        }
        *slot = entry;
    }
}

fn floor_power_of_two(value: usize) -> usize {
    1_usize << (usize::BITS - 1 - value.leading_zeros())
}

fn extend_path_context(previous: u64, key: u64, index: usize) -> u64 {
    mix64(
        previous
            ^ key.rotate_left(((index * 11 + 7) & 63) as u32)
            ^ (index as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15),
    )
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn score_to_tt(score: i32, ply: usize) -> i32 {
    if score > DISTANCE_SCORE_THRESHOLD {
        score + ply as i32
    } else if score < -DISTANCE_SCORE_THRESHOLD {
        score - ply as i32
    } else {
        score
    }
}

fn score_from_tt(score: i32, ply: usize) -> i32 {
    if score > DISTANCE_SCORE_THRESHOLD {
        score - ply as i32
    } else if score < -DISTANCE_SCORE_THRESHOLD {
        score + ply as i32
    } else {
        score
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TablebaseHit;

    fn mask(points: &[u8]) -> u32 {
        points.iter().fold(0, |result, &point| result | (1 << point))
    }

    #[test]
    fn incomplete_placement_search_uses_balanced_pair_depths() {
        let searched: Vec<u8> = (1..=16)
            .filter(|&depth| should_search_iteration_depth(true, true, depth, 15))
            .collect();

        assert_eq!(searched, vec![1, 2, 4, 6, 8, 10, 12, 14, 15, 16]);
        assert!(should_search_iteration_depth(true, false, 9, 15));
        assert!(should_search_iteration_depth(false, true, 9, 15));
    }

    #[test]
    fn finds_immediate_mill_capture() {
        let position = Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 9]), 7, 6, 0, 0).unwrap();
        let mut engine = Engine::new(1);
        let result = engine.search(
            &position,
            SearchLimits {
                time_ms: 0,
                max_depth: 2,
                node_limit: 0,
                top_n: 3,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert_eq!(result.best_move().unwrap().to(), 2);
        assert!(result.best_move().unwrap().capture().is_some());
    }

    #[test]
    fn root_history_detects_threefold_repetition() {
        let position = Position::standard();
        let key = position.repetition_key();
        let mut engine = Engine::new(1);
        let result = engine.search_with_history(
            &position,
            &[key, key, key],
            SearchLimits {
                time_ms: 0,
                max_depth: 1,
                node_limit: 0,
                top_n: 1,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert!(result.candidates.is_empty());
        assert_eq!(result.score, 0);
    }

    #[test]
    fn score_tt_roundtrip_adjusts_mate_distance() {
        for ply in [0, 1, 17, 100] {
            for score in [
                MATE_SCORE - 12,
                -MATE_SCORE + 12,
                TABLEBASE_SCORE - 25,
                -TABLEBASE_SCORE + 25,
                417,
                -99,
            ] {
                assert_eq!(score_from_tt(score_to_tt(score, ply), ply), score);
            }
        }
    }

    #[test]
    fn placement_finish_reaches_movement_and_verifies_extra_plies() {
        let position = Position::from_parts(
            mask(&[0, 2, 4, 6, 8, 10, 12, 14]),
            mask(&[1, 3, 5, 7, 9, 11, 13, 15]),
            1,
            1,
            0,
            0,
        )
        .unwrap();
        let mut engine = Engine::new(1);
        let result = engine.search(
            &position,
            SearchLimits {
                time_ms: 0,
                max_depth: 1,
                node_limit: 0,
                top_n: 1,
                finish_placement: true,
                placement_verification_depth: 2,
            },
        );
        assert_eq!(result.placement_target_depth, 4);
        assert!(result.depth >= 4);
        assert!(result.placement_complete);
        assert!(result.placement_frontier_leaves > 0);
    }

    #[test]
    fn completed_placement_target_survives_a_later_timeout() {
        let position = Position::from_parts(
            mask(&[0, 2, 4, 6, 8, 10, 12]),
            mask(&[1, 3, 5, 7, 9, 11, 13]),
            2,
            2,
            0,
            0,
        )
        .unwrap();
        let mut tt = TranspositionTable::new(1);
        let state = SearchState::new(
            &mut tt,
            None,
            Rules::default(),
            SearchLimits {
                time_ms: 1,
                max_depth: 8,
                node_limit: 0,
                top_n: 1,
                finish_placement: true,
                placement_verification_depth: 0,
            },
            &position,
            &[],
        );
        assert_eq!(state.placement_target_depth, 4);
        let result = state.finish(Vec::new(), 0, 4, false);
        assert!(result.placement_complete);
        assert!(!result.completed);
    }

    #[test]
    fn canonical_tt_reports_cross_symmetry_hits() {
        let position = Position::standard();
        let mut engine = Engine::new(1);
        let result = engine.search(
            &position,
            SearchLimits {
                time_ms: 0,
                max_depth: 3,
                node_limit: 0,
                top_n: 1,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert!(result.tt_hits > 0);
        assert!(result.symmetry_tt_hits > 0);
    }

    #[test]
    fn placement_order_prioritizes_blocking_an_immediate_mill() {
        let position = Position::from_parts(mask(&[3]), mask(&[0, 1]), 8, 7, 0, 0).unwrap();
        let block = placement_order_score(&position, Move::place(2, None));
        let unrelated = placement_order_score(&position, Move::place(23, None));
        assert!(block > unrelated + 500_000);
    }

    #[test]
    fn placement_extension_recognizes_capture_block_and_distinct_target_fork() {
        let mut replay = Position::from_parts(0x60_0003, 0x88_0094, 5, 4, 0, 0).unwrap();
        let opponent_targets = executable_mill_targets(&replay, Player::Black);

        let capture = replay
            .legal_moves()
            .as_slice()
            .iter()
            .copied()
            .find(|mv| mv.to() == 9 && mv.capture() == Some(2))
            .unwrap();
        let undo = replay.make_move(capture).unwrap();
        assert!(placement_move_is_tactical(
            &replay,
            capture,
            Player::White,
            opponent_targets
        ));
        replay.undo_move(undo);

        let block = Move::place(14, None);
        let undo = replay.make_move(block).unwrap();
        assert!(placement_move_is_tactical(
            &replay,
            block,
            Player::White,
            opponent_targets
        ));
        replay.undo_move(undo);

        let mut fork = Position::from_parts(mask(&[0, 4]), 0, 7, 9, 0, 0).unwrap();
        let fork_move = Move::place(1, None);
        let undo = fork.make_move(fork_move).unwrap();
        assert_eq!(
            executable_mill_targets(&fork, Player::White),
            (1 << 2) | (1 << 7)
        );
        assert!(placement_move_is_tactical(
            &fork,
            fork_move,
            Player::White,
            0
        ));
        fork.undo_move(undo);
    }

    #[test]
    fn replay_position_search_is_legal_and_color_symmetric() {
        let original = Position::from_parts(0x60_0003, 0x88_0094, 5, 4, 0, 0).unwrap();
        let swapped = Position::from_parts(0x88_0094, 0x60_0003, 4, 5, 1, 0).unwrap();
        let limits = SearchLimits {
            time_ms: 0,
            max_depth: 2,
            node_limit: 0,
            top_n: 1,
            finish_placement: false,
            placement_verification_depth: 0,
        };

        let original_result = Engine::new(1).search(&original, limits);
        let swapped_result = Engine::new(1).search(&swapped, limits);
        let original_move = original_result.best_move().unwrap();
        let swapped_move = swapped_result.best_move().unwrap();

        assert!(original.legal_moves().as_slice().contains(&original_move));
        assert!(swapped.legal_moves().as_slice().contains(&swapped_move));
        assert_eq!(original_result.score, swapped_result.score);
        assert_eq!(original_move, swapped_move);
    }

    #[test]
    fn movement_tt_key_contains_the_complete_history_context() {
        let position = Position::from_parts(
            mask(&[0, 3, 6, 10]),
            mask(&[2, 5, 8, 13]),
            0,
            0,
            0,
            0,
        )
        .unwrap();
        let limits = SearchLimits {
            time_ms: 0,
            max_depth: 2,
            node_limit: 0,
            top_n: 1,
            finish_placement: false,
            placement_verification_depth: 0,
        };
        let key_with_history_a = {
            let mut tt = TranspositionTable::new(1);
            let state = SearchState::new(
                &mut tt,
                None,
                Rules::default(),
                limits,
                &position,
                &[0x1111, 0x2222],
            );
            state.tt_context(&position, false).key
        };
        let key_with_history_b = {
            let mut tt = TranspositionTable::new(1);
            let state = SearchState::new(
                &mut tt,
                None,
                Rules::default(),
                limits,
                &position,
                &[0x1111, 0x3333],
            );
            state.tt_context(&position, false).key
        };
        assert_ne!(key_with_history_a, key_with_history_b);
    }

    #[test]
    fn changing_rules_or_tablebase_clears_cached_bounds() {
        let mut engine = Engine::new(1);
        engine.search(
            &Position::standard(),
            SearchLimits {
                time_ms: 0,
                max_depth: 2,
                node_limit: 0,
                top_n: 1,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert!(engine.tt.occupied() > 0);
        engine.set_rules(Rules {
            repetitions_for_draw: 4,
            plies_without_capture_for_draw: Some(100),
        });
        assert_eq!(engine.tt.occupied(), 0);

        engine.search(
            &Position::standard(),
            SearchLimits {
                time_ms: 0,
                max_depth: 2,
                node_limit: 0,
                top_n: 1,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert!(engine.tt.occupied() > 0);
        engine.set_tablebase(None);
        assert_eq!(engine.tt.occupied(), 0);
    }

    #[test]
    fn multipv_candidates_have_exact_full_window_scores_and_sorted_pvs() {
        let position = Position::from_parts(
            mask(&[0, 2, 4, 6, 8, 10, 12, 14]),
            mask(&[1, 3, 5, 7, 9, 11, 13, 15]),
            1,
            1,
            0,
            0,
        )
        .unwrap();
        let depth = 2;
        let mut exact_scores = Vec::new();
        for &mv in position.legal_moves().as_slice() {
            let mut tt = TranspositionTable::new(1);
            let mut state = SearchState::new(
                &mut tt,
                None,
                Rules::default(),
                SearchLimits {
                    time_ms: 0,
                    max_depth: depth,
                    node_limit: 0,
                    top_n: 1,
                    finish_placement: false,
                    placement_verification_depth: 0,
                },
                &position,
                &[],
            );
            let mut child = position;
            child.make_move_unchecked(mv);
            state.push_path_key(child.repetition_key());
            let score = -state.search_node(&mut child, depth as i16 - 1, -INF, INF, 1);
            exact_scores.push((mv, score));
        }
        exact_scores.sort_by(|left, right| right.1.cmp(&left.1));

        let mut engine = Engine::new(1);
        let result = engine.search(
            &position,
            SearchLimits {
                time_ms: 0,
                max_depth: depth,
                node_limit: 0,
                top_n: 3,
                finish_placement: false,
                placement_verification_depth: 0,
            },
        );
        assert_eq!(result.candidates.len(), 3);
        assert!(result
            .candidates
            .windows(2)
            .all(|pair| pair[0].score >= pair[1].score));
        let third_best_score = exact_scores[2].1;
        for candidate in &result.candidates {
            let exact = exact_scores
                .iter()
                .find(|(mv, _)| *mv == candidate.mv)
                .unwrap()
                .1;
            assert_eq!(candidate.score, exact);
            assert!(candidate.score >= third_best_score);
            assert_eq!(candidate.pv.first(), Some(&candidate.mv));
            assert!(candidate.pv.len() >= depth as usize);
        }
    }

    #[test]
    fn canonical_tt_best_move_round_trips_across_all_symmetries() {
        let position =
            Position::from_parts(mask(&[0, 1]), mask(&[3, 4, 5, 9]), 7, 5, 0, 0).unwrap();
        let limits = SearchLimits {
            time_ms: 0,
            max_depth: 3,
            node_limit: 0,
            top_n: 1,
            finish_placement: false,
            placement_verification_depth: 0,
        };
        let mut engine = Engine::new(2);
        let original = engine.search(&position, limits).best_move().unwrap();
        assert_eq!(original.to(), 2);
        assert_eq!(original.capture(), Some(9));

        for symmetry in 0..16 {
            let transformed = position.transformed(symmetry).unwrap();
            let result = engine.search(&transformed, limits);
            assert_eq!(result.best_move(), original.transformed(symmetry));
        }
    }

    struct FixedTablebase {
        hit: TablebaseHit,
    }

    impl Tablebase for FixedTablebase {
        fn probe(&self, _position: &Position) -> Option<TablebaseHit> {
            Some(self.hit)
        }
    }

    #[test]
    fn tablebase_distance_includes_current_search_ply() {
        let position = Position::from_parts(
            mask(&[0, 1, 9]),
            mask(&[3, 4, 5]),
            0,
            0,
            0,
            0,
        )
        .unwrap();
        let tablebase = FixedTablebase {
            hit: TablebaseHit {
                wdl: Wdl::Loss,
                dtw: 5,
            },
        };
        let mut tt = TranspositionTable::new(1);
        let state = SearchState::new(
            &mut tt,
            Some(&tablebase),
            Rules::default(),
            SearchLimits {
                time_ms: 0,
                max_depth: 1,
                node_limit: 0,
                top_n: 1,
                finish_placement: false,
                placement_verification_depth: 0,
            },
            &position,
            &[],
        );
        assert_eq!(state.probe_tablebase(&position, 7), Some(-TABLEBASE_SCORE + 12));
    }
}
