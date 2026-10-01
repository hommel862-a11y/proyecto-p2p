import { InspectTxTaintInputSchema, type InspectTxTaintInput } from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

/**
 * Taint analysis is a graph traversal over labelled counterparty clusters.
 *
 * The previous implementation reported `taintPercentage: 0.2` and
 * `isClean: true` for any hash that did not end in `000`, and `84.5` plus
 * `compliancePass: false` for any hash that did. `isClean: true` is a
 * compliance clearance: it authorises release of the received crypto. It was
 * being emitted with no forensic source whatsoever.
 *
 * Without a labelled address source there is nothing to traverse, so the
 * honest answer is UNVERIFIED.
 */
export const inspectTxTaintTool = {
  name: 'inspect_tx_taint',
  description:
    'Inspecciona el rastro forense y grado de contaminación (taint percentage) de un hash de transacción blockchain. Sin fuente forense on-chain configurada devuelve UNVERIFIED y jamás afirma que la transacción sea limpia.',
  inputSchema: InspectTxTaintInputSchema,
  execute: (input: InspectTxTaintInput) => {
    const hash = input.txHash.trim();
    const chain = input.chain;

    return unverifiedVerdict(
      {
        txHash: hash,
        chain,
        taintPercentage: null,
        directHopToMixer: null,
        clusterAttribution: null,
        isClean: null,
        compliancePass: null,
        inspectionTimestamp: new Date().toISOString(),
      },
      'NO_ONCHAIN_FORENSIC_SOURCE',
      'labelled counterparty cluster source (Chainalysis / TRM / elliptic)',
    );
  },
};