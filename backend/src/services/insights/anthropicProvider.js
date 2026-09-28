'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');

/**
 * Optional AI narrative for business insights, using the Claude API.
 *
 * Enabled with AI_PROVIDER=anthropic and AI_API_KEY in .env (AI_MODEL
 * overrides the default model). Only aggregated business figures are sent —
 * never customer names, phone numbers or other personal data. Any error,
 * refusal or invalid answer makes the caller fall back to the built-in
 * rule-based summary, so insights keep working offline.
 */
const DEFAULT_MODEL = 'claude-opus-5';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'recommendations'],
  properties: {
    summary: { type: 'string', description: 'Two to four sentences for the salon owner.' },
    recommendations: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'priority'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const Output = z.object({
  summary: z.string().min(1).max(2000),
  recommendations: z
    .array(z.object({ title: z.string().min(1).max(160), detail: z.string().min(1).max(600), priority: z.enum(['high', 'medium', 'low']) }))
    .max(5),
});

const SYSTEM = [
  'You are a business analyst for a beauty salon and barbershop that uses ZOLA STYLISH MANAGEMENT SYSTEM.',
  'You receive figures the system has already calculated. Write for the salon owner: plain, specific and practical.',
  'Use only the numbers provided; do not invent figures. Amounts are in the given currency.',
  'Recommendations must be concrete actions the salon can take in the next few weeks, grounded in the figures.',
].join(' ');

function createAnthropicProvider({ apiKey, model }) {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const modelId = model || DEFAULT_MODEL;

  return {
    name: 'anthropic',
    model: modelId,
    async narrate(facts) {
      const response = await client.beta.messages.create({
        model: modelId,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Business figures (JSON):\n${JSON.stringify(facts)}\n\nSummarise how the salon is doing and give up to five recommendations.`,
          },
        ],
      });
      if (response.stop_reason === 'refusal') throw new Error('The AI provider declined the request');
      if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off');
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { ...Output.parse(JSON.parse(text)), model: response.model };
    },
  };
}

module.exports = { createAnthropicProvider, isApiError: (error) => error instanceof Anthropic.APIError };
