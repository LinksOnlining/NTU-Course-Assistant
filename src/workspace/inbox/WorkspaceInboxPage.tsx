import { useEffect, useState, type FormEvent } from "react";
import {
  captureInboxText,
  confirmInboxEvent,
  confirmInboxTask,
  deleteInboxItem,
  dismissInboxItem,
  loadInboxItems,
  proposalForInboxItem,
  saveInboxParseResult,
  validateInboxEventProposal,
  validateInboxTaskProposal,
} from "../../application/inbox/inbox.ts";
import type { AppRoute } from "../../navigation/types.ts";
import type { InboxItem, InboxProposal } from "../../types/inbox.ts";
import "./workspace-inbox.css";

interface WorkspaceInboxPageProps {
  readonly onNavigate: (route: AppRoute) => void;
  readonly initialItemId?: string;
}

function updateProposalField<K extends keyof InboxProposal>(
  proposal: InboxProposal,
  field: K,
  value: InboxProposal[K],
): InboxProposal {
  return { ...proposal, [field]: value };
}

function statusLabel(item: InboxItem): string {
  switch (item.status) {
    case "confirmed":
      return item.confirmedTargetType === "personalTask" ? "已转为任务" : "已转为日程";
    case "dismissed":
      return "已忽略";
    case "pending":
      return "待整理";
    case "ready":
    case "needs_review":
      return "待确认";
  }
}

export function WorkspaceInboxPage({ onNavigate, initialItemId }: WorkspaceInboxPageProps) {
  const [items, setItems] = useState<readonly InboxItem[]>([]);
  const [proposals, setProposals] = useState<Record<string, InboxProposal>>({});
  const [unknownKinds, setUnknownKinds] = useState<Record<string, "" | "task" | "event">>({});
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const loaded = await loadInboxItems();
      setItems(loaded);
      setProposals(Object.fromEntries(loaded.map((item) => [item.id, proposalForInboxItem(item)])));
      setUnknownKinds(Object.fromEntries(loaded.map((item) => [item.id, "" as const])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取收件箱，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!initialItemId || loading) return;
    const target = [...document.querySelectorAll<HTMLElement>("[data-inbox-item-id]")].find(
      (element) => element.dataset.inboxItemId === initialItemId,
    );
    target?.scrollIntoView({ block: "center" });
  }, [initialItemId, items, loading]);

  async function addCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rawText.trim() || adding) return;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const result = await captureInboxText(rawText);
      setRawText("");
      if (result.parseError) setNotice(result.parseError);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存收件箱内容失败。");
    } finally {
      setAdding(false);
    }
  }

  function currentProposal(item: InboxItem): InboxProposal {
    return proposals[item.id] ?? proposalForInboxItem(item);
  }

  function selectedKind(item: InboxItem, proposal: InboxProposal): "" | "task" | "event" {
    return proposal.kind === "unknown" ? (unknownKinds[item.id] ?? "") : proposal.kind;
  }

  async function confirm(item: InboxItem) {
    const proposal = currentProposal(item);
    const kind = selectedKind(item, proposal);
    if (!kind) {
      setError("请先选择创建任务或创建日程。");
      return;
    }
    const edited = { ...proposal, kind };
    const validationError =
      kind === "task" ? validateInboxTaskProposal(edited) : validateInboxEventProposal(edited);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      // Persist the reviewed proposal before the atomic entity + inbox confirmation command.
      const parsed = await saveInboxParseResult(item.id, edited);
      const target =
        kind === "task"
          ? await confirmInboxTask(parsed, edited)
          : await confirmInboxEvent(parsed, edited);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                status: "confirmed",
                parseKind: kind,
                parsePayloadJson: JSON.stringify(edited),
                confirmedTargetType: target.targetType,
                confirmedTargetId: target.targetId,
                updatedAt: new Date().toISOString(),
              }
            : candidate,
        ),
      );
      setProposals((current) => ({ ...current, [item.id]: edited }));
      setNotice(kind === "task" ? "已创建个人任务。" : "已创建个人日程。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认收件箱内容失败，请检查后重试。");
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function ignore(item: InboxItem) {
    setBusyId(item.id);
    setError("");
    try {
      await dismissInboxItem(item.id);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, status: "dismissed", updatedAt: new Date().toISOString() }
            : candidate,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "忽略收件箱内容失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: InboxItem) {
    setBusyId(item.id);
    setError("");
    try {
      await deleteInboxItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setDeleteConfirmId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除收件箱内容失败。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="workspace-inbox-page" data-testid="workspace-inbox">
      <header className="workspace-inbox-heading">
        <div>
          <button
            type="button"
            className="workspace-inbox-breadcrumb"
            onClick={() => onNavigate({ area: "workspace", page: "home" })}
          >
            工作台 <span aria-hidden="true">›</span> 收件箱
          </button>
          <h2>收件箱</h2>
          <p>先保留原文，再由你确认是否整理为任务或日程。内容仅保存在本机。</p>
        </div>
        <span className="workspace-inbox-count">
          待整理{" "}
          {
            items.filter((item) => ["pending", "needs_review", "ready"].includes(item.status))
              .length
          }
        </span>
      </header>

      <form className="workspace-inbox-capture" onSubmit={(event) => void addCapture(event)}>
        <label htmlFor="workspace-inbox-raw">记录一条想法</label>
        <textarea
          id="workspace-inbox-raw"
          value={rawText}
          onChange={(event) => setRawText(event.currentTarget.value)}
          maxLength={10_000}
          rows={3}
          placeholder="例如：任务：整理材料，截止明天 18:00"
        />
        <div className="workspace-inbox-capture-footer">
          <span>只在本应用内处理；不会联网或自动创建事项。</span>
          <button type="submit" disabled={adding || !rawText.trim()}>
            {adding ? "正在保存…" : "添加到收件箱"}
          </button>
        </div>
      </form>

      {error && (
        <p className="workspace-inbox-message workspace-inbox-message--error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workspace-inbox-message" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="workspace-inbox-state" role="status">
          正在读取收件箱…
        </p>
      ) : items.length === 0 ? (
        <p className="workspace-inbox-state">收件箱还是空的，可以先记录一条想法。</p>
      ) : (
        <section className="workspace-inbox-list" aria-label="收件箱记录">
          {items.map((item) => {
            const proposal = currentProposal(item);
            const kind = selectedKind(item, proposal);
            const editable = item.status !== "confirmed" && item.status !== "dismissed";
            const validationError = !kind
              ? "请先选择创建任务或创建日程。"
              : kind === "task"
                ? validateInboxTaskProposal(
                    proposal.kind === "unknown" ? { ...proposal, kind } : proposal,
                  )
                : validateInboxEventProposal(
                    proposal.kind === "unknown" ? { ...proposal, kind } : proposal,
                  );
            const busy = busyId === item.id;
            return (
              <article
                className="workspace-inbox-item"
                key={item.id}
                data-testid="inbox-item"
                data-inbox-item-id={item.id}
              >
                <header className="workspace-inbox-item-heading">
                  <span className="workspace-inbox-status">{statusLabel(item)}</span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </time>
                </header>
                <p className="workspace-inbox-raw">{item.rawText}</p>
                {editable ? (
                  <div className="workspace-inbox-preview">
                    <h3>整理预览</h3>
                    {proposal.kind === "unknown" && (
                      <label>
                        整理为
                        <select
                          aria-label="整理为"
                          value={unknownKinds[item.id] ?? "task"}
                          onChange={(event) => {
                            const value = event.currentTarget.value as "task" | "event";
                            setUnknownKinds((current) => ({ ...current, [item.id]: value }));
                          }}
                        >
                          <option value="" disabled>
                            请选择
                          </option>
                          <option value="task">创建任务</option>
                          <option value="event">创建日程</option>
                        </select>
                      </label>
                    )}
                    <label>
                      标题
                      <input
                        maxLength={200}
                        value={proposal.title}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setProposals((current) => ({
                            ...current,
                            [item.id]: updateProposalField(
                              current[item.id] ?? proposal,
                              "title",
                              value,
                            ),
                          }));
                        }}
                      />
                    </label>
                    {kind === "event" ? (
                      <div className="workspace-inbox-fields">
                        <label>
                          日期
                          <input
                            aria-label={`${item.id}日期`}
                            type="date"
                            value={proposal.date ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value || null;
                              setProposals((current) => ({
                                ...current,
                                [item.id]: updateProposalField(
                                  current[item.id] ?? proposal,
                                  "date",
                                  value,
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          开始
                          <input
                            aria-label={`${item.id}开始时间`}
                            type="time"
                            value={proposal.startTime ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value || null;
                              setProposals((current) => ({
                                ...current,
                                [item.id]: updateProposalField(
                                  current[item.id] ?? proposal,
                                  "startTime",
                                  value,
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          结束
                          <input
                            aria-label={`${item.id}结束时间`}
                            type="time"
                            value={proposal.endTime ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value || null;
                              setProposals((current) => ({
                                ...current,
                                [item.id]: updateProposalField(
                                  current[item.id] ?? proposal,
                                  "endTime",
                                  value,
                                ),
                              }));
                            }}
                          />
                        </label>
                      </div>
                    ) : kind === "task" ? (
                      <div className="workspace-inbox-fields">
                        <label>
                          截止日期
                          <input
                            aria-label={`${item.id}截止日期`}
                            type="date"
                            value={proposal.deadlineDate ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value || null;
                              setProposals((current) => ({
                                ...current,
                                [item.id]: updateProposalField(
                                  current[item.id] ?? proposal,
                                  "deadlineDate",
                                  value,
                                ),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          截止时间
                          <input
                            aria-label={`${item.id}截止时间`}
                            type="time"
                            value={proposal.deadlineTime ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value || null;
                              setProposals((current) => ({
                                ...current,
                                [item.id]: updateProposalField(
                                  current[item.id] ?? proposal,
                                  "deadlineTime",
                                  value,
                                ),
                              }));
                            }}
                          />
                        </label>
                      </div>
                    ) : null}
                    {kind === "task" &&
                      (proposal.date || proposal.startTime || proposal.endTime) && (
                        <div className="workspace-inbox-extra-fields">
                          <p>
                            另识别到日期 {proposal.date ?? "未识别"}，时间{" "}
                            {proposal.startTime ?? "未识别"}
                            {proposal.endTime ? `–${proposal.endTime}` : ""}；不会自动当作截止时间。
                          </p>
                          {proposal.date && !proposal.deadlineDate && (
                            <button
                              type="button"
                              onClick={() =>
                                setProposals((current) => ({
                                  ...current,
                                  [item.id]: {
                                    ...(current[item.id] ?? proposal),
                                    deadlineDate: proposal.date,
                                    deadlineTime: proposal.startTime,
                                  },
                                }))
                              }
                            >
                              将识别日期和时间用作截止
                            </button>
                          )}
                        </div>
                      )}
                    {kind === "event" && (proposal.deadlineDate || proposal.deadlineTime) && (
                      <p className="workspace-inbox-hint">
                        另识别到截止信息 {proposal.deadlineDate ?? ""} {proposal.deadlineTime ?? ""}
                        ；它不会覆盖日程时间。
                      </p>
                    )}
                    {proposal.kind === "unknown" && (
                      <p className="workspace-inbox-hint">
                        无法确定类型；请自行选择。模糊时间不会自动补全。
                      </p>
                    )}
                    {validationError && <p className="workspace-inbox-hint">{validationError}</p>}
                    <div className="workspace-inbox-actions">
                      <button
                        type="button"
                        disabled={busy || Boolean(validationError)}
                        onClick={() => void confirm(item)}
                      >
                        {busy
                          ? "正在确认…"
                          : kind === "task"
                            ? "确认创建任务"
                            : kind === "event"
                              ? "确认创建日程"
                              : "请先选择类型"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void ignore(item)}>
                        暂不处理
                      </button>
                    </div>
                  </div>
                ) : item.status === "confirmed" ? (
                  <div className="workspace-inbox-actions">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate(
                          item.confirmedTargetType === "personalTask"
                            ? { area: "workspace", page: "tasks" }
                            : { area: "workspace", page: "schedule" },
                        )
                      }
                    >
                      {item.confirmedTargetType === "personalTask" ? "打开任务" : "打开日程"}
                    </button>
                  </div>
                ) : null}
                {deleteConfirmId === item.id ? (
                  <div
                    className="workspace-inbox-delete-confirm"
                    role="group"
                    aria-label="确认删除收件箱记录"
                  >
                    <span>删除这条收件箱记录？已创建的任务或日程不会删除。</span>
                    <button type="button" disabled={busy} onClick={() => void remove(item)}>
                      确认删除
                    </button>
                    <button type="button" disabled={busy} onClick={() => setDeleteConfirmId(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="workspace-inbox-delete-link"
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteConfirmId(item.id)}
                  >
                    删除记录
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
