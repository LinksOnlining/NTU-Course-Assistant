export type SaveOperationState =
  | { readonly kind: "idle" }
  | { readonly kind: "validating" }
  | { readonly kind: "saving" }
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly message: string };
