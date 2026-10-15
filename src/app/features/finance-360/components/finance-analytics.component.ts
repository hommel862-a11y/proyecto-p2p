import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Finance360Service } from '../../../core/finance-360.service';
import {
  FinanceForecasterService,
  type BurnRateAndRunway,
  type DayHeatmapItem,
  type CategoryBreakdownItem,
  type CfoInsightCard,
} from '../../../core/services/finance-forecaster.service';

@Component({
  selector: 'app-finance-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './finance-analytics.component.html',
  styleUrls: ['./finance-analytics.component.scss'],
})
export class FinanceAnalyticsComponent {
  private readonly financeService = inject(Finance360Service);
  private readonly forecaster = inject(FinanceForecasterService);

  readonly selectedHorizon = signal<'day' | 'week' | 'month' | 'quarter'>('month');

  readonly burnRate = computed<BurnRateAndRunway>(() => {
    const expenses = this.financeService.expenses();
    const liquidAssets = this.financeService.totalAssetsUsd();
    return this.forecaster.calculateBurnRateAndRunway(expenses, liquidAssets);
  });

  readonly weeklyHeatmap = computed<DayHeatmapItem[]>(() => {
    return this.forecaster.generateWeeklyHeatmap(this.financeService.expenses());
  });

  readonly categoryBreakdown = computed<CategoryBreakdownItem[]>(() => {
    const expenses = this.financeService.expenses();
    const bcv = this.financeService.currentBcvRate();
    return this.forecaster.generateMonthlyCategoryBreakdown(expenses, bcv);
  });

  readonly cfoInsights = computed<CfoInsightCard[]>(() => {
    return this.forecaster.generateCfoInsights(
      this.financeService.assets(),
      this.financeService.liabilities(),
      this.financeService.incomes(),
      this.financeService.expenses(),
      this.financeService.currentBcvRate(),
    );
  });
}
