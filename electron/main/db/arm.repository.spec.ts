import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ArmRepository } from './arm.repository';

describe('ArmRepository (SQLite Multi-Workspace Mirror)', () => {
  let db: DatabaseSync;
  let repo: ArmRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSql);
    repo = new ArmRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upserts and lists leads strictly isolated by workspace_id', () => {
    repo.upsertLead({
      id: 'lead-b2b-1',
      workspaceId: 'ARM_B2B',
      fullName: 'Dra. Elena Gómez',
      companyName: 'Clínica Aurora',
      phoneWhatsapp: '+584141234567',
      email: 'elena@clinicaaurora.com',
      currentStageSlug: 'calificado',
      assignedAgentRole: 'QUOTER',
      qualificationScore: 95,
      bantData: { budget: '$2,400 USD', authority: 'Directora', need_pain_point: 'CRM', timeline: 'Hoy' },
      aiExecutiveSummary: 'Clínica con 20 médicos',
      estimatedDealValue: 2400,
      currency: 'USD',
    });

    repo.upsertLead({
      id: 'lead-p2p-1',
      workspaceId: 'P2P_DESK',
      fullName: 'Carlos M.',
      companyName: 'Mesa Banesco',
      phoneWhatsapp: '+584149998877',
      email: null,
      currentStageSlug: 'STAGE_3_VERIFY',
      assignedAgentRole: 'QUOTER',
      qualificationScore: 90,
      bantData: { budget: '1,200 USDT', authority: 'Titular', need_pain_point: 'Liquidez', timeline: 'Inmediato' },
      aiExecutiveSummary: 'Comprobante Banesco recibido',
      estimatedDealValue: 1200,
      currency: 'USDT',
    });

    const b2bLeads = repo.listLeads('ARM_B2B');
    const p2pLeads = repo.listLeads('P2P_DESK');
    const f360Leads = repo.listLeads('FINANCE_360');

    expect(b2bLeads).toHaveLength(1);
    expect(b2bLeads[0].companyName).toBe('Clínica Aurora');
    expect(p2pLeads).toHaveLength(1);
    expect(p2pLeads[0].id).toBe('lead-p2p-1');
    expect(f360Leads).toHaveLength(0);
  });

  it('enforces idempotency_key in arm_approval_queue and resolves HITL with Shadow Learning recording', () => {
    repo.saveApproval({
      id: 'app-1',
      workspaceId: 'ARM_B2B',
      idempotencyKey: 'quote:ARM_B2B:lead-1:Q-001',
      leadId: 'lead-1',
      requestedByRole: 'QUOTER',
      toolName: 'create_or_submit_quote',
      actionType: 'APPLY_DISCOUNT',
      title: 'Descuento 20% Plan Enterprise',
      agentReasoning: 'Supera tope autónomo de 0%',
      riskRuleTriggered: 'MAX_DISCOUNT_EXCEEDED',
      proposedPayload: { proposedWhatsappMessage: 'Te damos 20% de descuento.' },
      status: 'PENDING',
    });

    // Duplicate idempotencyKey must not insert duplicate row
    repo.saveApproval({
      id: 'app-1-dup',
      workspaceId: 'ARM_B2B',
      idempotencyKey: 'quote:ARM_B2B:lead-1:Q-001',
      leadId: 'lead-1',
      requestedByRole: 'QUOTER',
      toolName: 'create_or_submit_quote',
      actionType: 'APPLY_DISCOUNT',
      title: 'Duplicado',
      agentReasoning: 'Duplicado',
      riskRuleTriggered: 'MAX_DISCOUNT_EXCEEDED',
      proposedPayload: { proposedWhatsappMessage: 'Dup' },
      status: 'PENDING',
    });

    expect(repo.listPendingApprovals('ARM_B2B')).toHaveLength(1);
    expect(repo.listPendingApprovals('P2P_DESK')).toHaveLength(0);

    const resolved = repo.resolveApproval({
      id: 'app-1',
      status: 'EDITED_AND_APPROVED',
      approvedText: 'Por acuerdo anual corporativo, dirección autorizó bonificación del 20%.',
      saveAsExample: true,
    });
    expect(resolved?.status).toBe('EDITED_AND_APPROVED');
    expect(repo.listPendingApprovals('ARM_B2B')).toHaveLength(0);

    const examples = repo.listShadowExamples('ARM_B2B', 'QUOTER');
    expect(examples).toHaveLength(1);
    expect(examples[0].approvedText).toContain('bonificación del 20%');
    expect(repo.listShadowExamples('P2P_DESK', 'QUOTER')).toHaveLength(0);
  });

  it('appends sequential outbox events and replays by cursor id cleanly', () => {
    const e1 = repo.appendOutboxEvent({
      workspaceId: 'ARM_B2B',
      eventType: 'pipeline_transition',
      aggregateId: 'lead-1',
      payload: { fromStageSlug: 'nuevo', toStageSlug: 'en-descubrimiento' },
    });
    const e2 = repo.appendOutboxEvent({
      workspaceId: 'ARM_B2B',
      eventType: 'approval_requested',
      aggregateId: 'app-2',
      payload: { priority: 'HIGH' },
    });

    expect(e2.id).toBeGreaterThan(e1.id);
    const replayed = repo.listOutboxSince(e1.id, 'ARM_B2B');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].aggregateId).toBe('app-2');
  });

  it('upserts and lists bank rails strictly isolated by workspace_id', () => {
    const first = repo.upsertBankRail({
      id: 'rail-banesco-1',
      workspaceId: 'P2P_DESK',
      bankName: 'Banesco',
      currency: 'VES',
      holderDetails: 'Titular Mesa P2P · J-12345678-0',
      currentBalanceFiat: 120000,
      maxDailyCapFiat: 500000,
      status: 'AVAILABLE',
      updatedAt: 1700000001000,
    });

    repo.upsertBankRail({
      id: 'rail-mercantil-360',
      workspaceId: 'FINANCE_360',
      bankName: 'Mercantil',
      currency: 'VES',
      holderDetails: 'Cuenta Finanzas 360',
      currentBalanceFiat: 45000,
      maxDailyCapFiat: 250000,
      status: 'AVAILABLE',
      updatedAt: 1700000002000,
    });

    expect(first.status).toBe('AVAILABLE');

    // Update existing bank rail without creating duplicates
    const updated = repo.upsertBankRail({
      id: 'rail-banesco-1',
      workspaceId: 'P2P_DESK',
      bankName: 'Banesco',
      currency: 'VES',
      holderDetails: 'Titular Mesa P2P · J-12345678-0',
      currentBalanceFiat: 185000,
      maxDailyCapFiat: 500000,
      status: 'SATURATED',
      updatedAt: 1700000003000,
    });
    expect(updated.currentBalanceFiat).toBe(185000);
    expect(updated.status).toBe('SATURATED');

    const p2pRails = repo.listBankRails('P2P_DESK');
    const f360Rails = repo.listBankRails('FINANCE_360');
    const b2bRails = repo.listBankRails('ARM_B2B');

    expect(p2pRails).toHaveLength(1);
    expect(p2pRails[0].currentBalanceFiat).toBe(185000);
    expect(p2pRails[0].status).toBe('SATURATED');
    expect(f360Rails).toHaveLength(1);
    expect(f360Rails[0].bankName).toBe('Mercantil');
    expect(b2bRails).toHaveLength(0);
  });

  it('records payment receipts with atomic UNIQUE anti-replay and workspace isolation', () => {
    const first = repo.recordPaymentReceipt({
      id: 'rcp-1',
      workspaceId: 'P2P_DESK',
      bankRailId: 'rail-banesco-1',
      referenceCode: '  88776655  ',
      amountFiat: 25000,
      dealId: 'DEAL-101',
      createdAt: 1700000010000,
    });
    expect(first).toEqual({ recorded: true, collision: false });

    // Replay same (workspace_id, bank_rail_id, reference_code) with different id and dealId
    const collision = repo.recordPaymentReceipt({
      id: 'rcp-2',
      workspaceId: 'P2P_DESK',
      bankRailId: 'rail-banesco-1',
      referenceCode: '88776655',
      amountFiat: 25000,
      dealId: 'DEAL-999',
      createdAt: 1700000020000,
    });
    expect(collision).toEqual({
      recorded: false,
      collision: true,
      existingDealId: 'DEAL-101',
    });

    // Different workspace with same bank_rail_id + reference_code must succeed (silo isolation)
    const otherWorkspace = repo.recordPaymentReceipt({
      id: 'rcp-3',
      workspaceId: 'FINANCE_360',
      bankRailId: 'rail-banesco-1',
      referenceCode: '88776655',
      amountFiat: 25000,
      dealId: null,
      createdAt: 1700000030000,
    });
    expect(otherWorkspace).toEqual({ recorded: true, collision: false });

    // Collision when existing row has null dealId returns existingDealId: null
    const nullDealCollision = repo.recordPaymentReceipt({
      id: 'rcp-4',
      workspaceId: 'FINANCE_360',
      bankRailId: 'rail-banesco-1',
      referenceCode: '88776655',
      amountFiat: 25000,
      dealId: 'DEAL-OTHER',
    });
    expect(nullDealCollision).toEqual({
      recorded: false,
      collision: true,
      existingDealId: null,
    });

    // Invalid workspace must fail closed (CHECK constraint) instead of returning collision
    expect(() =>
      repo.recordPaymentReceipt({
        id: 'rcp-invalid',
        workspaceId: 'UNKNOWN_SILO' as never,
        bankRailId: 'rail-banesco-1',
        referenceCode: '11223344',
        amountFiat: 100,
      }),
    ).toThrow();

    const p2pReceipts = repo.listPaymentReceipts('P2P_DESK', 10);
    expect(p2pReceipts).toHaveLength(1);
    expect(p2pReceipts[0].referenceCode).toBe('88776655');
    expect(p2pReceipts[0].dealId).toBe('DEAL-101');
  });

  it('records treasury settlements idempotently by idempotency_key', () => {
    const first = repo.recordTreasurySettlement({
      id: 'SETTLE-2026-11-18',
      sourceWorkspace: 'P2P_DESK',
      targetWorkspace: 'FINANCE_360',
      idempotencyKey: 'settle:P2P_DESK:FINANCE_360:2026-11-18',
      netProfitUsdt: 412.55,
      settlementDate: '2026-11-18',
      createdAt: 1700000050000,
    });

    expect(first.recorded).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.settlement.netProfitUsdt).toBe(412.55);

    const replay = repo.recordTreasurySettlement({
      id: 'SETTLE-2026-11-18-DUP',
      sourceWorkspace: 'P2P_DESK',
      targetWorkspace: 'FINANCE_360',
      idempotencyKey: 'settle:P2P_DESK:FINANCE_360:2026-11-18',
      netProfitUsdt: 999.99,
      settlementDate: '2026-11-18',
      createdAt: 1700000060000,
    });

    expect(replay.recorded).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.settlement.id).toBe('SETTLE-2026-11-18');
    expect(replay.settlement.netProfitUsdt).toBe(412.55);

    const countRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM arm_treasury_settlements')
      .get() as { cnt: number };
    expect(countRow.cnt).toBe(1);

    const settlements = repo.listTreasurySettlements('P2P_DESK');
    expect(settlements).toHaveLength(1);
    expect(settlements[0].idempotencyKey).toBe('settle:P2P_DESK:FINANCE_360:2026-11-18');
    expect(repo.listTreasurySettlements('FINANCE_360')).toHaveLength(0);
  });

  it('keeps schema.sql and database.ts fallback DDL identical for new ARM mirror tables', () => {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
    const databaseTs = fs.readFileSync(path.resolve(__dirname, 'database.ts'), 'utf8');

    const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    const startMarker = 'CREATE TABLE IF NOT EXISTS arm_bank_rails';
    const endMarker =
      'CREATE INDEX IF NOT EXISTS idx_arm_treasury_settlements_source_date ON arm_treasury_settlements(source_workspace, settlement_date DESC);';

    const schemaSlice = schemaSql.slice(
      schemaSql.indexOf(startMarker),
      schemaSql.indexOf(endMarker) + endMarker.length,
    );
    const dbSlice = databaseTs.slice(
      databaseTs.indexOf(startMarker),
      databaseTs.indexOf(endMarker) + endMarker.length,
    );

    expect(schemaSlice.length).toBeGreaterThan(0);
    expect(normalize(dbSlice)).toBe(normalize(schemaSlice));
  });
});
