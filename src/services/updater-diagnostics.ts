/** Safe, actionable updater diagnostics shown only after an explicit user check. */
function detailOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知更新服务错误";
}

export function isTransientUpdaterError(error: unknown): boolean {
  return /timed?\s*out|timeout|network|connect|dns|certificate|tls|fetch failed|request failed|error sending request|reset by peer|eof|502|503|504/i.test(
    detailOf(error),
  );
}

export function describeUpdaterError(error: unknown): string {
  const detail = detailOf(error);
  if (/\b403\b|forbidden|rate limit/i.test(detail)) {
    return "GitHub 返回 HTTP 403（访问受限或请求额度不足）。请稍后重试，或从 Release 页面下载安装包。";
  }
  if (/\b404\b|not found|release not found|targets? not found/i.test(detail)) {
    return "更新清单或适用的安装包未找到（HTTP 404 / 平台不匹配）。请检查发布资产，或打开 Release 页面。";
  }
  if (/signature|verification|invalid.*key/i.test(detail)) {
    return "更新包签名校验异常。为保护安全，程序未安装该更新；请从官方 Release 页面确认版本。";
  }
  if (/timed?\s*out|timeout/i.test(detail)) {
    return "更新服务器响应超时。请检查 GitHub 网络连接后重试；当前版本仍可使用。";
  }
  if (isTransientUpdaterError(error)) {
    return "连接更新服务器时发生网络或证书错误。请检查网络、代理与系统时间后重试。";
  }
  // Keep the underlying error for diagnosis; limit length and strip control characters.
  const summary = [...detail]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character,
    )
    .join("")
    .slice(0, 180);
  return `更新检查失败（详细原因：${summary}）。当前版本仍可使用。`;
}
