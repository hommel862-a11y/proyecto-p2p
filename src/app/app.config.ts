import {
  ApplicationConfig,
  ErrorHandler,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // HashLocationStrategy: la app carga también sobre file:// (útil para empaquetado Electron y APK sin server)
    provideRouter(routes, withHashLocation()),
    // En Electron, el Service Worker local sobre puerto efímero o file:// causa colapso
    // y fallos de carga al navegar entre módulos lazy-loaded. Solo se habilita en PWA web.
    provideServiceWorker('ngsw-worker.js', {
      enabled:
        !isDevMode() &&
        typeof window !== 'undefined' &&
        !(window as unknown as { electron?: unknown }).electron &&
        !navigator?.userAgent?.toLowerCase().includes('electron'),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
