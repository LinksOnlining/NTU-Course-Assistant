export type AiProviderErrorCode =
  | "notConfigured"
  | "invalidCredential"
  | "forbidden"
  | "rateLimited"
  | "networkUnavailable"
  | "timeout"
  | "providerUnavailable"
  | "invalidRequest"
  | "invalidResponse"
  | "emptyOutput"
  | "invalidJson"
  | "schemaMismatch"
  | "truncatedOutput"
  | "modelUnavailable"
  | "credentialStoreUnavailable"
  | "cancelled"
  | "unknown";

export interface AiProviderFailure {
  readonly code: AiProviderErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly requestId?: string;
}

export interface DeepSeekModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly supportedEfforts?: readonly ("low" | "high" | "max")[];
  readonly defaultEffort?: "low" | "high" | "max";
  readonly capabilities?: readonly string[];
}

export interface NativeGenerationInput {
  readonly id: string;
  readonly intent: string;
  readonly prompt: string;
  readonly model: string;
  readonly reasoningEffort: "none" | "low" | "high" | "max";
  readonly requestTimeoutSeconds: number;
}

export interface NativeStructuredGenerationInput extends NativeGenerationInput {
  readonly schemaName: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

export interface NativeTextResult {
  readonly content: string;
  readonly model: string;
  readonly createdAtEpochSeconds?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiNativeBridge {
  getCredentialStatus(): Promise<boolean>;
  setCredential(secret: string): Promise<boolean>;
  deleteCredential(): Promise<boolean>;
  discoverModels(requestId: string, timeoutSeconds: number): Promise<readonly DeepSeekModel[]>;
  generateText(input: NativeGenerationInput): Promise<NativeTextResult>;
  generateStructured(input: NativeStructuredGenerationInput): Promise<unknown>;
}
