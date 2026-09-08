import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Structural wrapper around the `.terminal-card-header` chrome.
 * Renders the title group (optional `icon` text and `title`) plus projected
 * `[uiHeaderContent]` and `[uiHeaderActions]` slots. All classes are the global
 * ones from src/styles.scss — no local styles.
 */
@Component({
  selector: 'app-ui-panel-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terminal-card-header">
      <div class="card-header-title">
        @if (icon(); as i) {
          <span class="card-icon">{{ i }}</span>
        }
        @if (title(); as t) {
          <span class="card-title">{{ t }}</span>
        }
        <ng-content select="[uiHeaderContent]" />
      </div>
      <ng-content select="[uiHeaderActions]" />
    </div>
  `,
})
export class UiPanelHeader {
  readonly icon = input<string>();
  readonly title = input<string>();
}
