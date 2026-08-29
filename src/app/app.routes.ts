import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'spread' },
  {
    path: 'spread',
    title: 'Spread Monitor',
    loadComponent: () =>
      import('./features/spread-monitor/spread-monitor').then((m) => m.SpreadMonitor),
  },
  {
    path: 'income',
    title: 'Income Calculator',
    loadComponent: () =>
      import('./features/income-calculator/income-calculator').then((m) => m.IncomeCalculator),
  },
  {
    path: 'log',
    title: 'Operation Log',
    loadComponent: () =>
      import('./features/operation-log/operation-log').then((m) => m.OperationLog),
  },
  {
    path: 'risk',
    title: 'Risk Rules',
    loadComponent: () =>
      import('./features/risk-rules/risk-rules').then((m) => m.RiskRules),
  },
];
