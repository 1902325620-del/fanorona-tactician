import type { Player } from "./fanorona";

export type PieceTone = "light" | "dark";

/** The side moving first uses the light pieces shown by the game UI. */
export function pieceToneFor(player: Player, firstPlayer: Player): PieceTone {
  return player === firstPlayer ? "light" : "dark";
}
