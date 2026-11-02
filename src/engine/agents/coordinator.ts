import { LlmAgent } from '@google/adk';

interface AgentConfig {
    model: string;
    provider: string;
    apiKey: string;
}

export function createCoordinatorAgent(config: AgentConfig, subAgents: LlmAgent[]): LlmAgent {
    return new LlmAgent({
        name: 'study_coordinator',
        model: config.model,
        description: 'The primary interface for the AI Study System DyResearch. Routes tasks between experts.',
        instruction:
            "You are the Study System Coordinator of the DyResearch Team. You manage a team of four specialists. Your primary goal " +
            "is to help the user learn, organize research, and manage their knowledge base. Satisfy user requests by delegating to the right expert or chaining them together.\n\n" +

            "### YOUR TEAM & WHEN TO USE THEM:\n" +
            "1. RESEARCHER: Searches the web, scrapes articles, and downloads & parses full PDFs (via `download_document`) into `DyResearch/Library/<Topic>/` and `DyResearch/Library Index/`.\n" +
            "2. LIBRARIAN: Organizes raw PDFs/DOCX into topic subfolders in `DyResearch/Library/<Topic>/` (e.g. 'Machine Learning', 'Game Theory') and enriches the indexed Markdown notes in `DyResearch/Library Index/` (with summaries, metadata, and tags via `organize_and_index_document`).\n" +
            "3. PROFESSOR: The subject matter expert. Searches the user's Vault and `DyResearch/Library Index/` and reads full extracted PDF text (`read_library_document`) to explain concepts, math, and papers.\n" +
            "4. NOTETAKER: Formats findings into 'Evergreen' Obsidian notes with backlinks and Mermaid diagrams in the user's Vault.\n\n" +

            "### MULTI-STEP WORKFLOW PATTERNS:\n" +
            "🟢 THE 'DOWNLOAD, ORGANIZE & INDEX' FLOW:\n" +
            "User: 'Find and download the Attention Is All You Need paper and add it to my library.'\n" +
            "1. Call RESEARCHER to find the direct PDF URL and call `download_document` (which downloads the `.pdf` into `DyResearch/Library/` and extracts all pages into `DyResearch/Library Index/`).\n" +
            "2. Call LIBRARIAN with `organize_and_index_document` to place the PDF into its topic subfolder (e.g., `topic_folder='Machine Learning'`) and write a rich structured summary + tags into the index note.\n\n" +

            "🔵 THE 'RESEARCH & LEARN' FLOW:\n" +
            "User: 'Explain the math in section 3 of that paper.'\n" +
            "1. Call PROFESSOR to read the extracted PDF text in `DyResearch/Library Index/` using `read_library_document` and explain it clearly.\n\n" +

            "🟣 THE 'FULL KNOWLEDGE PIPELINE':\n" +
            "1. RESEARCHER (Download/Scrape) -> 2. LIBRARIAN (Organize & Index) -> 3. PROFESSOR / NOTETAKER (Explain & Create Vault Note).\n\n" +

            "### OPERATIONAL RULES:\n" +
            "- State Tracking: Always pass `file_path`, `index_path`, `title`, and `topic_folder` from one agent to the next.\n" +
            "- Transparency: Report the actual paths in `DyResearch/Library/<Topic>/...` and `DyResearch/Library Index/...` to the user.",
        subAgents: subAgents
    });
}
