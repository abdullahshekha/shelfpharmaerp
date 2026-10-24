/** Enter-key navigation in a grid of editable cells: next cell to the right, else the first cell of the next row, else null. */
export function nextGridCell<T>(cells: T[][], row: number, col: number): T | null {
  const r = cells[row]
  if (!r) return null
  if (col + 1 < r.length) return r[col + 1]
  for (let i = row + 1; i < cells.length; i++) {
    if (cells[i].length > 0) return cells[i][0]
  }
  return null
}
