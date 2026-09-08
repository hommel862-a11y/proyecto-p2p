import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Thin structural wrapper that projects the `.toolbar-segmented` chrome onto its
 * host element. The segmented buttons are passed via content projection.
 */
@Component({
  selector: 'app-ui-toolbar-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: { class: 'toolbar-segmented' },
})
export class UiToolbarSegmented {}
