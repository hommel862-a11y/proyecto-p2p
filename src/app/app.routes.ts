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
    path: 'triangulation',
    title: 'Triangulación Multidivisa',
    loadComponent: () =>
      import('./features/triangulation/triangulation').then((m) => m.Triangulation),
  },
  {
    path: 'copilot',
    title: 'Copiloto Estratega IA',
    loadComponent: () => import('./features/copilot/copilot').then((m) => m.Copilot),
  },

  {
    path: 'receipts',
    title: 'Comprobantes & OCR',
    loadComponent: () =>
      import('./features/receipt-scanner/receipt-scanner').then((m) => m.ReceiptScanner),
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
  {
    path: 'mcp',
    title: 'Centro de Servidores MCP',
    loadComponent: () => import('./features/mcp-hub/mcp-hub').then((m) => m.McpHub),
  },
];
