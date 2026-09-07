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

/**
 * Which three cells actually won it — `tttWinner` says *who*, this says
 * *where*, and the finale needs where (spec §4): the three claimed boards that
 * form the line are what pulses before the result panel appears.
 *
 * The first line found, same order as `tttWinner` so the two can never
 * disagree about which win they are describing.
 */
export function tttWinningLine(
  cells: readonly TttCell[] | readonly TttMetaCell[],
): readonly [number, number, number] | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    const mark = cells[a] ?? null;
    if (mark !== null && mark !== 'draw' && mark === (cells[b] ?? null) && mark === (cells[c] ?? null)) return line;
  }
  return null;
}

export function tttFull(cells: readonly (TttCell | TttMetaCell)[]): boolean {
  return cells.every((cell) => cell !== null);
}
