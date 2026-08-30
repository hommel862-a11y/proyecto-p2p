import { Pipe, PipeTransform } from '@angular/core';

const vesFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

@Pipe({ name: 'ves', standalone: true })
export class VesPipe implements PipeTransform {
  transform(v: number): string {
    return `${vesFmt.format(safe(v))} Bs`;
  }
}

@Pipe({ name: 'usdt', standalone: true })
export class UsdtPipe implements PipeTransform {
  transform(v: number): string {
    return `${usdFmt.format(safe(v))} USDT`;
  }
}

@Pipe({ name: 'pct', standalone: true })
export class PctPipe implements PipeTransform {
  transform(v: number): string {
    return pctFmt.format(safe(v));
  }
}

@Pipe({ name: 'num', standalone: true })
export class NumPipe implements PipeTransform {
  transform(v: number, digits = 2): string {
    const d = Number.isFinite(digits) ? digits : 2;
    return numFmt(d).format(safe(v));
  }
}

/** Register all formatting pipes together in a component's `imports`. */
export const FORMAT_PIPES = [VesPipe, UsdtPipe, PctPipe, NumPipe];
