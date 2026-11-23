import type { ArmWorkspaceId, InboundMediaType } from '@p2p/core';

export interface MetaOutboundDispatchResult {
  delivered: boolean;
  mode: 'LIVE_META_GRAPH' | 'DRY_RUN_NO_META_CREDENTIALS' | 'META_API_ERROR';
  workspaceId: ArmWorkspaceId;
  phoneNumberId?: string;
  metaMessageId?: string;
  error?: string;
}

export interface MultimodalMediaAnalysisResult {
  analyzed: boolean;
  mode: 'GEMINI_VISION_AUDIO' | 'DRY_RUN_NO_CREDENTIALS' | 'MEDIA_ERROR';
  extractedText: string;
  error?: string;
}

export function resolveWorkspacePhoneNumberId(
  workspaceId: ArmWorkspaceId,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const sharedFallback = env['META_PHONE_NUMBER_ID']?.trim() || undefined;
  switch (workspaceId) {
    case 'ARM_B2B':
      return env['META_PHONE_NUMBER_ID_B2B']?.trim() || sharedFallback;
    case 'P2P_DESK':
      return env['META_PHONE_NUMBER_ID_P2P']?.trim() || sharedFallback;
    case 'FINANCE_360':
      return env['META_PHONE_NUMBER_ID_360']?.trim() || sharedFallback;
  }
}

export async function dispatchMetaWhatsappMessage(params: {
  workspaceId: ArmWorkspaceId;
  recipientPhone: string;
  text: string;
  templateName?: string;
  templateVariables?: string[];
  accessToken?: string;
  phoneNumberId?: string;
}): Promise<MetaOutboundDispatchResult> {
  const accessToken = (params.accessToken ?? process.env['META_ACCESS_TOKEN'])?.trim();
  const phoneNumberId =
    params.phoneNumberId?.trim() || resolveWorkspacePhoneNumberId(params.workspaceId);

  if (!accessToken || !phoneNumberId || !params.recipientPhone.trim()) {
    return {
      delivered: false,
      mode: 'DRY_RUN_NO_META_CREDENTIALS',
      workspaceId: params.workspaceId,
      phoneNumberId,
    };
  }

  const normalizedTo = params.recipientPhone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  const bodyPayload: Record<string, unknown> = params.templateName
    ? {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: 'es' },
          components:
            params.templateVariables && params.templateVariables.length > 0
              ? [
                  {
                    type: 'body',
                    parameters: params.templateVariables.map((v) => ({
                      type: 'text',
                      text: v,
                    })),
                  },
                ]
              : undefined,
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { preview_url: false, body: params.text },
      };

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        delivered: false,
        mode: 'META_API_ERROR',
        workspaceId: params.workspaceId,
        phoneNumberId,
        error: `HTTP ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    return {
      delivered: true,
      mode: 'LIVE_META_GRAPH',
      workspaceId: params.workspaceId,
      phoneNumberId,
      metaMessageId: data.messages?.[0]?.id,
    };
  } catch (err: unknown) {
    return {
      delivered: false,
      mode: 'META_API_ERROR',
      workspaceId: params.workspaceId,
      phoneNumberId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAndAnalyzeMetaMediaWithGemini(params: {
  mediaId?: string;
  mediaType?: InboundMediaType;
  mimeType?: string;
  accessToken?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}): Promise<MultimodalMediaAnalysisResult> {
  const accessToken = (params.accessToken ?? process.env['META_ACCESS_TOKEN'])?.trim();
  const geminiApiKey = (params.geminiApiKey ?? process.env['GEMINI_API_KEY'])?.trim();
  const model = (params.geminiModel ?? process.env['GEMINI_MODEL'])?.trim() || 'gemini-2.0-flash';

  if (!params.mediaId || !accessToken || !geminiApiKey) {
    return {
      analyzed: false,
      mode: 'DRY_RUN_NO_CREDENTIALS',
      extractedText: '',
    };
  }

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${params.mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!metaRes.ok) {
      return {
        analyzed: false,
        mode: 'MEDIA_ERROR',
        extractedText: '',
        error: `Meta media lookup HTTP ${metaRes.status}`,
      };
    }

    const metaInfo = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaInfo.url) {
      return {
        analyzed: false,
        mode: 'MEDIA_ERROR',
        extractedText: '',
        error: 'Meta media URL missing',
      };
    }

    const binRes = await fetch(metaInfo.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!binRes.ok) {
      return {
        analyzed: false,
        mode: 'MEDIA_ERROR',
        extractedText: '',
        error: `Meta binary download HTTP ${binRes.status}`,
      };
    }

    const buf = Buffer.from(await binRes.arrayBuffer());
    const base64 = buf.toString('base64');
    const resolvedMime =
      params.mimeType ||
      metaInfo.mime_type ||
      (params.mediaType === 'audio' || params.mediaType === 'voice' ? 'audio/ogg' : 'image/jpeg');

    const instruction =
      params.mediaType === 'audio' || params.mediaType === 'voice'
        ? 'Transcribe fielmente en español esta nota de voz comercial de WhatsApp sin agregar comentarios.'
        : 'Extrae el texto legible y datos clave (monto, banco, número de referencia, moneda, remitente o plan) de esta imagen o documento de WhatsApp en formato conciso.';

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: instruction },
                { inline_data: { mime_type: resolvedMime, data: base64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.0 },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!geminiRes.ok) {
      return {
        analyzed: false,
        mode: 'MEDIA_ERROR',
        extractedText: '',
        error: `Gemini multimodal HTTP ${geminiRes.status}`,
      };
    }

    const gData = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const extracted = gData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return {
      analyzed: extracted.length > 0,
      mode: 'GEMINI_VISION_AUDIO',
      extractedText: extracted,
    };
  } catch (err: unknown) {
    return {
      analyzed: false,
      mode: 'MEDIA_ERROR',
      extractedText: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
