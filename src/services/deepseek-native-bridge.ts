import { invoke } from "@tauri-apps/api/core";
import type {
  AiNativeBridge,
  AiProviderFailure,
  DeepSeekModel,
  NativeGenerationInput,
  NativeStructuredGenerationInput,
  NativeToolTurnInput,
  NativeToolTurnResult,
  NativeTextResult,
} from "../types/ai-provider-bridge.ts";

type NativeResult<Value> =
  | { readonly status: "success"; readonly value: Value }
  | { readonly status: "failure"; readonly error: AiProviderFailure };

async function call<Value>(command: string, args?: Record<string, unknown>): Promise<Value> {
  try {
    const result = await invoke<NativeResult<Value>>(command, args);
    if (result.status === "failure") throw result.error;
    return result.value;
  } catch (caught: unknown) {
    if (isAiProviderFailure(caught)) throw caught;
    throw {
      code: "unknown",
      message: "AI 服务发生未知错误。",
    } satisfies AiProviderFailure;
  }
}

function isAiProviderFailure(value: unknown): value is AiProviderFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

export class DeepSeekNativeBridge implements AiNativeBridge {
  getCredentialStatus(): Promise<boolean> {
    return call<boolean>("get_deepseek_api_key_status");
  }

  setCredential(secret: string): Promise<boolean> {
    return call<boolean>("set_deepseek_api_key", { secret });
  }

  deleteCredential(): Promise<boolean> {
    return call<boolean>("delete_deepseek_api_key");
  }

  async discoverModels(
    requestId: string,
    timeoutSeconds: number,
  ): Promise<readonly DeepSeekModel[]> {
    const result = await call<{
      readonly models: readonly DeepSeekModel[];
      readonly requestId: string;
    }>("discover_deepseek_models", { requestId, timeoutSeconds });
    return result.models;
  }

  generateText(input: NativeGenerationInput): Promise<NativeTextResult> {
    return call<NativeTextResult>("generate_deepseek_text", { request: input });
  }

  generateStructured(input: NativeStructuredGenerationInput): Promise<unknown> {
    return call<unknown>("generate_deepseek_structured", { request: input });
  }

  generateToolTurn(input: NativeToolTurnInput): Promise<NativeToolTurnResult> {
    return call<NativeToolTurnResult>("generate_deepseek_tool_turn", { request: input });
  }
}
