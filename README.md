# 👨🏻‍🎓 DyResearch

Typescript Plugin for a [Multi-Agent AI system](https://github.com/DylanTartarini1996/dyresearch) designed to aid in studying, learning, and researching topics

>[!WARNING]
> 
> To use the DyResearch plugin, the user needs to have the [DyResearch Server](https://github.com/DylanTartarini1996/dyresearch) running. 
> Make sure to either: 
>    - having cloned the repo and started the python server
>    - having downloaded and run the standalone installer  


![enable](https://raw.githubusercontent.com/DylanTartarini1996/dyresearch-obsidian/main/assets/obsidian_enable_plugin.png)

---
## 🧩 Plugin Functionalities

The DyResearch Obsidian plugin bridges your knowledge base with the intelligent backend, providing:

- Intelligent Chat: Engage in multi-turn conversations with specialized agents (Professor, Librarian, Researcher) via a chat interface.
- Knowledge Management: Seamlessly ingest documents into the vector store for RAG-powered retrieval.
- Session Management: Create, rename, delete, and search through your AI chat sessions directly from Obsidian.
- History Sync: Review previous chat history and retrieve context from past interactions.
- Note Taking: Automatically digest information into structured notes with support for Mermaid.js diagrams.

![screen](https://raw.githubusercontent.com/DylanTartarini1996/dyresearch-obsidian/main/assets/obsidian_screen.png)

---

## 🤖 Agents 

A variety of specialized agents using configurable LLMs work together to process requests:

### 👮🏽‍♀️ Coordinator
The central manager that handles incoming requests from the user and delegates tasks to the appropriate specialized agent.

### 👨🏻‍🏫 Professor
Handles specific questions and tutoring queries by drawing from its core knowledge or fetching retrieved context directly from the vector store.

### 👩🏻‍🏫 Librarian
Manages the organization of knowledge within the system. As the owner of the vector store library, the Librarian can:
- Ingest documents and chunk them to organize information in the vector store.
- List available sources by title or index.
- Index different knowledge bases by subject and query them.
- Cleanup the library by deleting chunks of a single file or a complete index.

### 👩🏻‍🔬 Researcher
Autonomously navigates the web to find new information, discover fresh sources, and expand the knowledge base, providing up-to-date context to the rest of the system.

### 🧑🏻‍💻 Note Taker
Responsible for digesting complex information into structured, useful notes specifically formatted for [Obsidian](https://obsidian.md/) or other Markdown tools:
- Takes detailed notes in `.md` format.
- Generates graphs and mind maps using Mermaid.js syntax.

---

## ⚙️ Environment Configuration

If you are running the backend yourself, ensure your `config.env` is configured in the root directory:

```env
# Database Config
POSTGRES_USER=adk_user
POSTGRES_PASSWORD=adk_password
POSTGRES_DB=adk_history

# LLM Providers (Google, Groq, Ollama)
GOOGLE_API_KEY=your_api_key
GROQ_API_KEY=your_api_key
GOOGLE_MODEL_NAME=gemini-3.1-flash-lite-preview

# Embeddings
EMBEDDINGS_TYPE=google
EMBEDDINGS_MODEL_NAME=gemini-embedding-001
```
![settings](https://raw.githubusercontent.com/DylanTartarini1996/dyresearch-obsidian/main/assets/settings.png)
---

## 💻 Local Development

build the plugin after having modified `main.ts` or `styles.css`

```bash
    npm install
    npx tsup main.ts --format cjs --external obsidian
```