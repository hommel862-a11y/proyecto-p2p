import {
  parseCustomerChatMessage,
  generateConciergeReply,
} from '../core/index.js';
import {
  ProcessConciergeInquiryInputSchema,
  type ProcessConciergeInquiryInput,
} from '../schemas/index.js';

export const processConciergeInquiryTool = {
  name: 'process_concierge_inquiry',
  description:
    'Procesa consultas de clientes por WhatsApp/Telegram, detecta intención y montos, y genera cotizaciones y datos bancarios oficiales.',
  inputSchema: ProcessConciergeInquiryInputSchema,
  execute: (input: ProcessConciergeInquiryInput) => {
    const parsed = parseCustomerChatMessage(input.customerMessage);
    const reply = generateConciergeReply(parsed, {
      deskRatePerUsd: input.deskRatePerUsd,
      bankName: input.bankName,
      bankAccountDetails: input.bankAccountDetails,
      quoteValidityMinutes: input.quoteValidityMinutes,
    });

    return {
      success: true,
      ...reply,
      processedAt: new Date().toISOString(),
    };
  },
};
