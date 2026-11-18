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
});
