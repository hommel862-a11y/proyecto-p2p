import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ARM_BANK_RAIL_STATUSES,
  type ArmWorkspaceCode,
  type ArmBankRailRecord,
  type ArmPaymentReceiptInput,
  type ArmPaymentReceiptRecord,
  type ArmPaymentReceiptRecordResult,
  type ArmTreasurySettlementInput,
  type ArmTreasurySettlementRecord,
  type ArmTreasurySettlementResult,
} from '../../shared/types';

export type {
  ArmWorkspaceCode,
  ArmBankRailRecord,
  ArmPaymentReceiptInput,
  ArmPaymentReceiptRecord,
  ArmPaymentReceiptRecordResult,
  ArmTreasurySettlementInput,
  ArmTreasurySettlementRecord,
  ArmTreasurySettlementResult,
};

export type ArmRepoWorkspaceId = ArmWorkspaceCode;

export interface ArmLeadRecord {
  id: string;
  workspaceId: ArmRepoWorkspaceId;
  fullName: string | null;
  companyName: string | null;
  phoneWhatsapp: string | null;
  email: string | null;
  currentStageSlug: string;
  assignedAgentRole: string | null;
  qualificationScore: number;
  bantData: {
    budget: string | null;
    authority: string | null;
    need_pain_point: string | null;
    timeline: string | null;
  };
  aiExecutiveSummary: string | null;
  estimatedDealValue: number;
  currency: string;
  updatedAt?: number;
}

export interface ArmApprovalRecord {
  id: string;
  workspaceId: ArmRepoWorkspaceId;
  idempotencyKey: string;
  leadId: string;
  requestedByRole: string;
  toolName: string;
  actionType: string;
  title: string;
  agentReasoning: string;
  riskRuleTriggered: string;
  proposedPayload: Record<string, unknown>;
  finalApprovedPayload?: Record<string, unknown> | null;
  saveAsExample?: boolean;
  status: 'PENDING' | 'APPROVED' | 'EDITED_AND_APPROVED' | 'REJECTED' | 'EXPIRED';
  createdAt?: number;
}

export interface ArmOutboxEventRecord {
  id: number;
  workspaceId: ArmRepoWorkspaceId;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface ArmShadowExampleRecord {
  id: string;
  workspaceId: ArmRepoWorkspaceId;
  agentRole: string;
  actionType: string;
  proposedText: string;
  approvedText: string;
  createdAt?: number;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`arm_repository: ${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isSqliteUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const errWithCode = err as Error & { errcode?: number };
  return (
    err.message.includes('UNIQUE constraint failed') ||
    errWithCode.errcode === 2067 ||
    errWithCode.errcode === 1555
  );
}

export class ArmRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsertLead(lead: ArmLeadRecord): ArmLeadRecord {
    const updatedAt = lead.updatedAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO arm_leads (
          id, workspace_id, full_name, company_name, phone_whatsapp, email,
          current_stage_slug, assigned_agent_role, qualification_score,
          bant_json, ai_executive_summary, estimated_deal_value, currency, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          full_name = COALESCE(excluded.full_name, arm_leads.full_name),
          company_name = COALESCE(excluded.company_name, arm_leads.company_name),
          phone_whatsapp = COALESCE(excluded.phone_whatsapp, arm_leads.phone_whatsapp),
          email = COALESCE(excluded.email, arm_leads.email),
          current_stage_slug = excluded.current_stage_slug,
          assigned_agent_role = excluded.assigned_agent_role,
          qualification_score = excluded.qualification_score,
          bant_json = excluded.bant_json,
          ai_executive_summary = excluded.ai_executive_summary,
          estimated_deal_value = excluded.estimated_deal_value,
          currency = excluded.currency,
          updated_at = excluded.updated_at`,
      )
      .run(
        lead.id,
        lead.workspaceId,
        lead.fullName,
        lead.companyName,
        lead.phoneWhatsapp,
        lead.email,
        lead.currentStageSlug,
        lead.assignedAgentRole,
        Math.max(0, Math.min(100, Math.round(lead.qualificationScore))),
        JSON.stringify(lead.bantData ?? {}),
        lead.aiExecutiveSummary ?? null,
        Number(lead.estimatedDealValue || 0),
        lead.currency || 'USD',
        updatedAt,
      );

    return { ...lead, updatedAt };
  }

  listLeads(workspaceId: ArmRepoWorkspaceId): ArmLeadRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM arm_leads WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(workspaceId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      fullName: r['full_name'] ? String(r['full_name']) : null,
      companyName: r['company_name'] ? String(r['company_name']) : null,
      phoneWhatsapp: r['phone_whatsapp'] ? String(r['phone_whatsapp']) : null,
      email: r['email'] ? String(r['email']) : null,
      currentStageSlug: String(r['current_stage_slug']),
      assignedAgentRole: r['assigned_agent_role'] ? String(r['assigned_agent_role']) : null,
      qualificationScore: Number(r['qualification_score'] ?? 0),
      bantData: safeParseJson(String(r['bant_json'] || '{}'), {
        budget: null,
        authority: null,
        need_pain_point: null,
        timeline: null,
      }),
      aiExecutiveSummary: r['ai_executive_summary'] ? String(r['ai_executive_summary']) : null,
      estimatedDealValue: Number(r['estimated_deal_value'] ?? 0),
      currency: String(r['currency'] || 'USD'),
      updatedAt: Number(r['updated_at'] ?? 0),
    }));
  }

  saveApproval(item: ArmApprovalRecord): ArmApprovalRecord {
    const createdAt = item.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO arm_approval_queue (
          id, workspace_id, idempotency_key, lead_id, requested_by_role,
          tool_name, action_type, title, agent_reasoning, risk_rule_triggered,
          proposed_payload_json, final_approved_payload_json, save_as_example, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        item.id,
        item.workspaceId,
        item.idempotencyKey,
        item.leadId,
        item.requestedByRole,
        item.toolName,
        item.actionType,
        item.title,
        item.agentReasoning,
        item.riskRuleTriggered,
        JSON.stringify(item.proposedPayload ?? {}),
        item.finalApprovedPayload ? JSON.stringify(item.finalApprovedPayload) : null,
        item.saveAsExample ? 1 : 0,
        item.status ?? 'PENDING',
        createdAt,
      );

    return { ...item, createdAt };
  }

  listPendingApprovals(workspaceId: ArmRepoWorkspaceId): ArmApprovalRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM arm_approval_queue
         WHERE workspace_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC`,
      )
      .all(workspaceId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapApprovalRow(r));
  }

  resolveApproval(params: {
    id: string;
    status: 'APPROVED' | 'EDITED_AND_APPROVED' | 'REJECTED';
    approvedText?: string;
    saveAsExample?: boolean;
  }): ArmApprovalRecord | null {
    const existing = this.db
      .prepare('SELECT * FROM arm_approval_queue WHERE id = ?')
      .get(params.id) as Record<string, unknown> | undefined;
    if (!existing) return null;

    const record = this.mapApprovalRow(existing);
    const proposedMsg =
      String(record.proposedPayload['proposedWhatsappMessage'] || record.proposedPayload['previewText'] || record.title);
    const finalMsg =
      params.approvedText && params.approvedText.trim().length > 0
        ? params.approvedText.trim()
        : proposedMsg;

    const finalPayload = {
      ...record.proposedPayload,
      approvedMessage: finalMsg,
    };

    const saveAsExample = Boolean(params.saveAsExample);

    this.db
      .prepare(
        `UPDATE arm_approval_queue
         SET status = ?, final_approved_payload_json = ?, save_as_example = ?
         WHERE id = ?`,
      )
      .run(params.status, JSON.stringify(finalPayload), saveAsExample ? 1 : 0, params.id);

    if (saveAsExample && finalMsg !== proposedMsg) {
      this.saveShadowExample({
        id: `shw-${Date.now()}-${params.id}`,
        workspaceId: record.workspaceId,
        agentRole: record.requestedByRole,
        actionType: record.actionType,
        proposedText: proposedMsg,
        approvedText: finalMsg,
      });
    }

    return {
      ...record,
      status: params.status,
      finalApprovedPayload: finalPayload,
      saveAsExample,
    };
  }

  appendOutboxEvent(params: {
    workspaceId: ArmRepoWorkspaceId;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): ArmOutboxEventRecord {
    const createdAt = Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO arm_outbox_events (workspace_id, event_type, aggregate_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.workspaceId,
        params.eventType,
        params.aggregateId,
        JSON.stringify(params.payload ?? {}),
        createdAt,
      );

    return {
      id: Number(res.lastInsertRowid),
      workspaceId: params.workspaceId,
      eventType: params.eventType,
      aggregateId: params.aggregateId,
      payload: params.payload,
      createdAt,
    };
  }

  listOutboxSince(sinceId: number, workspaceId?: ArmRepoWorkspaceId): ArmOutboxEventRecord[] {
    const sql = workspaceId
      ? 'SELECT * FROM arm_outbox_events WHERE id > ? AND workspace_id = ? ORDER BY id ASC'
      : 'SELECT * FROM arm_outbox_events WHERE id > ? ORDER BY id ASC';
    const rows = (
      workspaceId
        ? this.db.prepare(sql).all(sinceId, workspaceId)
        : this.db.prepare(sql).all(sinceId)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      eventType: String(r['event_type']),
      aggregateId: String(r['aggregate_id']),
      payload: safeParseJson<Record<string, unknown>>(String(r['payload_json'] || '{}'), {}),
      createdAt: Number(r['created_at']),
    }));
  }

  saveShadowExample(ex: ArmShadowExampleRecord): ArmShadowExampleRecord {
    const createdAt = ex.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO arm_shadow_examples (
          id, workspace_id, agent_role, action_type, proposed_text, approved_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ex.id,
        ex.workspaceId,
        ex.agentRole,
        ex.actionType,
        ex.proposedText,
        ex.approvedText,
        createdAt,
      );
    return { ...ex, createdAt };
  }

  listShadowExamples(
    workspaceId: ArmRepoWorkspaceId,
    agentRole?: string,
    limit = 10,
  ): ArmShadowExampleRecord[] {
    const rows = (
      agentRole
        ? this.db
            .prepare(
              `SELECT * FROM arm_shadow_examples
               WHERE workspace_id = ? AND agent_role = ?
               ORDER BY created_at DESC LIMIT ?`,
            )
            .all(workspaceId, agentRole, limit)
        : this.db
            .prepare(
              `SELECT * FROM arm_shadow_examples
               WHERE workspace_id = ?
               ORDER BY created_at DESC LIMIT ?`,
            )
            .all(workspaceId, limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      agentRole: String(r['agent_role']),
      actionType: String(r['action_type']),
      proposedText: String(r['proposed_text']),
      approvedText: String(r['approved_text']),
      createdAt: Number(r['created_at']),
    }));
  }

  private mapApprovalRow(r: Record<string, unknown>): ArmApprovalRecord {
    return {
      id: String(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      idempotencyKey: String(r['idempotency_key']),
      leadId: String(r['lead_id']),
      requestedByRole: String(r['requested_by_role']),
      toolName: String(r['tool_name']),
      actionType: String(r['action_type']),
      title: String(r['title']),
      agentReasoning: String(r['agent_reasoning']),
      riskRuleTriggered: String(r['risk_rule_triggered']),
      proposedPayload: safeParseJson<Record<string, unknown>>(
        String(r['proposed_payload_json'] || '{}'),
        {},
      ),
      finalApprovedPayload: r['final_approved_payload_json']
        ? safeParseJson<Record<string, unknown>>(String(r['final_approved_payload_json']), {})
        : null,
      saveAsExample: Number(r['save_as_example'] ?? 0) === 1,
      status: r['status'] as ArmApprovalRecord['status'],
      createdAt: Number(r['created_at']),
    };
  }

  /**
   * Inserts or updates a workspace-scoped bank rail snapshot in the SQLite mirror.
   */
  upsertBankRail(rail: ArmBankRailRecord): ArmBankRailRecord {
    const id = requireNonEmptyString(rail.id, 'id');
    const bankName = requireNonEmptyString(rail.bankName, 'bankName');
    const currency = requireNonEmptyString(rail.currency, 'currency');
    const holderDetails = rail.holderDetails != null ? String(rail.holderDetails) : null;
    const currentBalanceFiat = toFiniteNumber(rail.currentBalanceFiat, 0);
    const maxDailyCapFiat = toFiniteNumber(rail.maxDailyCapFiat, 0);
    const status =
      typeof rail.status === 'string' && rail.status.trim().length > 0
        ? rail.status.trim()
        : ARM_BANK_RAIL_STATUSES.AVAILABLE;
    const updatedAt = toFiniteNumber(rail.updatedAt, Date.now());

    this.db
      .prepare(
        `INSERT INTO arm_bank_rails (
          id, workspace_id, bank_name, currency, holder_details,
          current_balance_fiat, max_daily_cap_fiat, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          bank_name = excluded.bank_name,
          currency = excluded.currency,
          holder_details = excluded.holder_details,
          current_balance_fiat = excluded.current_balance_fiat,
          max_daily_cap_fiat = excluded.max_daily_cap_fiat,
          status = excluded.status,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        rail.workspaceId,
        bankName,
        currency,
        holderDetails,
        currentBalanceFiat,
        maxDailyCapFiat,
        status,
        updatedAt,
      );

    return {
      id,
      workspaceId: rail.workspaceId,
      bankName,
      currency,
      holderDetails,
      currentBalanceFiat,
      maxDailyCapFiat,
      status,
      updatedAt,
    };
  }

  /**
   * Lists all mirrored bank rails for a single workspace silo.
   */
  listBankRails(workspaceId: ArmRepoWorkspaceId): ArmBankRailRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM arm_bank_rails
         WHERE workspace_id = ?
         ORDER BY updated_at DESC, id ASC`,
      )
      .all(workspaceId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      bankName: String(r['bank_name']),
      currency: String(r['currency']),
      holderDetails: r['holder_details'] != null ? String(r['holder_details']) : null,
      currentBalanceFiat: Number(r['current_balance_fiat'] ?? 0),
      maxDailyCapFiat: Number(r['max_daily_cap_fiat'] ?? 0),
      status: String(r['status'] || ARM_BANK_RAIL_STATUSES.AVAILABLE),
      updatedAt: Number(r['updated_at'] ?? 0),
    }));
  }

  /**
   * Atomically records a payment receipt and reports UNIQUE replay collisions.
   */
  recordPaymentReceipt(receipt: ArmPaymentReceiptInput): ArmPaymentReceiptRecordResult {
    const id =
      typeof receipt.id === 'string' && receipt.id.trim().length > 0
        ? receipt.id.trim()
        : `rcp-${crypto.randomUUID()}`;
    const bankRailId = requireNonEmptyString(receipt.bankRailId, 'bankRailId');
    const referenceCode = requireNonEmptyString(receipt.referenceCode, 'referenceCode');
    const amountFiat = toFiniteNumber(receipt.amountFiat, 0);
    const dealId = receipt.dealId != null ? String(receipt.dealId) : null;
    const createdAt = toFiniteNumber(receipt.createdAt, Date.now());

    try {
      this.db
        .prepare(
          `INSERT INTO arm_payment_receipts (
            id, workspace_id, bank_rail_id, reference_code, amount_fiat, deal_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          receipt.workspaceId,
          bankRailId,
          referenceCode,
          amountFiat,
          dealId,
          createdAt,
        );

      return {
        recorded: true,
        collision: false,
      };
    } catch (err: unknown) {
      if (!isSqliteUniqueConstraintError(err)) {
        throw err;
      }

      const existingByRef = this.db
        .prepare(
          `SELECT deal_id FROM arm_payment_receipts
           WHERE workspace_id = ? AND bank_rail_id = ? AND reference_code = ?
           LIMIT 1`,
        )
        .get(receipt.workspaceId, bankRailId, referenceCode) as
        | Record<string, unknown>
        | undefined;

      const existingRow =
        existingByRef ??
        (this.db
          .prepare(`SELECT deal_id FROM arm_payment_receipts WHERE id = ? LIMIT 1`)
          .get(id) as Record<string, unknown> | undefined);

      return {
        recorded: false,
        collision: true,
        existingDealId:
          existingRow && existingRow['deal_id'] != null ? String(existingRow['deal_id']) : null,
      };
    }
  }

  /**
   * Lists recorded payment receipts for a single workspace silo, newest first.
   */
  listPaymentReceipts(workspaceId: ArmRepoWorkspaceId, limit = 100): ArmPaymentReceiptRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM arm_payment_receipts
         WHERE workspace_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(workspaceId, safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r['id']),
      workspaceId: r['workspace_id'] as ArmRepoWorkspaceId,
      bankRailId: String(r['bank_rail_id']),
      referenceCode: String(r['reference_code']),
      amountFiat: Number(r['amount_fiat'] ?? 0),
      dealId: r['deal_id'] != null ? String(r['deal_id']) : null,
      createdAt: Number(r['created_at'] ?? 0),
    }));
  }

  /**
   * Persists a cross-silo treasury settlement idempotently via idempotency_key.
   */
  recordTreasurySettlement(
    settlement: ArmTreasurySettlementInput,
  ): ArmTreasurySettlementResult {
    const id =
      typeof settlement.id === 'string' && settlement.id.trim().length > 0
        ? settlement.id.trim()
        : `settle-${crypto.randomUUID()}`;
    const idempotencyKey = requireNonEmptyString(settlement.idempotencyKey, 'idempotencyKey');
    const settlementDate = requireNonEmptyString(settlement.settlementDate, 'settlementDate');
    if (
      typeof settlement.netProfitUsdt !== 'number' ||
      !Number.isFinite(settlement.netProfitUsdt)
    ) {
      throw new Error('arm_repository: netProfitUsdt must be a finite number');
    }
    const createdAt = toFiniteNumber(settlement.createdAt, Date.now());

    const info = this.db
      .prepare(
        `INSERT INTO arm_treasury_settlements (
          id, source_workspace, target_workspace, idempotency_key,
          net_profit_usdt, settlement_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        id,
        settlement.sourceWorkspace,
        settlement.targetWorkspace,
        idempotencyKey,
        settlement.netProfitUsdt,
        settlementDate,
        createdAt,
      );

    const existing = this.db
      .prepare(`SELECT * FROM arm_treasury_settlements WHERE idempotency_key = ? LIMIT 1`)
      .get(idempotencyKey) as Record<string, unknown> | undefined;

    if (!existing) {
      throw new Error(`arm_repository: failed to persist settlement for key ${idempotencyKey}`);
    }

    return {
      recorded: Number(info.changes) > 0,
      duplicate: Number(info.changes) === 0,
      settlement: this.mapTreasurySettlementRow(existing),
    };
  }

  /**
   * Lists treasury settlements, optionally filtered by source workspace.
   */
  listTreasurySettlements(
    sourceWorkspace?: ArmRepoWorkspaceId,
    limit = 50,
  ): ArmTreasurySettlementRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = (
      sourceWorkspace
        ? this.db
            .prepare(
              `SELECT * FROM arm_treasury_settlements
               WHERE source_workspace = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(sourceWorkspace, safeLimit)
        : this.db
            .prepare(
              `SELECT * FROM arm_treasury_settlements
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(safeLimit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapTreasurySettlementRow(r));
  }

  private mapTreasurySettlementRow(r: Record<string, unknown>): ArmTreasurySettlementRecord {
    return {
      id: String(r['id']),
      sourceWorkspace: r['source_workspace'] as ArmRepoWorkspaceId,
      targetWorkspace: r['target_workspace'] as ArmRepoWorkspaceId,
      idempotencyKey: String(r['idempotency_key']),
      netProfitUsdt: Number(r['net_profit_usdt'] ?? 0),
      settlementDate: String(r['settlement_date']),
      createdAt: Number(r['created_at'] ?? 0),
    };
  }
}
