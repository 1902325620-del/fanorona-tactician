use std::env;
use std::process::ExitCode;
use std::time::Instant;

use morris_engine::{Engine, Player, Position, SearchLimits};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            print_usage();
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match arguments.first().map(String::as_str) {
        Some("perft") => {
            let depth = parse_or(arguments.get(1), 4_u8)?;
            let mut position = Position::standard();
            let started = Instant::now();
            let nodes = position.perft(depth);
            let elapsed = started.elapsed().as_secs_f64();
            println!(
                "perft depth={depth} nodes={nodes} elapsed={elapsed:.3}s nps={:.0}",
                nodes as f64 / elapsed.max(0.000_001)
            );
        }
        Some("divide") => {
            let depth = parse_or(arguments.get(1), 3_u8)?;
            if depth == 0 {
                return Err("divide depth must be at least one".into());
            }
            let mut position = Position::standard();
            let moves = position.legal_moves();
            let mut total = 0;
            for &mv in moves.as_slice() {
                let undo = position.make_move(mv).map_err(|error| error.to_string())?;
                let nodes = position.perft(depth - 1);
                position.undo_move(undo);
                println!("{mv}: {nodes}");
                total += nodes;
            }
            println!("total: {total}");
        }
        Some("bench") => {
            let time_ms = parse_or(arguments.get(1), 2_000_u64)?;
            let depth = parse_or(arguments.get(2), 64_u8)?;
            search(Position::standard(), time_ms, depth, 3);
        }
        Some("placement-bench") => {
            let time_ms = parse_or(arguments.get(1), 2_000_u64)?;
            let verification_depth = parse_or(arguments.get(2), 4_u8)?;
            placement_bench(time_ms, verification_depth);
        }
        Some("search") => {
            let position = if arguments.len() >= 6 {
                parse_position(&arguments[1..6])?
            } else {
                Position::standard()
            };
            let time_ms = parse_or(arguments.get(6), 2_000_u64)?;
            let depth = parse_or(arguments.get(7), 64_u8)?;
            let top_n = parse_or(arguments.get(8), 3_u8)?;
            search(position, time_ms, depth, top_n);
        }
        _ => return Err("unknown or missing command".into()),
    }
    Ok(())
}

fn search(position: Position, time_ms: u64, depth: u8, top_n: u8) {
    let mut engine = Engine::default();
    let result = engine.search(
        &position,
        SearchLimits {
            time_ms,
            max_depth: depth,
            node_limit: 0,
            top_n,
            finish_placement: true,
            placement_verification_depth: 4,
        },
    );
    println!(
        "depth={} score={} nodes={} leaves={} nps={} tt_hits={} symmetry_tt_hits={} placement_complete={} placement_target={} completed={} timed_out={}",
        result.depth,
        result.score,
        result.nodes,
        result.leaves,
        result.nps,
        result.tt_hits,
        result.symmetry_tt_hits,
        result.placement_complete,
        result.placement_target_depth,
        result.completed,
        result.timed_out
    );
    for (index, candidate) in result.candidates.iter().enumerate() {
        let pv = candidate
            .pv
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        println!("{}. {} score={} pv={pv}", index + 1, candidate.mv, candidate.score);
    }
}

fn placement_bench(time_ms: u64, verification_depth: u8) {
    let position = Position::standard();
    let mut engine = Engine::default();
    let result = engine.search(
        &position,
        SearchLimits {
            time_ms,
            max_depth: 1,
            node_limit: 0,
            top_n: 3,
            finish_placement: true,
            placement_verification_depth: verification_depth,
        },
    );
    println!(
        "placement_complete={} target_depth={} completed_depth={} frontier_leaves={} leaves={} nodes={} nps={} tt_hits={} symmetry_tt_hits={} timed_out={}",
        result.placement_complete,
        result.placement_target_depth,
        result.depth,
        result.placement_frontier_leaves,
        result.leaves,
        result.nodes,
        result.nps,
        result.tt_hits,
        result.symmetry_tt_hits,
        result.timed_out
    );
    for (index, candidate) in result.candidates.iter().enumerate() {
        println!("{}. {} score={}", index + 1, candidate.mv, candidate.score);
    }
}

fn parse_position(arguments: &[String]) -> Result<Position, String> {
    let white = parse_mask(&arguments[0])?;
    let black = parse_mask(&arguments[1])?;
    let white_reserve = arguments[2].parse::<u8>().map_err(|error| error.to_string())?;
    let black_reserve = arguments[3].parse::<u8>().map_err(|error| error.to_string())?;
    let side = match arguments[4].to_ascii_lowercase().as_str() {
        "0" | "w" | "white" => Player::White as u8,
        "1" | "b" | "black" => Player::Black as u8,
        _ => return Err("side must be white/0 or black/1".into()),
    };
    Position::from_parts(white, black, white_reserve, black_reserve, side, 0)
        .map_err(|error| error.to_string())
}

fn parse_mask(value: &str) -> Result<u32, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        u32::from_str_radix(hex, 16).map_err(|error| error.to_string())
    } else {
        value.parse::<u32>().map_err(|error| error.to_string())
    }
}

fn parse_or<T>(value: Option<&String>, default: T) -> Result<T, String>
where
    T: std::str::FromStr,
    T::Err: ToString,
{
    value.map_or(Ok(default), |value| {
        value.parse::<T>().map_err(|error| error.to_string())
    })
}

fn print_usage() {
    eprintln!(
        "usage:\n  morris-engine perft [depth]\n  morris-engine divide [depth]\n  morris-engine bench [time_ms] [max_depth]\n  morris-engine placement-bench [time_ms] [verification_depth]\n  morris-engine search [white_mask black_mask white_reserve black_reserve side] [time_ms] [max_depth] [top_n]"
    );
}
