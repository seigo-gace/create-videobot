const PROVIDERS = Object.freeze({
  groq: 'ASSISTANT_AI_GROQ_API_KEY',
  gemini: 'ASSISTANT_AI_GEMINI_API_KEY',
  openrouter: 'ASSISTANT_AI_OPENROUTER_API_KEY',
});
export function assistantProviderStatus(env = process.env) {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([provider,name]) => [provider,{configured: typeof env[name] === 'string' && env[name].trim().length > 0}]));
}
export function resolveAssistantProvider(name, env = process.env) {
  const envName = PROVIDERS[name];
  if (!envName) throw new Error('unsupported assistant provider');
  const key = env[envName];
  if (typeof key !== 'string' || !key.trim()) throw new Error('assistant provider unavailable');
  // Secrets must never be logged or returned by status endpoints.
  return {provider:name, apiKey:key};
}
export const assistantSecretNames = Object.freeze({...PROVIDERS});
