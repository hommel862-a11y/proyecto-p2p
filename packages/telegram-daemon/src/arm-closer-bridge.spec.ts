import { describe, it, expect, vi } from 'vitest';
import {
  handleTelegramCloserCommand,
  buildTelegramPreCallBriefingCard,
} from './arm-closer-bridge';

describe('Telegram Daemon ARM Closer Co-Pilot Bridge', () => {
  it('parses /closer command with workspace isolation, generates split quote proposal, and forwards to gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, outboxEventId: 77 }),
    });

    const res = await handleTelegramCloserCommand({
      rawText: '/closer ARM_B2B Carlos — Clínica Aurora | Quiere Plan Enterprise en 2 partes 50/50',
      gatewayUrl: 'http://127.0.0.1:3030',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(res.handled).toBe(true);
    expect(res.workspaceId).toBe('ARM_B2B');
    expect(res.detectedSplitPayment).toBe(true);
    expect(res.gatewaySynced).toBe(true);
    expect(res.replyMarkdown).toContain('Approval Queue');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated non-/closer messages gracefully', async () => {
    const res = await handleTelegramCloserCommand({
      rawText: '/status',
      gatewayUrl: 'http://127.0.0.1:3030',
    });
    expect(res.handled).toBe(false);
  });

  it('builds 15m Pre-Call Executive Closer Briefing Markdown card isolated by workspace', () => {
    const briefing = buildTelegramPreCallBriefingCard({
      workspaceId: 'FINANCE_360',
      leadName: 'Ana Pérez',
      companyName: 'Distribuidora Sol C.A.',
      startsInMinutes: 15,
      qualificationScore: 88,
      bantData: {
        budget: '$1,850 USD',
        authority: 'Gerente General',
        need_pain_point: 'Pago 50/50',
        timeline: 'Esta semana',
      },
      memoryFacts: ['Usa facturación quincenal'],
      estimatedDealValue: 1850,
    });

    expect(briefing.workspaceId).toBe('FINANCE_360');
    expect(briefing.telegramMarkdownPayload).toContain('FINANCE_360');
    expect(briefing.telegramMarkdownPayload).toContain('Distribuidora Sol C.A.');
  });
});
