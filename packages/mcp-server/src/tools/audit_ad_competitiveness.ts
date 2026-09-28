import {
  AuditAdCompetitivenessInputSchema,
  type AuditAdCompetitivenessInput,
} from '../schemas/index.js';

export const auditAdCompetitivenessTool = {
  name: 'audit_ad_competitiveness',
  description:
    'Audita la posición competitiva real de un anuncio en el libro de órdenes, detecta si fue superado (undercutting), evalúa liquidez fantasma y calcula la brecha de precio exacta respecto al rango objetivo.',
  inputSchema: AuditAdCompetitivenessInputSchema,
  execute: (input: AuditAdCompetitivenessInput) => {
    const { adId, myCurrentPrice, side, competitors, desiredRank } = input;

    // Filter valid competitors
    const sorted = [...competitors].sort((a, b) =>
      side === 'BUY' ? b.price - a.price : a.price - b.price,
    );

    // Find current rank of my price
    let currentRank = 1;
    for (const c of sorted) {
      if (side === 'BUY' && c.price > myCurrentPrice) {
        currentRank++;
      } else if (side === 'SELL' && c.price < myCurrentPrice) {
        currentRank++;
      }
    }

    const desiredRankIndex = desiredRank === 'TOP_1' ? 1 : desiredRank === 'TOP_2' ? 2 : 3;
    const isMeetingTargetRank = currentRank <= desiredRankIndex;

    const topCompetitor = sorted[0];
    const priceGapWithTop = topCompetitor ? Number((myCurrentPrice - topCompetitor.price).toFixed(2)) : 0;

    // Identify suspicious competitors
    const suspiciousCompetitors = competitors.filter(
      (c) => (c.finishRatePct ?? 100) < 85 || (c.maxLimitVes ?? 10000) < 2000,
    );

    return {
      adId,
      myCurrentPrice,
      side,
      currentRank: `TOP_${currentRank}`,
      desiredRank,
      isMeetingTargetRank,
      totalCompetitorsAnalyzed: competitors.length,
      suspiciousCompetitorsCount: suspiciousCompetitors.length,
      priceGapWithLeader: priceGapWithTop,
      leaderPrice: topCompetitor?.price ?? null,
      leaderMerchant: topCompetitor?.merchantName ?? 'N/A',
      assessment: isMeetingTargetRank
        ? `Posición competitiva saludable (${currentRank} <= ${desiredRankIndex}).`
        : `Anuncio desplazado al puesto ${currentRank}. Se recomienda reajustar para recuperar el ${desiredRank}.`,
      timestamp: new Date().toISOString(),
    };
  },
};
