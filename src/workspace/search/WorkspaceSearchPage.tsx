import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadWorkspaceSearchIndex,
  searchWorkspaceIndex,
  workspaceSearchUnavailableMessage,
} from "../../application/workspace/search.ts";
import { createWorkspaceHomeTarget } from "../../navigation/navigation.ts";
import type { NavigationTarget } from "../../navigation/types.ts";
import type { WorkspaceSearchIndexLoad } from "../../application/workspace/search.ts";
import "./workspace-search.css";

interface WorkspaceSearchPageProps {
  readonly onNavigate: (target: NavigationTarget) => void;
}

export function WorkspaceSearchPage({ onNavigate }: WorkspaceSearchPageProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<WorkspaceSearchIndexLoad | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const loadStarted = useRef(false);
  const normalizedQuery = query.trim();
  const results = useMemo(
    () => (index ? searchWorkspaceIndex(query, index.records) : []),
    [index, query],
  );

  useEffect(() => {
    if (!normalizedQuery || index || loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    setError("");
    void loadWorkspaceSearchIndex()
      .then((loaded) => {
        setIndex(loaded);
      })
      .catch(() => {
        loadStarted.current = false;
        setError("无法读取本地搜索内容，请稍后重试。");
      })
      .finally(() => setLoading(false));
  }, [index, normalizedQuery, retryCount]);

  function retrySearch() {
    loadStarted.current = false;
    setRetryCount((count) => count + 1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") onNavigate(createWorkspaceHomeTarget());
  }

  return (
    <section className="workspace-search-page" aria-labelledby="workspace-search-title">
      <header className="workspace-search-header">
        <div>
          <p className="workspace-search-eyebrow">本机搜索</p>
          <h2 id="workspace-search-title">搜索工作台内容</h2>
          <p>仅搜索此设备上的课程、任务、日程、考试、日记和收件箱内容。</p>
        </div>
        <button
          type="button"
          className="workspace-search-back"
          onClick={() => onNavigate(createWorkspaceHomeTarget())}
        >
          返回工作台
        </button>
      </header>

      <label className="workspace-search-field">
        <span className="workspace-search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          aria-label="搜索本机内容"
          placeholder="输入课程、任务、日程或文字…"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
            清除
          </button>
        )}
      </label>

      {!normalizedQuery ? (
        <p className="workspace-search-state">
          输入关键词开始搜索。搜索内容不会上传或保存为历史记录。
        </p>
      ) : loading ? (
        <p className="workspace-search-state" role="status">
          正在读取本机内容…
        </p>
      ) : error ? (
        <div className="workspace-search-state workspace-search-state--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={retrySearch}>
            重试
          </button>
        </div>
      ) : results.length === 0 ? (
        <>
          {index?.unavailableProviderIds.length ? (
            <p className="workspace-search-state" role="status">
              {workspaceSearchUnavailableMessage(index.unavailableProviderIds)}
            </p>
          ) : null}
          <p className="workspace-search-state" role="status">
            没有找到相关内容。
          </p>
        </>
      ) : (
        <div className="workspace-search-results">
          {index?.unavailableProviderIds.length ? (
            <p className="workspace-search-state" role="status">
              {workspaceSearchUnavailableMessage(index.unavailableProviderIds)}
            </p>
          ) : null}
          <p className="workspace-search-count" role="status">
            找到 {results.length} 条{results.length === 50 ? "（最多显示 50 条）" : ""}
          </p>
          <ul className="workspace-search-result-list" aria-label="搜索结果">
            {results.map((result) => (
              <li key={`${result.category}:${result.id}`}>
                <button
                  type="button"
                  className="workspace-search-result"
                  data-search-category={result.category}
                  data-object-type={result.target.object?.type ?? ""}
                  onClick={() => onNavigate(result.target)}
                >
                  <span className="workspace-search-result-main">
                    <strong>{result.title}</strong>
                    {result.summary && <span>{result.summary}</span>}
                  </span>
                  <span className="workspace-search-category">{result.categoryLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
