// New projects from the welcome screen: a folder under "V-Run Projects" with a small starter in it, so a
// first-time user has something running in one click instead of an empty folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Starter = { id: string; title: string; about: string; files: Record<string, string>; ask?: string };

export const STARTERS: Starter[] = [
  {
    id: "empty", title: "Empty folder", about: "Start from nothing and tell the agent what to build.", files: {},
  },
  {
    id: "website", title: "Website", about: "HTML, CSS and JavaScript — no build step. Opens in the preview.",
    ask: "Turn this starter into the website I describe next.",
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello 👋</h1>
    <p>Edit <code>index.html</code>, or ask V-Run to build something here.</p>
    <button id="count">Clicked 0 times</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
      "style.css": `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
main { max-width: 36rem; padding: 2rem; text-align: center; }
button { font: inherit; padding: .6rem 1.2rem; border-radius: .5rem; border: 1px solid currentColor; background: none; cursor: pointer; }
`,
      "script.js": `let n = 0;
const button = document.getElementById("count");
button.addEventListener("click", () => { n++; button.textContent = \`Clicked \${n} time\${n === 1 ? "" : "s"}\`; });
`,
    },
  },
  {
    id: "node-api", title: "Node.js API", about: "A small JSON API with no dependencies (node server.js).",
    ask: "Extend this API the way I describe next.",
    files: {
      "package.json": `{\n  "name": "my-api",\n  "private": true,\n  "type": "module",\n  "scripts": { "start": "node server.js", "test": "node --test" }\n}\n`,
      "server.js": `import http from "node:http";

const items = [{ id: 1, name: "First item" }];

const server = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/items") return send(200, items);
  if (req.method === "POST" && req.url === "/items") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const name = JSON.parse(raw || "{}").name;
    if (!name) return send(400, { error: "name is required" });
    const item = { id: items.length + 1, name };
    items.push(item);
    return send(201, item);
  }
  send(404, { error: "not found" });
});

const port = Number(process.env.PORT) || 3001;
server.listen(port, () => console.log(\`API on http://localhost:\${port}/items\`));
`,
    },
  },
  {
    id: "python", title: "Python script", about: "A Python script with a test (python main.py).",
    ask: "Turn this into the Python program I describe next.",
    files: {
      "main.py": `def greet(name: str) -> str:
    return f"Hello, {name}!"


if __name__ == "__main__":
    print(greet("world"))
`,
      "test_main.py": `from main import greet


def test_greet():
    assert greet("V-Run") == "Hello, V-Run!"
`,
    },
  },
];

/** Where new projects go: VRUN_PROJECTS_DIR, else Documents/V-Run Projects. */
export const projectsHome = () => process.env.VRUN_PROJECTS_DIR || path.join(os.homedir(), "Documents", "V-Run Projects");

/** A safe folder name from what the user typed (characters Windows forbids are dropped). */
export function folderName(name: string) {
  const n = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n) ? `${n}-project` : n;
}

/** Creates the project folder with the starter's files; a name already taken gets " 2", " 3"… */
export function createProject(name: string, starterId: string, home = projectsHome()) {
  const starter = STARTERS.find((s) => s.id === starterId);
  if (!starter) throw new Error(`Unknown starter: ${starterId}`);
  const base = folderName(name);
  if (!base) throw new Error("Give the project a name.");
  fs.mkdirSync(home, { recursive: true });
  let dir = path.join(home, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(home, `${base} ${i}`);
  fs.mkdirSync(dir);
  for (const [rel, text] of Object.entries(starter.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return { dir, ask: starter.ask ?? null };
}
