import {
  CompileDisputeDossierInputSchema,
  type CompileDisputeDossierInput,
} from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

/**
 * A dispute dossier is submitted to a third-party exchange arbitrator. Two
 * things here were fabrications with legal consequences.
 *
 * First, `sha256Digest` was `dossier_sha256_${Date.now()}_${orderId}` — a
 * timestamp and an order-ID substring wearing the costume of a SHA-256. An
 * arbitrator comparing that string to the document would find no match, and
 * the tool's own description promised "sellos criptográficos SHA-256".
 *
 * Second, the appeal narratives asserted facts the tool had never checked.
 * UNRELEASED_CRYPTO claimed "Se verificó la acreditación efectiva y definitiva
 * de los fondos mediante extracto bancario firmado digitalmente" and
 * FAKE_RECEIPT claimed "La entidad bancaria confirma que el número de
 * referencia no existe" — no bank was ever contacted.
 *
 * The narrative is retained as a *draft template* with its unproven
 * assertions removed, and the probability-of-success figure is dropped
 * entirely.
 */
export const compileDisputeDossierTool = {
  name: 'compile_dispute_dossier',
  description:
    'Prepara un borrador de expediente forense y dossier de apelación para disputas P2P. Sin evidencia adjunta verificada no genera sello criptográfico, no afirma hechos no comprobados y no estima probabilidad de resolución.',
  inputSchema: CompileDisputeDossierInputSchema,
  execute: (input: CompileDisputeDossierInput) => {
    const orderId = input.orderId;
    const reason = input.disputeReason;
    const bankRef = input.bankReference ?? null;
    const nick = input.counterpartyNick;

    // Draft skeletons. Every clause that previously asserted a verified bank
    // confirmation is now a field the operator must fill from a real document.
    const appealDrafts: Record<string, string> = {
      THIRD_PARTY_PAYMENT:
        'La contraparte alleges que el pago provino de una cuenta bancaria a nombre de un tercero no titular. [PENDIENTE: adjuntar comprobante bancario y Cédula del titular de la cuenta de destino; sin ese documento esta afirmación no puede sostenerse ante el árbitro.]',
      UNRELEASED_CRYPTO:
        'La contraparte no ha liberado las criptomonedas dentro del tiempo reglamentario. [PENDIENTE: adjuntar extracto bancario que acredite la acreditación; no se ha consultado a la entidad financiera.]',
      FAKE_RECEIPT:
        'El comprobante suministrado por la contraparte fue cuestionado. [PENDIENTE: adjuntar análisis de metadatos y constancia de la entidad financiera sobre la inexistencia de la referencia. Sin esa constancia, no puede afirmarse que la referencia sea falsa.]',
      INCORRECT_AMOUNT:
        'El monto acreditado no coincide con el pactado. [PENDIENTE: adjuntar desglose contable y extracto bancario que demuestre la diferencia.]',
    };

    const hasEvidence = !!input.chatLogSummary || !!input.bankReference;

    return unverifiedVerdict(
      {
        orderId,
        dossierStatus: 'DRAFT_UNVERIFIED',
        sha256Digest: null,
        sha256Rationale:
          'Un sello SHA-256 sólo puede calcularse sobre los bytes finales del documento. Esta herramienta redacta contenido; no genera un PDF, por lo que no emite digest.',
        disputeReason: reason,
        recommendedAppealStatement: appealDrafts[reason] ?? 'Disputa operativa P2P. [PENDIENTE: documentación.]',
        evidenceMetadata: {
          orderId,
          counterparty: nick,
          fiatAmountVes: input.amountVes,
          cryptoAmountUsdt: input.amountUsdt,
          bankReferenceProvided: bankRef,
          chatLogSummaryProvided: !!input.chatLogSummary,
          evidenceAttachmentsVerified: false,
          evidenceVerifiedBy: null,
          bankingProofTimestamp: null,
        },
        exportFormat: null,
        resolutionProbabilityPct: null,
        resolutionProbabilityRationale:
          'No se estima probabilidad de resolución: no existe base de datos histórica de resultados de disputa que la sustente.',
        anyEvidenceSupplied: hasEvidence,
      },
      'NO_EVIDENCE_ATTACHMENT',
      'bank statement / signed evidence bundle with verified attachments',
    );
  },
};
