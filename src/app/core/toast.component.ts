import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, type ToastMessage } from './toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast.component.html',
})
export class ToastComponent {
  protected readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.toasts;

  dismiss(toast: ToastMessage): void {
    this.toastService.dismiss(toast.id);
  }
}
