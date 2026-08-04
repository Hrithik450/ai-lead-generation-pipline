import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config.js";

/**
 * Provider abstraction.
 *
 * Every LLM call in this codebase goes through `chatModel()` and returns a
 * `BaseChatModel`. Nothing downstream imports a vendor SDK or names a vendor
 * type, so adding or swapping a provider is a case arm here plus an env var —
 * not a change to extraction, planning, or scoring.
 *
 * Two roles exist rather than one model: extraction runs once per domain across
 * thousands of domains and wants the cheap fast tier, while planning runs once
 * per run and wants the strong tier. They are configured independently.
 */

export type ProviderName = "google" | "openai" | "anthropic";
export type ModelRole = "extract" | "plan";

export interface ModelSpec {
  provider: ProviderName;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export function resolveSpec(role: ModelRole): ModelSpec {
  const provider = config.llmProvider;
  const model = role === "plan" ? config.planModel : config.extractModel;
  return {
    provider,
    model: model || defaultModel(provider),
    // Extraction is field copying against a fixed schema. Sampling variety buys
    // nothing and makes the same page yield different records across retries.
    temperature: role === "plan" ? 0.4 : 0,
    maxOutputTokens: role === "plan" ? 8_192 : 4_096,
  };
}

function defaultModel(provider: ProviderName): string {
  switch (provider) {
    // Lite tier for every role. The Pro tier is deliberately unreachable by
    // default: whoever operates this pays for it, and choosing a costlier tier is
    // their call via EXTRACT_MODEL / PLAN_MODEL, not a decision baked into code.
    // Extraction is schema-filling and planning is a short structured plan —
    // neither has shown a quality gap at lite that would justify the difference.
    case "google":
      return "gemini-3.5-flash-lite";
    case "openai":
      return "gpt-5.1-mini";
    case "anthropic":
      return "claude-haiku-4-5";
  }
}

export function apiKeyFor(provider: ProviderName): string {
  switch (provider) {
    case "google":
      return config.googleApiKey;
    case "openai":
      return config.openaiApiKey;
    case "anthropic":
      return config.anthropicApiKey;
  }
}

export function assertProviderConfigured(role: ModelRole): void {
  const spec = resolveSpec(role);
  if (!apiKeyFor(spec.provider)) {
    throw new Error(
      `LLM_PROVIDER is "${spec.provider}" but ${envVarFor(spec.provider)} is not set. ` +
        `Set it, or switch LLM_PROVIDER to a provider you have a key for.`,
    );
  }
}

function envVarFor(provider: ProviderName): string {
  switch (provider) {
    case "google":
      return "GOOGLE_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
  }
}

const cache = new Map<string, BaseChatModel>();

export function chatModel(role: ModelRole): BaseChatModel {
  const spec = resolveSpec(role);
  const key = `${spec.provider}:${spec.model}:${spec.temperature}`;
  const existing = cache.get(key);
  if (existing) return existing;

  assertProviderConfigured(role);
  const model = build(spec);
  cache.set(key, model);
  return model;
}

function build(spec: ModelSpec): BaseChatModel {
  // A single 429 must not fail a domain outright, so every provider retries.
  const shared = { temperature: spec.temperature, maxRetries: 4 };

  switch (spec.provider) {
    case "google":
      return new ChatGoogleGenerativeAI({
        ...shared,
        apiKey: apiKeyFor("google"),
        model: spec.model,
        maxOutputTokens: spec.maxOutputTokens,
      });

    case "openai":
      return new ChatOpenAI({
        ...shared,
        apiKey: apiKeyFor("openai"),
        model: spec.model,
        maxTokens: spec.maxOutputTokens,
      });

    case "anthropic":
      return new ChatAnthropic({
        ...shared,
        apiKey: apiKeyFor("anthropic"),
        model: spec.model,
        maxTokens: spec.maxOutputTokens,
      });
  }
}

/** Structured-output method per provider. Gemini rejects "jsonMode" outright. */
export function structuredOutputMethod(provider: ProviderName): "jsonSchema" | "functionCalling" {
  return provider === "google" ? "jsonSchema" : "functionCalling";
}
