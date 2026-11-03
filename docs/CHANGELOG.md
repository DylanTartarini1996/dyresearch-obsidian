# Changelog

## [2.0.0] - Serverless Architecture Refactor
This major release completely overhauls the underlying architecture of DyResearch, migrating from a client-server model dependent on a Python backend to a 100% native, serverless Obsidian plugin powered by the Google Agent Development Kit (ADK) in TypeScript.

### Added
- Native Google ADK (`@google/adk`) integration bundled directly within the plugin.
- Direct execution of the Multi-Agent framework (`Coordinator`, `Professor`, `Librarian`, `Researcher`, `NoteTaker`) directly inside the local Electron environment.
- Native filesystem persistence for chat sessions (saving as Markdown inside `DyResearch/Sessions/`).
- Local document library tracking (saving uploaded documents and summaries to `DyResearch/Library/`).
- Native DuckDuckGo web search integration using Obsidian's `requestUrl` to bypass CORS.
- Settings UI now securely manages and stores API keys locally in `data.json`.

### Changed
- Refactored `ChatModal` to use the ADK's native `AsyncGenerator` for streaming LLM responses rather than parsing Server-Sent Events (SSE) over HTTP.
- Refactored `HistoryView` to natively read, display, and paginate through local Markdown session files instead of making REST calls.
- Upgraded the build pipeline to use `esbuild` for faster, robust bundling of native dependencies (replacing `tsup`).

### Removed
- Removed all dependencies on the external Python FastAPI server.
- Removed SQLite / PostgreSQL requirement for session state.
- Removed LanceDB / Vector store requirements (RAG is now performed natively against the Vault's markdown files).
- Stripped all `fetch()` HTTP calls to `localhost:8000` from the frontend codebase.
