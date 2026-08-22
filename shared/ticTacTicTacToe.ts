export type TttMark = 'x' | 'o';
export type TttCell = TttMark | null;
export type TttMetaCell = TttMark | 'draw' | null;

export const TTT_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function tttWinner(cells: readonly TttCell[] | readonly TttMetaCell[]): TttMark | null {
  for (const [a, b, c] of TTT_LINES) {
    const mark = cells[a] ?? null;
    if (mark !== null && mark !== 'draw' && mark === (cells[b] ?? null) && mark === (cells[c] ?? null)) return mark;
  }
  return null;
}

export function tttFull(cells: readonly (TttCell | TttMetaCell)[]): boolean {
  return cells.every((cell) => cell !== null);
}
