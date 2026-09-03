import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // HashLocationStrategy: la app carga también sobre file:// (útil para empaquetado Electron y APK sin server)
    provideRouter(routes, withHashLocation()),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
