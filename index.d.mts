import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type z from "@deepseek-ai/schemastery";

export const name: "gea-personal-memory";
export const pluginPackageVersion: Readonly<{ name: "@cleverc2200/dsh-personal-memory"; version: string }>;
export const inject: string[];
export const Config: z<Record<string, never>, Record<string, never>>;
export function apply(ctx: Context): void;
