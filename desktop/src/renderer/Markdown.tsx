// Safe Markdown → React (no HTML from the model is ever injected): headings, lists, quotes, tables, rules,
// fenced code with Monaco syntax colouring + copy, inline code / bold / italic / strike / links.
// Inline code that names a project file (`src/app.ts:12`) becomes a link that opens it.
import { createContext, Fragment, memo, useContext, useEffect, useState, type ReactNode } from "react";
import { languageOf, monaco } from "./monaco";

export const OpenFileContext = createContext<((path: string, line?: number) => void) | null>(null);

type Block =
  | { t: "code"; lang: string; text: string; open: boolean }
  | { t: "h"; level: number; text: string }
  | { t: "hr" }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; align: ("left" | "right" | "center" | undefined)[]; rows: string[][] }
  | { t: "list"; items: ListItem[]; ordered: boolean; start: number }
  | { t: "p"; text: string };
type ListItem = { text: string; children: ListItem[]; ordered: boolean; task?: boolean; done?: boolean };

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      out.push({ t: "code", lang: fence[2].toLowerCase(), text: body.join("\n"), open: i >= lines.length });
      i++;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) { out.push({ t: "h", level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: q.join("\n") });
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ t: "table", head, align, rows });
      continue;
    }
    if (LIST_RE.test(line)) {
      // collect the list (items, nested items, indented continuation lines) and build a tree by indent
      const root: ListItem[] = [];
      const stack: { indent: number; items: ListItem[] }[] = [{ indent: -1, items: root }];
      const first = line.match(LIST_RE)!;
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (m) {
          const indent = m[1].replace(/\t/g, "  ").length;
          while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
          const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
          const item: ListItem = { text: task ? task[2] : m[3], children: [], ordered: /\d/.test(m[2]), task: !!task, done: task ? task[1] !== " " : undefined };
          stack[stack.length - 1].items.push(item);
          stack.push({ indent, items: item.children });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && stack.length > 1) {
          const parent = stack[stack.length - 2].items;
          parent[parent.length - 1].text += " " + lines[i].trim();
          i++;
        } else if (!lines[i].trim() && LIST_RE.test(lines[i + 1] ?? "")) i++;
        else break;
      }
      out.push({ t: "list", items: root, ordered: /\d/.test(first[2]), start: parseInt(first[2]) || 1 });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !(para.length && LIST_RE.test(lines[i]))) para.push(lines[i++]);
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)|(?<!\w)_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const FILE_REF = /^([\w.@/\\-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?:[-:]\d+)?)?$/;

function Inline({ text }: { text: string }) {
  const open = useContext(OpenFileContext);
  const nodes: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) nodes.push(<Lines key={k++} text={text.slice(last, m.index)} />);
    last = m.index! + m[0].length;
    if (m[2] !== undefined) {
      const ref = open && m[2].match(FILE_REF);
      nodes.push(ref && ref[1].includes("/") || ref && ref[2]
        ? <code key={k++} className="file-ref" role="link" tabIndex={0} title={`Open ${ref[1]}`}
            onClick={() => open!(ref[1].replace(/\\/g, "/"), ref[2] ? +ref[2] : undefined)}
            onKeyDown={(e) => e.key === "Enter" && open!(ref[1].replace(/\\/g, "/"), ref[2] ? +ref[2] : undefined)}>{m[2]}</code>
        : <code key={k++}>{m[2]}</code>);
    } else if (m[3] ?? m[4]) nodes.push(<strong key={k++}><Inline text={m[3] ?? m[4]} /></strong>);
    else if (m[5]) nodes.push(<del key={k++}><Inline text={m[5]} /></del>);
    else if (m[6] ?? m[7]) nodes.push(<em key={k++}><Inline text={m[6] ?? m[7]} /></em>);
    else if (m[8]) nodes.push(<a key={k++} href={m[9]} target="_blank" rel="noreferrer">{m[8]}</a>);
    else if (m[10]) nodes.push(<a key={k++} href={m[10]} target="_blank" rel="noreferrer">{m[10]}</a>);
  }
  if (last < text.length) nodes.push(<Lines key={k++} text={text.slice(last)} />);
  return <>{nodes}</>;
}
const Lines = ({ text }: { text: string }) => <>{text.split("\n").map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</>;

function List({ items, ordered, start }: { items: ListItem[]; ordered: boolean; start?: number }) {
  const body = items.map((it, i) => (
    <li key={i} className={it.task ? "task" : undefined}>
      {it.task && <input type="checkbox" checked={it.done} readOnly tabIndex={-1} />}
      <Inline text={it.text} />
      {it.children.length > 0 && <List items={it.children} ordered={it.children[0].ordered} />}
    </li>
  ));
  return ordered ? <ol start={start}>{body}</ol> : <ul>{body}</ul>;
}

const LANG_ALIAS: Record<string, string> = { sh: "shell", bash: "shell", zsh: "shell", console: "shell", ps: "powershell", ps1: "powershell", pwsh: "powershell", py: "python", js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", yml: "yaml", md: "markdown", rs: "rust", rb: "ruby", "c++": "cpp", cs: "csharp", golang: "go" };
function monacoLang(lang: string) {
  if (!lang) return "plaintext";
  const id = LANG_ALIAS[lang] ?? lang;
  if (monaco.languages.getLanguages().some((l) => l.id === id)) return id;
  return languageOf(`x.${lang}`);
}

export const CodeBlock = memo(function CodeBlock({ lang, text, streaming }: { lang: string; text: string; streaming?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    // colourise once the block stops changing (streamed blocks would otherwise re-tokenise every delta)
    const t = setTimeout(() => {
      monaco.editor.colorize(text, monacoLang(lang), { tabSize: 2 }).then((h) => live && setHtml(h)).catch(() => {});
    }, streaming ? 400 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [text, lang, streaming]);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return (
    <div className="codeblock">
      <div className="codeblock-head"><span>{lang || "text"}</span><button className="icon-btn" onClick={copy} aria-label="Copy code">{copied ? "Copied" : "Copy"}</button></div>
      {/* Monaco's colorize output escapes the source text, so it is safe to inject */}
      {html !== null ? <pre dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{text}</pre>}
    </div>
  );
});

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = parse(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "code": return <CodeBlock key={i} lang={b.lang} text={b.text} streaming={streaming && b.open} />;
          case "h": { const H = `h${Math.min(6, b.level + 2)}` as "h3"; return <H key={i}><Inline text={b.text} /></H>; }
          case "hr": return <hr key={i} />;
          case "quote": return <blockquote key={i}><Markdown text={b.text} /></blockquote>;
          case "list": return <List key={i} items={b.items} ordered={b.ordered} start={b.start} />;
          case "table": return (
            <div key={i} className="md-table"><table>
              <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: b.align[j] }}><Inline text={c} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{b.head.map((_, x) => <td key={x} style={{ textAlign: b.align[x] }}><Inline text={r[x] ?? ""} /></td>)}</tr>)}</tbody>
            </table></div>
          );
          case "p": return <p key={i}><Inline text={b.text} /></p>;
        }
      })}
    </div>
  );
});
