import path from "node:path";
import { parseSync } from "oxc-parser";

const forbiddenIdentifiers = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "globalThis",
  "self",
  "global",
  "process",
  "require",
  "console",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "Date",
  "eval",
  "Function",
  "__dirname",
  "__filename",
]);

/** Static boundary guard, not a security sandbox. Conservative global names are reserved. */
export function boundaryViolations(filename, source, sourceRoot) {
  const { program, errors } = parseSync(filename, source);
  const violations = errors.map((e) => e.message);
  const layer = path.relative(sourceRoot, filename).split(path.sep)[0];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.type === "TSAnyKeyword") violations.push("any is forbidden");
    if (node.type === "Identifier" && forbiddenIdentifiers.has(node.name)) {
      violations.push(`environment identifier: ${node.name}`);
    }
    if (
      [
        "ImportExpression",
        "TSImportType",
        "TSImportEqualsDeclaration",
        "MetaProperty",
        "JSXElement",
        "JSXFragment",
      ].includes(node.type)
    ) {
      violations.push(`unsupported boundary syntax: ${node.type}`);
    }
    if (
      node.source &&
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
    ) {
      const specifier = node.source.value;
      const target = path.resolve(path.dirname(filename), specifier);
      const relative = path.relative(sourceRoot, target);
      const targetLayer = relative.split(path.sep)[0];
      const typeOnly =
        node.importKind === "type" ||
        node.exportKind === "type" ||
        (node.type === "ImportDeclaration" &&
          node.specifiers.length > 0 &&
          node.specifiers.every((s) => s.importKind === "type"));
      const allowed =
        specifier.startsWith(".") &&
        target.endsWith(".ts") &&
        ((layer === "core" && targetLayer === "core") || (targetLayer === "types" && typeOnly));
      if (!allowed) violations.push(`forbidden dependency: ${specifier}`);
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(program);
  if (layer === "types") {
    for (const statement of program.body) {
      const declaration =
        statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      if (
        declaration &&
        !["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "ImportDeclaration"].includes(
          declaration.type,
        )
      ) {
        violations.push("types must contain only type declarations/imports");
      }
    }
  }
  return violations;
}
