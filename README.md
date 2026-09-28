# 👨🏻‍🎓 DyResearch

A powerful, **serverless** Multi-Agent AI system designed to aid in studying, learning, and researching topics directly inside Obsidian.

> [!TIP]
> **DyResearch 2.0 is now 100% Serverless!**
> You no longer need to run a separate Python server, SQLite database, or Vector store. The entire multi-agent brain runs natively inside Obsidian using the Google Agent Development Kit (ADK).

---
## 🧩 Functionalities

The DyResearch Obsidian plugin bridges your knowledge base with an intelligent, local multi-agent system:

- **Intelligent Chat**: Engage in multi-turn conversations with specialized agents (Professor, Librarian, Researcher, NoteTaker) via a seamless chat interface.
- **Local RAG**: The AI directly reads and searches your local Obsidian Vault.
- **Session Management**: Chat sessions are persisted as JSON files natively in the `DyResearch/Sessions/` folder. Create, rename, delete, and search them directly.
- **Library Ingestion**: Upload documents (up to 5MB) into your knowledge base. The Librarian organizes them in `DyResearch/Library/`.
- **Note Taking**: Automatically digest information into structured notes with support for Mermaid.js diagrams and Semantic Backlinks.

---

## 🤖 Agents 

A variety of specialized agents using configurable LLMs work together to process requests natively:

### 👮🏽‍♀️ Coordinator
The central manager that assesses your request and delegates tasks to the appropriate specialized expert using advanced workflow patterns.

### 👨🏻‍🏫 Professor
Handles specific questions and tutoring queries by drawing from your local Obsidian notes (Vault First) and expanding out to external sources only when necessary.

### 👩🏻‍🏫 Librarian
Manages the organization of knowledge within the system. The Librarian automatically parses uploaded files, categorizes them by subject, and indexes them into the `DyResearch/Library/` folder.

### 👩🏻‍🔬 Researcher
Autonomously navigates the web using secure local proxies to find new information, scrape websites, and expand your knowledge base.

### 🧑🏻‍💻 Note Taker
Responsible for digesting complex information into structured, useful "Evergreen" notes specifically formatted for Obsidian. It natively handles `[[Backlinks]]` and Vault organization.

---

## ⚙️ Setup
Setup is incredibly simple now that the system is fully serverless.

### ✅ Enable Plugin

Install the plugin via the community portal (or manually copy the release folder) and enable it in Obsidian's settings.

### 🔧 Configuration

All configurations are managed locally and securely inside Obsidian:
1. Open the **DyResearch** settings page within Obsidian.
2. Select your preferred LLM provider for each agent (Gemini, OpenAI, Anthropic).
3. Insert your API keys directly into the settings UI. They will be stored securely in your local `data.json`.
4. Close the settings. The Engine will instantly initialize and be ready to use!

---

## 💻 Local Development

To develop and test the plugin locally:

1. Clone this repository into your Obsidian Vault's `.obsidian/plugins/` directory.
2. Run `npm install` to install the dependencies (including the Google ADK).
3. Run `npm run dev` to start the `esbuild` watcher. This will automatically recompile the plugin whenever you save a file.
4. Reload the plugin in Obsidian to see your changes instantly.

To build for production:
```bash
npm run build
```
This will compile a highly optimized `main.js` bundle using `esbuild`.
