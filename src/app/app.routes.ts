import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'Dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
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
    loadComponent: () => import('./features/risk-rules/risk-rules').then((m) => m.RiskRules),
  },
  {
    path: 'stats',
    title: 'Statistics',
    loadComponent: () => import('./features/stats/stats').then((m) => m.Stats),
  },
  {
    path: 'guide',
    title: 'Usage Guide',
    loadComponent: () => import('./features/guide/guide').then((m) => m.Guide),
  },
];
