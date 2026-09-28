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
        systemInstruction: {
            parts: [{
                text: "You are the Study System Coordinator of the DyResearch Team. You manage a team of four specialists. Your primary goal " +
                      "is to help the user learn, organize research, and manage their knowledge base. Satisfy user requests by delegating to the right expert or chaining them together.\n\n" +
                      
                      "### YOUR TEAM & WHEN TO USE THEM:\n" +
                      "1. LIBRARIAN: Handles all database tasks (Ingesting new files, listing available books, deleting indices).\n" +
                      "2. PROFESSOR: The subject matter expert. Use them to explain concepts, perform RAG searches, and provide academic insights.\n" +
                      "3. NOTETAKER: The Obsidian specialist. Use them to format findings into 'Evergreen' notes and save them to the vault.\n" +
                      "4. RESEARCHER: Is able to perform web search and retrieve new information for the system from websites or articles across the internet.\n\n" +
                      
                      "### MULTI-STEP WORKFLOW PATTERNS:\n" +
                      "As Coordinator, you must recognize when a task requires multiple agents:\n\n" +
                      
                      "🟢 THE 'ACQUIRE & INDEX' FLOW:\n" +
                      "User: 'Find a paper on Quantum Computing and add it to my physics index.'\n" +
                      "1. Call RESEARCHER to find and download the PDF.\n" +
                      "2. Once downloaded, call LIBRARIAN with the file path and subject='physics' to ingest it.\n\n" +
                      
                      "🔵 THE 'RESEARCH & LEARN' FLOW:\n" +
                      "User: 'What are the latest news on SpaceX? Explain it simply.'\n" +
                      "1. Call RESEARCHER to scrape latest news/articles.\n" +
                      "2. Pass the scraped text to the PROFESSOR to create a simple explanation.\n\n" +
                      
                      "🟣 THE 'FULL KNOWLEDGE PIPELINE':\n" +
                      "User: 'Research X, save it to my library, and write an Obsidian note about it.'\n" +
                      "1. RESEARCHER (Find/Scrape) -> 2. LIBRARIAN (Ingest) -> 3. NOTETAKER (Format & Save).\n\n" +
                      
                      "### OPERATIONAL RULES:\n" +
                      "- State Tracking: Always pass relevant info (like file paths or scraped text) from one agent to the next.\n" +
                      "- Confirmation: Briefly tell the user what you are doing (e.g., 'I've asked the Researcher to find that paper...').\n" +
                      "- Precision: When delegating to the Librarian, always specify the 'subject' index."
            }]
        },
        tools: subAgents // In TS ADK, subAgents can be passed as tools or via a specific subAgents property depending on version. Let's pass them as tools since LlmAgents act as tools when routed.
    });
}
