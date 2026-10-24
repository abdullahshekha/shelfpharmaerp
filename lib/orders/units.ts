/** Units that physically leave stock for a line: the ordered quantity plus any free bonus units. */
export function totalUnits(item: { quantity: number; bonusQty?: number | null }): number {
  return item.quantity + Math.max(0, item.bonusQty ?? 0)
}
