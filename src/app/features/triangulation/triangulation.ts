import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
  type TriangularRoutePreset,
  type ExchangeLeg,
  type TriangularArbitrageResult,
} from '@p2p/core';

@Component({
  selector: 'app-triangulation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './triangulation.html',
  styleUrls: ['./triangulation.scss'],
})
export class Triangulation {
  readonly presets = DEFAULT_TRIANGULAR_PRESETS;
  readonly selectedPresetId = signal<string>(this.presets[0].id);

  readonly initialAmount = signal<number>(10000);

  // Editable legs based on the active preset
  readonly activePreset = computed<TriangularRoutePreset>(() => {
    const found = this.presets.find((p) => p.id === this.selectedPresetId());
    return found ?? this.presets[0];
  });

  // Local state for the 3 legs to allow live what-if parameter tuning
  readonly leg1Price = signal<number>(this.presets[0].legs[0].price);
  readonly leg1Fee = signal<number>(this.presets[0].legs[0].feePct);

  readonly leg2Price = signal<number>(this.presets[0].legs[1].price);
  readonly leg2Fee = signal<number>(this.presets[0].legs[1].feePct);

  readonly leg3Price = signal<number>(this.presets[0].legs[2].price);
  readonly leg3Fee = signal<number>(this.presets[0].legs[2].feePct);

  onSelectPreset(presetId: string): void {
    this.selectedPresetId.set(presetId);
    const p = this.activePreset();
    this.leg1Price.set(p.legs[0].price);
    this.leg1Fee.set(p.legs[0].feePct);
    this.leg2Price.set(p.legs[1].price);
    this.leg2Fee.set(p.legs[1].feePct);
    this.leg3Price.set(p.legs[2].price);
    this.leg3Fee.set(p.legs[2].feePct);

    if (p.initialCurrency === 'USDT') {
      this.initialAmount.set(1000);
    } else {
      this.initialAmount.set(50000);
    }
  }

  readonly calculationResult = computed<TriangularArbitrageResult>(() => {
    const p = this.activePreset();

    const leg1: ExchangeLeg = {
      ...p.legs[0],
      price: Math.max(0.000001, this.leg1Price()),
      feePct: Math.max(0, this.leg1Fee()),
    };

    const leg2: ExchangeLeg = {
      ...p.legs[1],
      price: Math.max(0.000001, this.leg2Price()),
      feePct: Math.max(0, this.leg2Fee()),
    };

    const leg3: ExchangeLeg = {
      ...p.legs[2],
      price: Math.max(0.000001, this.leg3Price()),
      feePct: Math.max(0, this.leg3Fee()),
    };

    return calculateTriangularArbitrage(p.id, p.name, Math.max(0, this.initialAmount()), [
      leg1,
      leg2,
      leg3,
    ]);
  });
}
