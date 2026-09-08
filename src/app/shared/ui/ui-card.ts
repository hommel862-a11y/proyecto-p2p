import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const CARD_VARIANT = {
  TERMINAL: 'terminal',
  GROUP: 'group',
} as const;

type UiCardVariant = (typeof CARD_VARIANT)[keyof typeof CARD_VARIANT];

/**
 * Structural wrapper that projects the global card chrome onto its host element.
 * `terminal` reuses `.terminal-input-card`; `group` reuses `.section-group`.
 * No styles are defined here — the host classes come from src/styles.scss so the
 * visual output stays byte-identical whether a feature uses the component or the raw class.
 */
@Component({
  selector: 'app-ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class.terminal-input-card]': "variant() === 'terminal'",
    '[class.section-group]': "variant() === 'group'",
  },
})
export class UiCard {
  readonly variant = input<UiCardVariant>(CARD_VARIANT.TERMINAL);
}
