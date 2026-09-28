---
created: 2026-09-24T20:13:00+02:00
updated: 2026-09-24T20:27:00+02:00
author: Gemini
---

# Serverless TypeScript Refactor Plan

## Goal Description
This plan outlines the complete migration of the DyResearch backend into the TypeScript Obsidian Plugin using a strict Object-Oriented Programming (OOP) architecture. By embedding the **Google Agent Development Kit (ADK) for TypeScript** natively, we will eliminate the need for an external Python server, PostgreSQL, and vector databases. 

The plugin will handle multi-agent orchestration, store session history locally via JSON files within fixed Vault directories, and utilize the Librarian agent to summarize documents directly into native Obsidian Markdown notes.

## User Review Required
> [!IMPORTANT]
> **API Keys:** API keys for Gemini, OpenAI, or Anthropic will be managed through the plugin's native UI configuration and securely stored in Obsidian's local `data.json` configuration file. Users should be advised not to commit their `.obsidian/plugins/dyresearch-sidecar/data.json` if sharing their Vault publicly.

---

## Proposed Changes

### 1. Dependencies and Configuration
We will add the ADK and LLM SDKs, while removing backend HTTP fetch calls from the settings.

#### [MODIFY] `package.json`
- **Add:** `@google/adk`, `@google/genai`, `openai`, `@anthropic-ai/sdk`, `pdf-parse`.

#### [MODIFY] `src/settings.ts`
- Remove all `fetch('http://localhost:8000/settings')` logic.
- Bind the settings directly to Obsidian's `plugin.settings` state, saving to `data.json`.
- Add Dropdowns to select LLM providers (Gemini, OpenAI, Anthropic) and input API keys per agent.

#### [MODIFY] `src/types.ts`
- Update `DyResearchSettings` to define the schema for storing local API keys and agent model configurations.

---

### 2. The Native Execution Engine (Strict OOP)
We will build the core AI orchestration layer directly inside the plugin, split across multiple specialized files to strictly avoid monolithic design.

#### [NEW] `src/engine/session-service.ts`
- **Class `ObsidianSessionService`**: Implements the ADK's `SessionService` interface.
- Serializes and deserializes chat histories strictly respecting the ADK's native `Session` schemas.
- Saves these JSON files in the fixed Vault directory `DyResearch/Sessions/<session_id>.json`.

#### [NEW] `src/engine/agents/coordinator.ts`, `professor.ts`, `researcher.ts`, `notetaker.ts`
- Instantiate each agent as a distinct class or factory configuration using the TS ADK, ensuring clean separation of concerns.

#### [NEW] `src/engine/agents/librarian.ts`
- Define the `Librarian` agent.
- **New Workflow**: When a user uploads a document (e.g., a PDF), the system will:
  1. Enforce a maximum file size limit (to prevent Electron UI freezing during pure-JS parsing).
  2. Save the raw PDF document natively into the Vault at the fixed directory `DyResearch/Library/`.
  3. Parse the text using `pdf-parse`.
  4. The Librarian summarizes the text.
  5. The Librarian writes a new Markdown note into the Vault containing the summary.
  6. The Markdown note will include YAML frontmatter with a `source_file` property linking directly to the saved raw document in the Vault.

#### [NEW] `src/engine/engine.ts`
- **Class `DyResearchEngine`**: Acts as the central orchestrator and facade.
- Initializes the `ObsidianSessionService` and the Agents based on the user's `data.json` API key settings.
- Exposes clean methods to the UI components: `sendMessage()`, `getSessions()`, `ingestFile()`.

---

### 3. UI Layer Integration
Connect the existing views and modals to the new local OOP Engine instead of a remote server.

#### [MODIFY] `src/views/history-view.ts`
- Replace `fetch('http://localhost:8000/sessions')` with a direct call to `plugin.engine.getSessions()`.
- Replace the HTTP `/ingest` upload with a direct call to `plugin.engine.ingestFile()`, which triggers the Librarian workflow.

#### [MODIFY] `src/modals/chat-modal.ts`
- Replace the custom SSE network streaming with direct execution of `plugin.engine.sendMessage(query)`.
- Use the ADK's native `AsyncGenerator` to stream thinking and response chunks directly to the UI components.

---

## Verification Plan

### Automated Tests
- Run `npm install` and `npm run build` to verify the ADK dependencies compile successfully within the Obsidian `esbuild` configuration.

### Manual Verification
1. Open Obsidian Settings, input a valid API Key, and assign it to the Coordinator agent.
2. Start a new Chat and send a message. Verify the ADK executes locally and streams the response back.
3. Check the Vault (`DyResearch/Sessions/`) to ensure the JSON chat history was successfully created matching ADK schemas.
4. Upload a sample `.pdf` file in the Library tab (ensure it is under the size limit). Verify:
   - The original PDF is saved in `DyResearch/Library/`.
   - A new `.md` summary note is generated.
   - The summary note has YAML frontmatter with `source_file: [[your_pdf_name.pdf]]`.
