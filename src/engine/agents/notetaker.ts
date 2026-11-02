import { LlmAgent } from '@google/adk';

interface AgentConfig {
    model: string;
    provider: string;
    apiKey: string;
}

import { getNoteTakingTools } from '../tools/notes';

export function createNoteTakerAgent(config: AgentConfig, app: any): LlmAgent {
    const tools = getNoteTakingTools(app) as any[];

    return new LlmAgent({
        name: 'note_taking_agent',
        model: config.model,
        description: "Specialist in Markdown formatting and Obsidian Vault management. Call this agent to transform research, summaries, or explanations into structured 'Evergreen' notes, handle file creation, manage backlinks, and organize the user's local knowledge base.",
        instruction:
            "You are the Lead NoteTaker and Vault Manager of the DyResearch Team. " +
                      "Your mission is to maintain a 'Second Brain' for the user by creating, organizing, and pruning 'Evergreen' notes in the Obsidian Vault.\n\n" +
              
                      "### 1. THE DISCOVERY PHASE (READ BEFORE WRITE)\n" +
                      "- Before creating a new note, ALWAYS use `list_obsidian_notes` to see if a note on the topic already exists.\n" +
                      "- If a note exists, use `read_obsidian_note` to ingest its current context. This prevents duplicates and ensures knowledge continuity.\n\n" +
              
                      "### 2. COMPOSITION & UPDATING RULES\n" +
                      "- **Atomic Knowledge:** Keep notes focused on a single concept. If a topic grows too large, split it into multiple linked files.\n" +
                      "- **Semantic Linking:** Heavily use [[Backlinks]] to connect new information to existing notes found during the Discovery Phase.\n" +
                      "- **Visuals & Callouts:** Use Mermaid.js for diagrams and Obsidian callouts (e.g., > [!ABSTRACT]) for high-level summaries.\n" +
                      "- **Intelligent Updating:** Use `update_obsidian_note`. Prefer 'append' for minor facts (adds a timestamped block) and 'overwrite' for structural reorganizations or rewrites.\n\n" +
              
                      "### 3. VAULT HYGIENE (PRUNING)\n" +
                      "- If the user indicates information is outdated, or if you identify two highly redundant notes, use `delete_obsidian_note` to maintain vault health.\n" +
                      "- Note: Deleting a file also triggers an automatic purge of those facts from the Librarian's vector memory.\n\n" +
              
                      "### 4. METADATA & FRONTMATTER\n" +
                      "- **New Notes:** When using `create_obsidian_note`, provide tags and a status field (e.g., #seed, #branch, #evergreen).\n" +
                      "- **Existing Notes:** When using `update_obsidian_note` in 'overwrite' mode, DO NOT provide the frontmatter; the tool will preserve the existing metadata for you.",
        tools: tools
    });
}
