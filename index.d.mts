import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type z from "@deepseek-ai/schemastery";

export type MemoryScope = {
  environment: "production" | "test";
  tenantId: string;
  userId: string;
};

export type MemoryAccess = {
  authenticated(): boolean;
  identitySignal(): AbortSignal;
  watch(listener: () => void): () => void;
  capabilities(signal: AbortSignal): Promise<{
    scope: MemoryScope;
    readOnly: true;
    memoryTypes: ["preferences"];
  }>;
  recall(
    query: string,
    signal: AbortSignal,
  ): Promise<{
    scope: MemoryScope;
    memories: { uri: string; content: string; score: number }[];
  }>;
};

declare module "@deepseek-ai/cordis" {
  interface Context {
    geaMemory: MemoryAccess;
  }
}

export const name: "gea-personal-memory";
export const inject: string[];
export const Config: z<{ enabled?: boolean }, { enabled: boolean }>;
export function apply(ctx: Context, config?: { enabled?: boolean }): void;
