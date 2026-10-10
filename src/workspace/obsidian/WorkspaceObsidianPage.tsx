import { useEffect, useState } from "react";
import { getObsidianVault, openObsidian, type ObsidianAction } from "../../services/obsidian.ts";
import type { AppRoute } from "../../navigation/types.ts";
import "./workspace-obsidian.css";

interface Props {
  readonly onNavigate: (route: AppRoute) => void;
}

export function WorkspaceObsidianPage({ onNavigate }: Props) {
  const [vault, setVault] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<ObsidianAction | null>(null);

  useEffect(() => {
    let mounted = true;
    void getObsidianVault()
      .then((value) => {
        if (mounted) setVault(value);
      })
      .catch((reason: unknown) => {
        if (mounted) setError(String(reason));
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function open(action: ObsidianAction) {
    if (busy || !vault) return;
    setBusy(action);
    setError("");
    try {
      await openObsidian(action);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="workspace-obsidian-page" aria-labelledby="workspace-obsidian-title">
      <header className="workspace-obsidian-heading">
        <div>
          <button
            type="button"
            className="workspace-obsidian-back"
            onClick={() => onNavigate({ area: "workspace", page: "home" })}
          >
            工作台 <span aria-hidden="true">›</span> Obsidian
          </button>
          <h2 id="workspace-obsidian-title">Obsidian</h2>
          <p>笔记在 Obsidian 中记录与同步，工作台只提供快捷入口。</p>
        </div>
      </header>
      <div className="workspace-obsidian-panel">
        <div className="workspace-obsidian-vault">
          <h3>我的知识库</h3>
          <p>{vault ?? (error ? "暂未连接" : "正在检查 Obsidian 知识库…")}</p>
        </div>
        <div className="workspace-obsidian-actions">
          <button type="button" onClick={() => void open("vault")} disabled={!vault || !!busy}>
            打开 Obsidian
          </button>
          <button type="button" onClick={() => void open("daily")} disabled={!vault || !!busy}>
            打开每日笔记
          </button>
          <button type="button" onClick={() => void open("inbox")} disabled={!vault || !!busy}>
            查找 00 收集箱
          </button>
        </div>
        {error && (
          <p className="workspace-obsidian-error" role="alert">
            {error}
          </p>
        )}
        <p className="workspace-obsidian-note">
          不会复制、修改或删除 Obsidian 笔记；原 Links 历史日记数据仍保留在本地数据库中。
        </p>
      </div>
    </section>
  );
}
