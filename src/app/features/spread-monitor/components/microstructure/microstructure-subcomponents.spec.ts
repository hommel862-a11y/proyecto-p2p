import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { BinanceOfferSummary, OtcWhaleReport } from '@p2p/core';
import type { EnrichedMicrostructureOffer } from '../../../../core/microstructure-engine.service';
import { VOLATILITY_SOURCE, type LiveSpreadQualityResult } from '../../../../core/spread-quality.service';
import { MicrostructureAuditTableComponent } from './microstructure-audit-table.component';
import { MicrostructureKpiStripComponent } from './microstructure-kpi-strip.component';
import { MicrostructureOrderbookLadderComponent } from './microstructure-orderbook-ladder.component';
import { MicrostructureQuantAdvisorComponent } from './microstructure-quant-advisor.component';

function makeEnriched(
  overrides: Partial<EnrichedMicrostructureOffer> & { advNo: string; price: number; side: 'BUY' | 'SELL' },
): EnrichedMicrostructureOffer {
  const offer: BinanceOfferSummary = {
    advNo: overrides.advNo,
    price: overrides.price,
    merchantName: overrides.offer?.merchantName ?? `Merchant_${overrides.advNo}`,
    finishRatePct: overrides.offer?.finishRatePct ?? 98,
    orderCount: overrides.offer?.orderCount ?? 200,
    minVes: overrides.offer?.minVes ?? 10_000,
    maxVes: overrides.offer?.maxVes ?? 200_000,
    payMethods: ['Banesco'],
  };
  return {
    offer,
    side: overrides.side,
    deltaPrice: overrides.deltaPrice ?? 0,
    isNew: overrides.isNew ?? false,
    flashDirection: overrides.flashDirection ?? null,
    counterpartyReputation: overrides.counterpartyReputation ?? 'UNKNOWN',
    isTrusted: overrides.isTrusted ?? false,
    isVerifiedCounterparty: overrides.isVerifiedCounterparty ?? false,
    isBlockedCounterparty: overrides.isBlockedCounterparty ?? false,
    isVerifiedPro: overrides.isVerifiedPro ?? true,
    spoofCategory: overrides.spoofCategory ?? 'LEGITIMATE',
    lifespanSeconds: overrides.lifespanSeconds ?? 12,
    estimatedUsdt: Number((offer.maxVes / offer.price).toFixed(2)),
  };
}

describe('Microstructure Modular Subcomponents (S1, S3)', () => {
  it('MicrostructureKpiStripComponent clamps SQS score and distinguishes MEASURED vs Ref volatility', () => {
    const fixture: ComponentFixture<MicrostructureKpiStripComponent> = TestBed.createComponent(
      MicrostructureKpiStripComponent,
    );
    const sqs: LiveSpreadQualityResult = {
      score: 135,
      verdict: 'OPTIMAL',
      verdictTone: 'optimal',
      verdictLabel: 'Óptimo',
      verdictColor: '#2fd08f',
      nominalSpreadPct: 1.8,
      netSpreadPct: 1.45,
      safetyCorridorPct: 0.9,
      factors: { netMarginScore: 92, safetyScore: 88, velocityScore: 95, limitHealthScore: 80 },
      weakestFactor: 'limitHealth',
      causalHint: 'Vigila consumo diario SUDEBAN.',
      recommendation: 'Operar Maker.',
      volatility4hPct: 0.42,
      volatilitySource: VOLATILITY_SOURCE.MEASURED,
      accountUsagePct: 35,
      bankCode: 'BANESCO',
      isInterbank: false,
    };

    fixture.componentRef.setInput('sqsResult', sqs);
    fixture.detectChanges();

    expect(fixture.componentInstance.clampedSqsScore()).toBe(100);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Medida');
    expect(el.textContent).toContain('0.42%');
  });

  it('MicrostructureOrderbookLadderComponent renders spoof strike/badge, tick flash classes, and focus What-If', () => {
    const fixture = TestBed.createComponent(MicrostructureOrderbookLadderComponent);
    const hoverSpy = vi.fn();
    fixture.componentInstance.hoverPreview.subscribe(hoverSpy);

    const sellRows = [
      makeEnriched({
        advNo: 'S_SPOOF',
        side: 'SELL',
        price: 890,
        spoofCategory: 'SPOOF_BAIT',
        lifespanSeconds: 6,
        flashDirection: 'up',
        deltaPrice: 2.5,
      }),
      makeEnriched({
        advNo: 'S_NEW',
        side: 'SELL',
        price: 868,
        isNew: true,
        flashDirection: 'new',
        counterpartyReputation: 'TRUSTED',
        isTrusted: true,
      }),
    ];

    fixture.componentRef.setInput('sellOffers', sellRows);
    fixture.componentRef.setInput('cleanModeEnabled', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const purgedRow = el.querySelector('.dom-row.is-purged');
    expect(purgedRow).toBeTruthy();
    expect(purgedRow?.textContent).toContain('SPOOF PURGADO');
    expect(purgedRow?.textContent).toContain('6s');
    expect(purgedRow?.classList.contains('tick-flash-up')).toBe(true);

    const newRow = el.querySelector('.dom-row.tick-flash-new') as HTMLElement | null;
    expect(newRow).toBeTruthy();
    newRow?.dispatchEvent(new FocusEvent('focusin'));
    fixture.detectChanges();
    expect(hoverSpy).toHaveBeenCalled();

    newRow?.dispatchEvent(new FocusEvent('focusout'));
    fixture.detectChanges();
    expect(hoverSpy).toHaveBeenLastCalledWith(null);
  });

  it('MicrostructureQuantAdvisorComponent supports keyboard tab navigation and highlights weakest SQS factor', () => {
    const fixture = TestBed.createComponent(MicrostructureQuantAdvisorComponent);
    const sqs: LiveSpreadQualityResult = {
      score: 74,
      verdict: 'HEALTHY',
      verdictTone: 'healthy',
      verdictLabel: 'Saludable',
      verdictColor: '#5aa7ff',
      nominalSpreadPct: 1.2,
      netSpreadPct: 0.9,
      safetyCorridorPct: 0.7,
      factors: { netMarginScore: 85, safetyScore: 52, velocityScore: 90, limitHealthScore: 88 },
      weakestFactor: 'safety',
      causalHint: 'Volatilidad intradía elevada.',
      recommendation: 'Ampliar colchón Maker.',
      volatility4hPct: 1.1,
      volatilitySource: VOLATILITY_SOURCE.MEASURED,
      accountUsagePct: 22,
      bankCode: 'BANESCO',
      isInterbank: false,
    };

    fixture.componentRef.setInput('sqsResult', sqs);
    fixture.componentRef.setInput('refRate', 860);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const weakestRow = el.querySelector('.factor-row.is-weakest');
    expect(weakestRow?.textContent).toContain('Seguridad Vol');
    expect(el.textContent).toContain('Volatilidad intradía elevada.');

    const firstTab = el.querySelector('[role="tab"]') as HTMLButtonElement;
    firstTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('SLIPPAGE');

    firstTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('DEPTH');
  });

  it('MicrostructureAuditTableComponent filters rows accurately and avoids fallback 70 or escaped dollar', () => {
    const fixture = TestBed.createComponent(MicrostructureAuditTableComponent);
    const rows = [
      makeEnriched({ advNo: 'A_LEGIT', side: 'SELL', price: 868, spoofCategory: 'LEGITIMATE' }),
      makeEnriched({
        advNo: 'A_PURGED',
        side: 'SELL',
        price: 890,
        spoofCategory: 'PHANTOM_LIQUIDITY',
        lifespanSeconds: 15,
      }),
      makeEnriched({
        advNo: 'A_WHALE',
        side: 'SELL',
        price: 870,
        offer: {
          advNo: 'A_WHALE',
          price: 870,
          merchantName: 'OTC_Desk_VE',
          finishRatePct: 99,
          orderCount: 900,
          minVes: 1_000_000,
          maxVes: 120_000_000,
          payMethods: ['Banesco'],
        },
      }),
    ];
    const whaleReport: OtcWhaleReport = {
      whaleDetected: true,
      totalWhaleVolumeUsd: 139_535,
      whaleBlocks: [
        {
          advNo: 'A_WHALE',
          merchantName: 'OTC_Desk_VE',
          price: 870,
          volumeVes: 120_000_000,
          estimatedVolumeUsd: 139_535,
          shareOfTopDepthPct: 80,
        },
      ],
      recommendedAction: 'ANTICIPATE_PRICE_SURGE',
      rationale: 'Absorción institucional detectada.',
    };

    fixture.componentRef.setInput('enrichedSellOffers', rows);
    fixture.componentRef.setInput('selectedSide', 'SELL');
    fixture.componentRef.setInput('refRate', 860);
    fixture.componentRef.setInput('otcWhaleReport', whaleReport);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('\\$');

    const filterBtns = Array.from(el.querySelectorAll('.filter-pill')) as HTMLButtonElement[];
    const purgedBtn = filterBtns.find((b) => b.textContent?.includes('Purgados'));
    const whalesBtn = filterBtns.find((b) => b.textContent?.includes('Ballenas'));

    purgedBtn?.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.textContent).toContain('FANTASMA');

    whalesBtn?.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.textContent).toContain('BALLENA OTC');
  });
});
