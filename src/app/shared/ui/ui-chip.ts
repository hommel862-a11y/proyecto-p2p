import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const CHIP_VARIANT = {
  BUY: 'buy',
  SELL: 'sell',
  ACCENT: 'accent',
  GOLD: 'gold',
  MUTED: 'muted',
} as const;

type UiChipVariant = (typeof CHIP_VARIANT)[keyof typeof CHIP_VARIANT];

/**
 * Thin wrapper around the global `.badge` / `.badge-*` chrome. The `variant` input
 * picks which badge modifier class is applied; content is projected verbatim.
 */
@Component({
  selector: 'app-ui-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class.badge]': 'true',
    '[class.badge-buy]': "variant() === 'buy'",
    '[class.badge-sell]': "variant() === 'sell'",
    '[class.badge-accent]': "variant() === 'accent'",
    '[class.badge-gold]': "variant() === 'gold'",
    '[class.badge-muted]': "variant() === 'muted'",
  },
})
export class UiChip {
  readonly variant = input<UiChipVariant>(CHIP_VARIANT.MUTED);
}
