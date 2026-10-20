---
name: python-project
description: "Set up and structure Python apps and scripts on Windows: virtual environments, requirements.txt or pyproject.toml, src layout, type hints, logging, CLIs with argparse or Typer, config from env, and running and testing with pytest. Use when the user asks for a Python script, tool, CLI, bot, automation or Python project setup."
---

# Python project

Every project gets its own virtual environment, pinned dependencies and a single obvious way to run it.

## 1. Environment (PowerShell)
```powershell
python --version                  # need 3.10+; use `py -3.12` if several are installed
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install --upgrade pip
python -m pip install requests
```
- Always `python -m pip`, so packages go into the active interpreter.
- Without activating, call `.\.venv\Scripts\python.exe` directly (reliable for run_app commands).
- Add `.venv/`, `__pycache__/`, `.env`, `*.pyc` to `.gitignore`.
- If the project uses uv (`uv.lock` exists): `uv sync`, `uv run python -m app`, `uv add <pkg>`.

## 2. Dependencies
- Scripts/small apps: `requirements.txt` with versions (`requests==2.32.3`), created by
  `python -m pip freeze > requirements.txt` (then trim to direct dependencies), installed with
  `python -m pip install -r requirements.txt`. Dev tools in `requirements-dev.txt`.
- Packages/larger apps: `pyproject.toml`:
```toml
[project]
name = "invoicer"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["typer>=0.12", "httpx>=0.27"]
[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.6"]
[project.scripts]
invoicer = "invoicer.cli:app"
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```
  Install for development: `python -m pip install -e ".[dev]"`.

## 3. Layout
- Single script: `tool.py` with a `main()` and `if __name__ == "__main__": main()`.
- App: `src/invoicer/__init__.py`, `cli.py`, `core.py` (logic, no I/O), `config.py`, `tests/test_core.py`.
  Run with `python -m invoicer` (add `__main__.py`). Avoid `sys.path` hacks.

## 4. Code quality defaults
- Type hints on function signatures; `from __future__ import annotations` for older syntax support.
  Data containers: `@dataclass` (or pydantic models when validating external input).
- `pathlib.Path` for files; `encoding="utf-8"` on every `open()` (Windows defaults to cp1252).
- Format and lint: `python -m pip install ruff`, then `ruff format .` and `ruff check . --fix`.
- Handle expected errors with specific exceptions and clear messages; let unexpected ones crash
  with a traceback during development. Exit with `sys.exit(1)` on failure in CLIs.

## 5. Logging, not print
```python
import logging
log = logging.getLogger(__name__)
def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log.info("processing %d files", len(files))
```
`print` only for the CLI's actual output. `--verbose` flag switches to DEBUG.

## 6. CLIs
- Standard library: `argparse` (no dependency).
- Nicer: Typer (`python -m pip install typer`):
```python
import typer
app = typer.Typer()
@app.command()
def convert(src: Path, out: Path = Path("out.csv"), dry_run: bool = False) -> None:
    """Convert SRC invoice export to CSV."""
    ...
if __name__ == "__main__":
    app()
```
Help text for every command; sensible defaults; confirm before destructive actions.

## 7. Config via environment
- Read secrets and settings from env, loaded from `.env` with `python-dotenv` (`load_dotenv()`) or
  `pydantic-settings` (`class Settings(BaseSettings)`). Provide `.env.example`.
- Fail early with a clear message if a required variable is missing.
- PowerShell: set for a session with `$env:API_KEY = "..."`.

## 8. Testing
`python -m pip install pytest`, tests in `tests/test_*.py`, functions `test_*`, plain `assert`.
Use `tmp_path` for files, `monkeypatch` for env vars, fixtures for shared setup. Run `python -m pytest -q`.
Keep logic in pure functions so most tests need no I/O. See the testing skill for more.

## Check before you finish
1. Fresh install works: new venv, `python -m pip install -r requirements.txt` (or `-e .`), then run.
2. Run the program on a real example (run_app or the shell) and quote the output.
3. `python -m pytest -q` passes; `ruff check .` clean if ruff is used.
4. README or reply states the exact commands to install and run.

## Common mistakes
- Installing into the global Python; forgetting to activate the venv in a new shell.
- Unpinned requirements; mixing `pip` and `python -m pip` for different interpreters.
- Hard-coded absolute Windows paths; files opened without `encoding`.
- Business logic inside the CLI function, so it cannot be tested.
