import { App, Modal, MarkdownRenderer, setIcon, Notice } from 'obsidian';
import type DyResearchPlugin from '../main';

export class ChatModal extends Modal {
    plugin: DyResearchPlugin;
    public isMinimized: boolean = false;
    private savedHeight: string = '';

    private minBtn: HTMLElement;
    private mainBodyWrapper: HTMLElement;
    private chatHistory: HTMLElement;

    constructor(app: App, plugin: DyResearchPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('dy-chat-modal');
        
        const modalEl = contentEl.closest('.modal') as HTMLElement;
        
        if (modalEl) {
            modalEl.addClass('dy-chat-modal-parent');
            modalEl.parentElement.style.pointerEvents = 'none';
            modalEl.style.pointerEvents = 'auto';
            modalEl.style.position = 'absolute';
            modalEl.style.margin = '0';
            modalEl.style.width = this.plugin.settings.chatWidth;
            modalEl.style.height = this.plugin.settings.chatHeight;
            modalEl.style.padding = '0';
            const defaultCloseBtn = modalEl.querySelector('.modal-close-button') as HTMLElement;
            if (defaultCloseBtn) defaultCloseBtn.style.display = 'none';
        }

        const headerContainer = contentEl.createDiv({ cls: 'chat-modal-header-wrapper' });
        headerContainer.style.display = 'flex';
        headerContainer.style.justifyContent = 'space-between';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.cursor = 'grab';
        headerContainer.style.padding = '10px 14px';
        headerContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
        
        headerContainer.addEventListener('dblclick', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            this.toggleMinimize();
        });

        const headerTitle = headerContainer.createEl('h2', { text: '🤖 DyResearch Assistant', cls: 'chat-modal-header' });
        const controlsContainer = headerContainer.createDiv({ cls: 'chat-modal-controls' });

        this.minBtn = controlsContainer.createEl('button', { cls: 'clickable-icon', attr: { "aria-label": "Minimize" } });
        this.minBtn.style.width = '24px';
        this.minBtn.style.height = '24px';
        setIcon(this.minBtn, 'minus');

        const closeBtn = controlsContainer.createEl('button', { cls: 'clickable-icon', attr: { "aria-label": "Close" } });
        closeBtn.style.width = '24px';
        closeBtn.style.height = '24px';
        setIcon(closeBtn, 'x');

        this.mainBodyWrapper = contentEl.createDiv({ cls: 'chat-main-body-wrapper' });
        this.mainBodyWrapper.style.display = 'flex';
        this.mainBodyWrapper.style.flexDirection = 'column';
        this.mainBodyWrapper.style.padding = '14px';
        this.mainBodyWrapper.style.flexGrow = '1';

        this.minBtn.onClickEvent((e) => {
            e.stopPropagation();
            this.toggleMinimize();
        });

        closeBtn.onClickEvent((e) => {
            e.stopPropagation();
            this.close();
        });

        if (modalEl) {
            headerContainer.addEventListener('pointerdown', (e: PointerEvent) => {
                if (e.button !== 0) return; 
                if ((e.target as HTMLElement).closest('button')) return;
                e.preventDefault();
                
                const rect = modalEl.getBoundingClientRect();
                const parentEl = modalEl.parentElement;
                if (!parentEl) return;
                const parentRect = parentEl.getBoundingClientRect();
                
                const startLeft = rect.left - parentRect.left;
                const startTop = rect.top - parentRect.top;
                
                const startX = e.clientX;
                const startY = e.clientY;

                const onPointerMove = (moveEvent: PointerEvent) => {
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;
                    const newLeft = Math.max(0, Math.min(parentRect.width - rect.width, startLeft + deltaX));
                    const newTop = Math.max(0, Math.min(parentRect.height - rect.height, startTop + deltaY));
                    modalEl.style.left = `${newLeft}px`;
                    modalEl.style.top = `${newTop}px`;
                };

                const onPointerUp = () => {
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                };

                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
            });
        }

        this.chatHistory = this.mainBodyWrapper.createDiv({ cls: 'chat-history' });
        await this.loadSessionContent(this.plugin.currentSessionId);

        const resizeHandle = contentEl.createDiv({ cls: 'modal-resize-handle' });
        if (modalEl) {
            resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
                if (this.isMinimized) return; 
                e.preventDefault();
                const startWidth = modalEl.offsetWidth;
                const startHeight = modalEl.offsetHeight;
                const startX = e.clientX;
                const startY = e.clientY;

                const onPointerMove = (moveEvent: PointerEvent) => {
                    const newWidth = Math.max(400, startWidth + (moveEvent.clientX - startX));
                    const newHeight = Math.max(300, startHeight + (moveEvent.clientY - startY));
                    modalEl.style.width = `${newWidth}px`;
                    modalEl.style.height = `${newHeight}px`;
                };

                const onPointerUp = () => {
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                    
                    this.plugin.settings.chatWidth = modalEl.style.width;
                    this.plugin.settings.chatHeight = modalEl.style.height;
                    this.plugin.saveSettings();
                };

                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
            });
        }
    }

    public toggleMinimize() {
        const modalEl = this.contentEl.closest('.modal') as HTMLElement;
        if (!modalEl) return;

        this.isMinimized = !this.isMinimized;
        if (this.isMinimized) {
            this.savedHeight = modalEl.style.height;
            modalEl.style.height = '46px';
            this.mainBodyWrapper.style.display = 'none';
            this.contentEl.style.overflow = 'hidden';
            setIcon(this.minBtn, 'plus');
            this.minBtn.setAttribute('aria-label', 'Expand');
        } else {
            modalEl.style.height = this.savedHeight || this.plugin.settings.chatHeight;
            this.mainBodyWrapper.style.display = 'flex';
            this.contentEl.style.overflow = '';
            setIcon(this.minBtn, 'minus');
            this.minBtn.setAttribute('aria-label', 'Minimize');
        }
    }

    public async switchSession(sessionId: string) {
        if (this.isMinimized) this.toggleMinimize();
        await this.loadSessionContent(sessionId);
    }

    private async loadSessionContent(sessionId: string) {
        this.chatHistory.empty();
        
        const sessionTitle = this.chatHistory.createEl('p', { 
            text: `Session: ${sessionId}`, 
            cls: 'chat-session-id' 
        });
        sessionTitle.style.order = "-100";

        try {
            const session = await this.plugin.engine.sessionService.getSession({ appName: 'dyresearch', sessionId });
            if (session && session.events) {
                // VERY rudimentary event parsing for ADK events just to render past history
                for (const evt of session.events) {
                    let text = '';
                    let role = '🤖 AI';
                    
                    // Hacky inspection of ADK event structure for UI rendering
                    if ((evt as any).newMessage?.parts?.[0]?.text) {
                        text = (evt as any).newMessage.parts[0].text;
                        role = '👤 You';
                    } else if ((evt as any).modelResponse?.parts?.[0]?.text) {
                        text = (evt as any).modelResponse.parts[0].text;
                    }
                    
                    if (text) {
                        const msgDiv = this.appendSimpleMessage(this.chatHistory, role, '');
                        await MarkdownRenderer.render(this.app, text, msgDiv, '', this.plugin);
                    }
                }
            }
            this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        } catch (err) {
            console.error("Could not load session history", err);
        }

        let oldInput = this.mainBodyWrapper.querySelector('.chat-input-container');
        if (oldInput) oldInput.remove();

        const inputContainer = this.mainBodyWrapper.createDiv({ cls: 'chat-input-container' });
        const inputField = inputContainer.createEl('textarea', { 
            placeholder: 'Type your message...',
            cls: 'chat-input-textarea'
        });
        inputField.rows = 1;
        inputField.focus();

        let isManuallyResized = false;
        inputField.addEventListener('pointerdown', (e: PointerEvent) => {
            const rect = inputField.getBoundingClientRect();
            if (rect.width - (e.clientX - rect.left) < 20 && rect.height - (e.clientY - rect.top) < 20) {
                isManuallyResized = true;
                inputField.style.maxHeight = 'none';
            }
        });

        inputField.addEventListener('input', () => {
            if (!isManuallyResized) {
                inputField.style.height = 'auto';
                inputField.style.height = `${inputField.scrollHeight}px`;
            } else if (inputField.value === '') {
                isManuallyResized = false;
                inputField.style.maxHeight = '';
                inputField.style.height = 'auto';
            }
        });

        inputField.addEventListener('keydown', async (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const userQuery = inputField.value;
                if (userQuery.trim() !== '') {
                    inputField.value = '';
                    isManuallyResized = false;
                    inputField.style.maxHeight = '';
                    inputField.style.height = 'auto';

                    this.appendSimpleMessage(this.chatHistory, '👤 You', userQuery);
                    const ai = this.appendStreamingMessage(this.chatHistory, '🤖 AI');
                    this.chatHistory.scrollTop = this.chatHistory.scrollHeight;

                    try {
                        let fullAnswer = "";
                        
                        const stream = this.plugin.engine.sendMessage(this.plugin.currentSessionId, userQuery);
                        for await (const chunk of stream) {
                            console.log("ADK Event Chunk:", chunk);
                            
                            // A more robust way to pull text from ADK events 
                            let chunkText = "";
                            const parts = (chunk as any).content?.parts || (chunk as any).newMessage?.parts || (chunk as any).modelResponse?.parts || [];
                            for (const part of parts) {
                                if (part.text) chunkText += part.text;
                            }
                            if (!chunkText && (chunk as any).text) {
                                chunkText = (chunk as any).text;
                            }

                            if (chunkText) {
                                fullAnswer += chunkText;
                                ai.answerEl.empty();
                                await MarkdownRenderer.render(this.app, fullAnswer, ai.answerEl, '', this.plugin);
                                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
                            } else if ((chunk as any).actions?.functionCalls?.length > 0) {
                                // Indicate that the agent is calling a tool
                                const fnName = (chunk as any).actions.functionCalls[0].name;
                                ai.answerEl.empty();
                                await MarkdownRenderer.render(this.app, fullAnswer + `\n\n*Working: ⚙️ Running ${fnName}...*`, ai.answerEl, '', this.plugin);
                                this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
                            }
                        }

                    } catch (err: any) {
                        ai.answerEl.setText(`❌ Error: ${err.message || err.toString()}`);
                        console.error(err);
                    }
                }
            }
        });
    }

    appendStreamingMessage(container: HTMLElement, sender: string) {
        const msgWrapper = container.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        const statusEl = msgWrapper.createDiv({ cls: 'chat-status-indicator' });
        const thinkingEl = msgWrapper.createDiv({ cls: 'chat-thinking-block' });
        const answerEl = msgWrapper.createDiv({ cls: 'chat-msg-content' });
        thinkingEl.style.display = 'none';
        return { statusEl, thinkingEl, answerEl };
    }

    appendSimpleMessage(container: HTMLElement, sender: string, text: string): HTMLElement {
        const msgWrapper = container.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        return msgWrapper.createDiv({ cls: 'chat-msg-content', text: text });
    }

    onClose() {
        this.plugin.activeChatModal = null;
        this.contentEl.empty();
    }
}