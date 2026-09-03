import { Pipe, PipeTransform } from '@angular/core';

const vesFmt = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdFmt = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pctFmt = new Intl.NumberFormat('es-VE', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numFmt = (d: number) =>
  new Intl.NumberFormat('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });

function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Format a bolívar (VES) amount as es-VE, e.g. `20.000,00 Bs`. */
export function fmtVes(v: number): string {
  return `${vesFmt.format(safe(v))} Bs`;
}

/** Format a USDT amount as es-VE, e.g. `25,00 USDT`. */
export function fmtUsd(v: number): string {
  return `${usdFmt.format(safe(v))} USDT`;
}

/** Format a percentage as es-VE, e.g. `1,50 %`. */
export function fmtPct(v: number): string {
  return pctFmt.format(safe(v));
}

/** Format a plain number as es-VE with up to `digits` decimals (default 2), e.g. `1.200`. */
export function fmtNum(v: number, digits = 2): string {
  const d = Number.isFinite(digits) ? digits : 2;
  return numFmt(d).format(safe(v));
}

@Pipe({ name: 'ves', standalone: true })
export class VesPipe implements PipeTransform {
  transform(v: number): string {
    return fmtVes(v);
  }
}

@Pipe({ name: 'usdt', standalone: true })
export class UsdtPipe implements PipeTransform {
  transform(v: number): string {
    return fmtUsd(v);
  }
}

@Pipe({ name: 'pct', standalone: true })
export class PctPipe implements PipeTransform {
  transform(v: number): string {
    return fmtPct(v);
  }
}

@Pipe({ name: 'num', standalone: true })
export class NumPipe implements PipeTransform {
  transform(v: number, digits = 2): string {
    return fmtNum(v, digits);
  }
}

/** Register all formatting pipes together in a component's `imports`. */
export const FORMAT_PIPES = [VesPipe, UsdtPipe, PctPipe, NumPipe];
