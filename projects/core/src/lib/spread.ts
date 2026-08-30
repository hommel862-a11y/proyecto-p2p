/**
 * Pure P2P spread economics (framework-agnostic).
 * All values are synchronous and deterministic. No network, no Angular.
 */

export type AmountUnit = 'USDT' | 'EUR' | 'VES';

export interface SpreadResult {
  /** USDT the operator ends up holding after the round trip. */
  usdtReceived: number;
  /** VES received when the acquired USDT is sold at the sell price. */
  vesReceived: number;
  /** sellPrice - buyPrice, in VES/USDT. */
  unitSpread: number;
  /** profit (or loss) in VES = usdtReceived * unitSpread. */
  gainVes: number;
  /** VES after subtracting the optional seller commission. */
  netVesAfterCommission: number;
  /** profit in VES after subtracting the seller commission (gain − commission). */
  netGainVes: number;
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('El valor debe ser un número positivo');
  }
}

/**
 * @param buyPrice  observed buy price (VES per USDT)
 * @param sellPrice observed sell price (VES per USDT)
 * @param amount    size of the move, in `unit`
 * @param unit      whether `amount` is denominated in USDT or VES
 * @param commissionRate optional seller commission as a FRACTION (0..0.0035 = 0..0.35%)
 */
export function computeSpread(
  buyPrice: number,
  sellPrice: number,
  amount: number,
  unit: AmountUnit,
  commissionRate = 0,
): SpreadResult {
  assertPositive('buyPrice', buyPrice);
  assertPositive('sellPrice', sellPrice);
  assertPositive('amount', amount);
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 0.0035) {
    throw new Error('La comisión debe estar entre 0 y 0.35 (0.35%)');
  }

  const usdtReceived = unit === 'USDT' ? amount : amount / buyPrice;
  const vesReceived = usdtReceived * sellPrice;
  const unitSpread = sellPrice - buyPrice;
  const gainVes = usdtReceived * unitSpread;
  const netVesAfterCommission = vesReceived * (1 - commissionRate);
  const netGainVes = gainVes - vesReceived * commissionRate;

  return { usdtReceived, vesReceived, unitSpread, gainVes, netVesAfterCommission, netGainVes };
}
