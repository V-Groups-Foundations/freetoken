import Monaco, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { Logo } from "./Logo";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { languageOf, monaco } from "./monaco";

export interface Tab { path: string; text: string; saved: string }
export interface Review { path: string; original: string; current: string }
export interface Selection { path: string; start: number; end: number; text: string }

type Ed = monaco.editor.IStandaloneCodeEditor;

export function EditorArea(props: {
  tabs: Tab[]; active: string | null; review: Review | null;
  onSelect: (p: string) => void; onClose: (p: string) => void; onChange: (p: string, text: string) => void;
  onSave: (p: string) => void; onAddToChat: (s: Selection) => void;
  onAcceptReview: (p: string) => void; onRejectReview: (p: string) => void; onCloseReview: () => void;
  revealLine?: { path: string; line: number; nonce: number } | null;
}) {
  const { tabs, active, review } = props;
  const tab = tabs.find((t) => t.path === active);
  const edRef = useRef<Ed | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [cmdk, setCmdk] = useState<null | { start: number; end: number; instruction: string; busy: boolean; error?: string; result?: { replacement: string; original: string } }>(null);

  const onMount: OnMount = (ed) => { edRef.current = ed; };

  // Ctrl+K / Ctrl+L in the capture phase: Monaco claims Ctrl+K as a chord prefix and would
  // otherwise swallow it before an editor command or bubbling listener sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "k" && k !== "l") return;
      const ed = edRef.current;
      if (!ed || !ed.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      const sel = ed.getSelection();
      const model = ed.getModel();
      const p = latest.current.active;
      if (!sel || !model || !p) return;
      if (k === "k") {
        const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
        setCmdk({ start: sel.startLineNumber, end, instruction: "", busy: false });
      } else {
        const text = sel.isEmpty() ? "" : model.getValueInRange(sel);
        latest.current.onAddToChat({ path: p, start: sel.startLineNumber, end: sel.endLineNumber, text });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => { setCmdk(null); }, [active]);
  useEffect(() => {
    const r = props.revealLine;
    if (!r || r.path !== active || !edRef.current) return;
    const ed = edRef.current;
    setTimeout(() => { ed.revealLineInCenter(r.line); ed.setPosition({ lineNumber: r.line, column: 1 }); ed.focus(); }, 30);
  }, [props.revealLine, active]);

  async function runCmdK() {
    if (!cmdk || !tab || !cmdk.instruction.trim()) return;
    setCmdk({ ...cmdk, busy: true, error: undefined });
    try {
      const result = await api.cmdK({ path: tab.path, language: languageOf(tab.path), fileText: edRef.current?.getValue() ?? tab.text,
        start: cmdk.start, end: cmdk.end, instruction: cmdk.instruction });
      setCmdk((c) => c && { ...c, busy: false, result });
    } catch (e) {
      setCmdk((c) => c && { ...c, busy: false, error: (e as Error).message });
    }
  }
  function acceptCmdK() {
    const ed = edRef.current, model = ed?.getModel();
    if (!ed || !model || !cmdk?.result) return;
    const range = new monaco.Range(cmdk.start, 1, cmdk.end, model.getLineMaxColumn(cmdk.end));
    ed.pushUndoStop();
    ed.executeEdits("cmdk", [{ range, text: cmdk.result.replacement }]);
    ed.pushUndoStop();
    setCmdk(null);
    ed.focus();
  }

  if (review) {
    return (
      <section className="editor-area" aria-label="Review change">
        <div className="review-head">
          <span>Review: <b>{review.path}</b> <span className="muted">(left: before agent · right: now)</span></span>
          <span className="spacer" />
          <button className="btn" onClick={() => props.onRejectReview(review.path)}>Reject</button>
          <button className="btn primary" onClick={() => props.onAcceptReview(review.path)}>Accept</button>
          <button className="btn ghost" aria-label="Close review" onClick={props.onCloseReview}>✕</button>
        </div>
        <DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel theme="cursor-dark" original={review.original} modified={review.current} language={languageOf(review.path)}
          options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13 }} />
      </section>
    );
  }

  return (
    <section className="editor-area" aria-label="Editor">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <div key={t.path} role="tab" aria-selected={t.path === active} className={`tab${t.path === active ? " active" : ""}`}
            title={t.path} onClick={() => props.onSelect(t.path)} onAuxClick={(e) => e.button === 1 && props.onClose(t.path)}>
            <span className="tab-name">{t.path.split("/").pop()}</span>
            <button className="tab-close" aria-label={`Close ${t.path}`} onClick={(e) => { e.stopPropagation(); props.onClose(t.path); }}>
              {t.text !== t.saved ? "●" : "✕"}
            </button>
          </div>
        ))}
      </div>
      {tab ? (
        <div className="editor-wrap">
          <Monaco theme="cursor-dark" path={tab.path} defaultLanguage={languageOf(tab.path)} value={tab.text} onMount={onMount}
            onChange={(v) => props.onChange(tab.path, v ?? "")}
            options={{ fontSize: 13, minimap: { enabled: true }, inlineSuggest: { enabled: true }, automaticLayout: true,
              scrollBeyondLastLine: false, tabSize: 2, renderWhitespace: "selection", smoothScrolling: true }} />
          {cmdk && (
            <div className="cmdk" role="dialog" aria-label="Edit selection with AI">
              {!cmdk.result ? (
                <>
                  <div className="cmdk-head">Edit lines {cmdk.start}–{cmdk.end} <span className="muted">Ctrl+K</span></div>
                  <input autoFocus className="cmdk-input" placeholder="Describe the change, e.g. add error handling" value={cmdk.instruction}
                    disabled={cmdk.busy} onChange={(e) => setCmdk({ ...cmdk, instruction: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") runCmdK(); if (e.key === "Escape") { setCmdk(null); edRef.current?.focus(); } }} />
                  {cmdk.busy && <div className="muted">Generating…</div>}
                  {cmdk.error && <div className="error" role="alert">{cmdk.error}</div>}
                </>
              ) : (
                <>
                  <div className="cmdk-head">Proposed edit <span className="spacer" />
                    <button className="btn" onClick={() => setCmdk(null)}>Reject <span className="muted">Esc</span></button>
                    <button className="btn primary" onClick={acceptCmdK} autoFocus onKeyDown={(e) => e.key === "Escape" && setCmdk(null)}>Accept</button>
                  </div>
                  <div className="cmdk-diff">
                    <DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel theme="cursor-dark" original={cmdk.result.original} modified={cmdk.result.replacement} language={languageOf(tab.path)}
                      options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="empty-editor">
          <div>
            <Logo size={72} />
            <h2>V-Run</h2>
            <p className="muted">Ctrl+P open file · Ctrl+K edit selection · Ctrl+L add to chat · Tab accept suggestion</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** Current text of a file's Monaco model — the source of truth (React state lags one change event). */
export function liveText(path: string): string | undefined {
  const m = monaco.editor.getModels().find((x) => decodeURIComponent(x.uri.path).replace(/^\//, "") === path);
  return m?.getValue();
}

/** Tab ghost-text completions (Cursor Tab / CppService). */
export function registerTabCompletions(enabled: () => boolean) {
  let seq = 0;
  return monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, {
    async provideInlineCompletions(model, position, _ctx, token) {
      if (!enabled()) return { items: [] };
      const id = String(++seq);
      await new Promise((r) => setTimeout(r, 350)); // debounce typing
      if (token.isCancellationRequested || id !== String(seq)) return { items: [] };
      const full = model.getValue();
      const offset = model.getOffsetAt(position);
      const path = decodeURIComponent(model.uri.path.replace(/^\//, ""));
      try {
        const text = await api.complete(id, { path, language: model.getLanguageId(), prefix: full.slice(0, offset), suffix: full.slice(offset) });
        if (!text || token.isCancellationRequested) return { items: [] };
        return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
      } catch { return { items: [] }; }
    },
    disposeInlineCompletions() {},
  });
}
