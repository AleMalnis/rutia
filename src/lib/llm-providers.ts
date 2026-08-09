// Proveedores de IA soportados por el BYOK (spec §6.4). Módulo seguro para
// el cliente: solo ids y etiquetas, nada de SDKs ni secretos.

export const LLM_PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keyHint: 'Se crea en console.anthropic.com → API keys',
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    keyHint: 'Se crea en platform.openai.com → API keys',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    keyHint: 'Se crea en aistudio.google.com → Get API key',
  },
] as const

export type LlmProviderId = (typeof LLM_PROVIDERS)[number]['id']

export const LLM_PROVIDER_IDS = LLM_PROVIDERS.map((provider) => provider.id) as [
  LlmProviderId,
  ...LlmProviderId[],
]

export function providerLabel(id: LlmProviderId): string {
  return LLM_PROVIDERS.find((provider) => provider.id === id)?.label ?? id
}

/** Lo único que el navegador puede saber de la clave guardada (spec §6.4). */
export type LlmKeyStatusView = {
  provider: LlmProviderId
  last4: string
}
