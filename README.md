# 👨🏻‍🎓 DyResearch

A powerful, **serverless** Multi-Agent AI research system designed to aid in studying, learning, and managing academic literature and personal knowledge directly inside Obsidian.

> [!TIP]
> **DyResearch 2.0 is 100% Serverless & Multi-Platform!**
> You no longer need an external Python backend, vector database, or local server. The entire multi-agent brain runs natively inside Obsidian across **macOS, Windows, Linux, iPad, and iPhone** using the Google Agent Development Kit (ADK) and Obsidian's native APIs.

---

## ✨ Key Capabilities

- **Intelligent Autonomous Multi-Agent Team**:
  Collaborative team of specialized agents (Coordinator, Professor, Librarian, Researcher, NoteTaker) cooperating to teach, synthesize, investigate, and organize your knowledge base.
- **Multi-Provider LLM Engine**:
  Mix and match AI models per agent across **Google Gemini, OpenAI, Anthropic Claude, OpenRouter, and Groq** with full tool-calling and autonomous agent transfer.
- **Two-Tier Smart Library Architecture**:
  - `DyResearch/Library/<Topic>/`: Stores raw binary `.pdf` and `.docx` files organized into clean, field-agnostic topic subfolders.
  - `DyResearch/Library Index/`: Stores clean, structured Markdown index cards containing YAML frontmatter, abstracts, chapter/section outlines, and conclusions.
- **Smart Document Upload & Auto-Indexing**:
  - Supports **Academic Papers, Textbooks & Books, and General Documents** of any file size.
  - Fast outline & front-matter extraction allows even 1,000-page textbooks to index rapidly.
  - Automatically infers titles and authors from document headers and deduplicates author names.
  - Automatically matches and reuses existing topic subfolders consistently across your vault.
- **On-Demand Deep PDF Reading**:
  The Professor agent can query specific pages or search mathematical formulas and sections on-the-fly directly from linked raw PDFs without blowing up context window tokens.
- **Interactive Library Search & Filtering**:
  Real-time filtering in the sidebar by **Document Kind** (`Paper`, `Book`, `Document`), **Topic**, **Author(s)**, or search keywords, with 1-click filter chips.
- **Obsidian-Safe Mermaid Diagrams & Mind Maps**:
  The NoteTaker proactively illustrates concepts using native Obsidian ```` ```mermaid ```` diagrams (`mindmap`, `flowchart TD`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`) with automatic syntax sanitization and valid kebab-case tags.
- **Persistent Sessions & Rename Anytime**:
  Research sessions are stored as readable Markdown notes in `DyResearch/Sessions/`. Rename sessions on-the-fly directly from the chat header or history panel; conversation memory and agent states persist seamlessly.
- **Flexible Workspace Modes**:
  Dock the research panel directly in Obsidian's right sidebar or pop it out into a resizable, draggable floating window.

---

## 🤖 The DyResearch Agent Team

A specialized team of autonomous agents using configurable LLMs working together in your vault:

### 👮🏽‍♀️ Coordinator
The executive manager assessing your goals, routing queries to the right specialist, and overseeing multi-step workflows.

### 👨🏻‍🏫 Professor
The lead educator and subject-matter tutor. Searches your personal Vault notes first (*Vault-First principle*), queries the Library Index, and reads targeted passages from raw PDFs on demand to explain theorems, formulas, and concepts.

### 👩🏻‍🏫 Librarian
The vault archivist. Organizes raw documents into topic subfolders, ensures taxonomy consistency, normalizes author names, and maintains structured index cards.

### 👩🏻‍🔬 Researcher
The academic investigator. Autonomously searches arXiv and the web to find papers, verify publication metadata, and retrieve missing bibliography details.

### 🧑🏻‍💻 NoteTaker
The Second-Brain architect. Synthesizes lessons into structured "Evergreen" notes complete with Obsidian callouts, `[[Wikilinks]]`, and Obsidian-safe Mermaid mind maps and flowcharts.

---

## 🌐 Supported LLM Providers

Configure different models for each agent in the plugin settings. 

> [!NOTE]
> The models listed below are **only examples of recommended and popular choices**. DyResearch is model-agnostic: you can type **any valid model identifier** supported by your chosen provider directly into the Model field (including newly released model versions).

| Provider | Representative Models *(Examples only)* | Setup |
| :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.1-pro`, `gemini-3.8-flash` | Free API key from [Google AI Studio](https://aistudio.google.com/) |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `o1`, `gpt-4.1` | API key from [OpenAI Platform](https://platform.openai.com/) |
| **Anthropic Claude** | `claude-sonnet-4-20250514`, `claude-3-7-sonnet`, `claude-3-5-haiku` | API key from [Anthropic Console](https://console.anthropic.com/) |
| **OpenRouter** | `meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-chat`, `qwen/qwen-2.5-72b-instruct` *(any OpenRouter model ID)* | Free & paid models from [OpenRouter](https://openrouter.ai/) |
| **Groq** | `llama-3.3-70b-versatile`, `deepseek-r1-distill-llama-70b`, `qwen-qwq-32b` | Ultra-fast free-tier keys from [Groq Console](https://console.groq.com/) |

---

## 📱 Mobile Support

DyResearch is built entirely using Obsidian's public `app.vault`, `app.vault.adapter`, and `requestUrl` APIs:
- **No Node.js or Electron dependencies** are bundled in the runtime.
- **Works on iPad and iPhone** without additional configuration.
- Supports both the docked slide-out panel on mobile and Obsidian Sync / iCloud sync.

---

## ⚙️ Installation & Setup

### Manual Installation
1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/DylanTartarini1996/dyresearch-obsidian/releases) page.
2. In your Obsidian vault, navigate to `.obsidian/plugins/` and create a folder named `dyresearch-sidecar`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Reload Obsidian, go to **Settings → Community Plugins**, and enable **DyResearch AI Sidecar**.

### Configuration
1. Open **Settings → DyResearch AI Sidecar**.
2. Enter your API key(s) (Gemini, OpenAI, Anthropic, OpenRouter, or Groq).
3. Select your desired Provider and Model for each of the 5 agents.
4. Open the DyResearch ribbon icon or command palette to begin researching!

---

## 💻 Local Development

```bash
# Clone into your vault plugins directory
git clone https://github.com/DylanTartarini1996/dyresearch-obsidian
cd dyresearch-obsidian

# Install dependencies
npm install

# Start development watcher
npm run dev

# Run automated engine & PDF test suite
npm test

# Build optimized production bundle
npm run build
```

---
