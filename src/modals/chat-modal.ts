import { App, Modal, MarkdownRenderer, setIcon, Notice } from 'obsidian';
import type DyResearchPlugin from '../main';

export interface ChatInterfaceOptions {
    isDocked?: boolean;
}

/**
 * Shared chat interface renderer used by both the Floating Modal and the Docked Sidebar Tab.
 */
export async function renderChatInterface(
    container: HTMLElement,
    app: App,
    plugin: DyResearchPlugin,
    sessionId: string,
    options: ChatInterfaceOptions = {}
) {
    container.empty();

    let activeSessionId = plugin.engine.sessionService.resolveSessionId(sessionId);
    plugin.currentSessionId = activeSessionId;

    // Session info & action bar
    const sessionBar = container.createDiv({ cls: 'chat-session-bar' });
    const sessionBadge = sessionBar.createDiv({ cls: 'chat-session-badge' });
    const badgeIcon = sessionBadge.createSpan({ cls: 'chat-session-badge-icon' });
    setIcon(badgeIcon, 'message-square');
    const sessionIdTextEl = sessionBadge.createSpan({
        text: activeSessionId,
        cls: 'chat-session-id-text',
        attr: { title: 'Click to rename session' }
    });

    const renameSessionBtn = sessionBadge.createEl('button', {
        cls: 'clickable-icon chat-rename-inline-btn',
        attr: { 'aria-label': 'Rename session' }
    });
    setIcon(renameSessionBtn, 'pencil');

    const startInlineRename = (e: MouseEvent) => {
        e.stopPropagation();
        if (sessionBadge.querySelector('input')) return;

        const currentName = plugin.currentSessionId || activeSessionId;
        sessionIdTextEl.style.display = 'none';
        renameSessionBtn.style.display = 'none';

        const inputEl = sessionBadge.createEl('input', {
            type: 'text',
            value: currentName,
            cls: 'session-rename-input chat-header-rename-input'
        });
        inputEl.focus();
        inputEl.select();

        let finished = false;
        const finishRename = async (save: boolean) => {
            if (finished) return;
            finished = true;
            const proposed = inputEl.value.trim();
            inputEl.remove();
            sessionIdTextEl.style.display = '';
            renameSessionBtn.style.display = '';

            if (!save || !proposed || proposed === currentName) {
                sessionIdTextEl.setText(plugin.currentSessionId || activeSessionId);
                return;
            }

            try {
                const finalId = await plugin.renameSession(currentName, proposed);
                activeSessionId = finalId;
                sessionIdTextEl.setText(finalId);
                new Notice(`Session renamed to "${finalId}"`);
            } catch (err: any) {
                sessionIdTextEl.setText(currentName);
                new Notice(err?.message || 'Failed to rename session.');
            }
        };

        inputEl.addEventListener('keydown', async (ke: KeyboardEvent) => {
            if (ke.key === 'Enter') {
                ke.preventDefault();
                await finishRename(true);
            } else if (ke.key === 'Escape') {
                ke.preventDefault();
                await finishRename(false);
            }
        });

        inputEl.addEventListener('blur', async () => {
            await finishRename(true);
        });
    };

    sessionIdTextEl.addEventListener('click', startInlineRename);
    renameSessionBtn.onClickEvent(startInlineRename);

    const sessionActions = sessionBar.createDiv({ cls: 'chat-session-actions' });

    const openMdBtn = sessionActions.createEl('button', {
        cls: 'clickable-icon chat-action-btn',
        attr: { 'aria-label': 'Open session Markdown note' }
    });
    setIcon(openMdBtn, 'file-text');
    openMdBtn.onClickEvent(async (e) => {
        e.stopPropagation();
        const curId = plugin.currentSessionId || activeSessionId;
        await plugin.engine.ensureSession(curId);
        await app.workspace.openLinkText(`DyResearch/Sessions/${curId}.md`, '', false);
    });

    const newChatBtn = sessionActions.createEl('button', {
        cls: 'clickable-icon chat-action-btn',
        attr: { 'aria-label': 'New chat session' }
    });
    setIcon(newChatBtn, 'plus');
    newChatBtn.onClickEvent(async (e) => {
        e.stopPropagation();
        await plugin.startNewSession();
    });

    if (options.isDocked) {
        const popOutBtn = sessionActions.createEl('button', {
            cls: 'clickable-icon chat-action-btn',
            attr: { 'aria-label': 'Pop out to floating window' }
        });
        setIcon(popOutBtn, 'external-link');
        popOutBtn.onClickEvent(async (e) => {
            e.stopPropagation();
            await plugin.setChatMode('floating');
        });
    }

    // Message history area
    const chatHistory = container.createDiv({ cls: 'chat-history' });

    const appendSimpleMessage = (parent: HTMLElement, sender: string, text: string): HTMLElement => {
        const emptyState = parent.querySelector('.chat-empty-state');
        if (emptyState) emptyState.remove();

        const msgWrapper = parent.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        return msgWrapper.createDiv({ cls: 'chat-msg-content', text });
    };

    const appendStreamingMessage = (parent: HTMLElement, sender: string) => {
        const emptyState = parent.querySelector('.chat-empty-state');
        if (emptyState) emptyState.remove();

        const msgWrapper = parent.createDiv({ cls: 'chat-msg-wrapper' });
        msgWrapper.createEl('small', { text: sender, cls: 'chat-sender' });
        const statusEl = msgWrapper.createDiv({ cls: 'chat-status-indicator' });
        const thinkingEl = msgWrapper.createDiv({ cls: 'chat-thinking-block' });
        const answerEl = msgWrapper.createDiv({ cls: 'chat-msg-content' });
        thinkingEl.style.display = 'none';
        return { statusEl, thinkingEl, answerEl };
    };

    let hasMessages = false;
    try {
        const session = await plugin.engine.ensureSession(sessionId);
        if (session && session.events) {
            for (const evt of session.events) {
                const parts = (evt as any).content?.parts || (evt as any).newMessage?.parts || (evt as any).modelResponse?.parts || [];
                const text = parts
                    .filter((p: any) => p?.text && !p?.thought)
                    .map((p: any) => p.text)
                    .join('')
                    .trim();
                const role = (evt as any).author === 'user' || (evt as any).newMessage ? '👤 You' : '🤖 AI';

                if (text) {
                    hasMessages = true;
                    const msgDiv = appendSimpleMessage(chatHistory, role, '');
                    await MarkdownRenderer.render(app, text, msgDiv, '', plugin);
                }
            }
        }
    } catch (err) {
        console.error("Could not load session history", err);
    }

    if (!hasMessages) {
        const emptyState = chatHistory.createDiv({ cls: 'chat-empty-state' });
        const emptyIcon = emptyState.createDiv({ cls: 'chat-empty-icon' });
        setIcon(emptyIcon, 'bot');
        emptyState.createEl('h4', { text: 'DyResearch Assistant', cls: 'chat-empty-title' });
        emptyState.createEl('p', {
            text: 'Ask a question about your Vault notes, explore your Library, or research a new topic.',
            cls: 'chat-empty-desc'
        });
    } else {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    // Input area with auto-expanding textarea and Send button
    const inputContainer = container.createDiv({ cls: 'chat-input-container' });
    const inputField = inputContainer.createEl('textarea', {
        placeholder: 'Ask DyResearch... (Enter to send, Shift+Enter for new line)',
        cls: 'chat-input-textarea'
    });
    inputField.rows = 1;

    const sendBtn = inputContainer.createEl('button', {
        cls: 'chat-send-btn',
        attr: { 'aria-label': 'Send message' }
    });
    setIcon(sendBtn, 'send');

    inputField.addEventListener('input', () => {
        inputField.style.height = 'auto';
        inputField.style.height = `${Math.min(inputField.scrollHeight, 160)}px`;
    });

    let isSending = false;
    const submitMessage = async () => {
        if (isSending) return;
        const userQuery = inputField.value.trim();
        if (!userQuery) return;

        isSending = true;
        sendBtn.disabled = true;
        inputField.value = '';
        inputField.style.height = 'auto';

        appendSimpleMessage(chatHistory, '👤 You', userQuery);
        const ai = appendStreamingMessage(chatHistory, '🤖 AI');
        chatHistory.scrollTop = chatHistory.scrollHeight;

        try {
            let fullAnswer = '';
            const stream = plugin.engine.sendMessage(plugin.currentSessionId, userQuery);
            for await (const chunk of stream) {
                let chunkText = '';
                const parts = (chunk as any).content?.parts || (chunk as any).newMessage?.parts || (chunk as any).modelResponse?.parts || [];
                for (const part of parts) {
                    if (part.text && !part.thought) chunkText += part.text;
                }
                if (!chunkText && (chunk as any).text) {
                    chunkText = (chunk as any).text;
                }

                const fnCall = parts.find((p: any) => p.functionCall)?.functionCall || (chunk as any).actions?.functionCalls?.[0];
                const transferTarget = (chunk as any).actions?.transferToAgent || (fnCall?.name === 'transfer_to_agent' ? fnCall.args?.agent_name : null);

                if (chunkText) {
                    fullAnswer += chunkText;
                    ai.answerEl.empty();
                    await MarkdownRenderer.render(app, fullAnswer, ai.answerEl, '', plugin);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if ((chunk as any).errorMessage) {
                    ai.answerEl.setText(`❌ Error: ${(chunk as any).errorMessage}`);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if (transferTarget) {
                    ai.answerEl.empty();
                    await MarkdownRenderer.render(app, fullAnswer + `\n\n*🔄 Transferring to ${transferTarget}...*`, ai.answerEl, '', plugin);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if (fnCall) {
                    const fnName = fnCall.name;
                    ai.answerEl.empty();
                    await MarkdownRenderer.render(app, fullAnswer + `\n\n*Working: ⚙️ Running ${fnName}...*`, ai.answerEl, '', plugin);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }
            }
        } catch (err: any) {
            ai.answerEl.setText(`❌ Error: ${err.message || err.toString()}`);
            console.error(err);
        } finally {
            isSending = false;
            sendBtn.disabled = false;
            inputField.focus();
        }
    };

    inputField.addEventListener('keydown', async (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await submitMessage();
        }
    });

    sendBtn.onClickEvent(async () => {
        await submitMessage();
    });

    setTimeout(() => inputField.focus(), 50);
}

export class ChatModal extends Modal {
    plugin: DyResearchPlugin;
    public isMinimized: boolean = false;
    private savedHeight: string = '';

    private minBtn: HTMLElement;
    private mainBodyWrapper: HTMLElement;

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
            if (modalEl.parentElement) {
                modalEl.parentElement.style.pointerEvents = 'none';
            }
            modalEl.style.pointerEvents = 'auto';
            modalEl.style.position = 'absolute';
            modalEl.style.margin = '0';
            modalEl.style.width = this.plugin.settings.chatWidth;
            modalEl.style.height = this.plugin.settings.chatHeight;
            modalEl.style.padding = '0';
            const defaultCloseBtn = modalEl.querySelector('.modal-close-button') as HTMLElement;
            if (defaultCloseBtn) defaultCloseBtn.remove();
        }

        const headerContainer = contentEl.createDiv({ cls: 'chat-modal-header-wrapper' });

        headerContainer.addEventListener('dblclick', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            this.toggleMinimize();
        });

        headerContainer.createEl('h2', { text: '🤖 DyResearch Assistant', cls: 'chat-modal-header' });
        const controlsContainer = headerContainer.createDiv({ cls: 'chat-modal-controls' });

        const dockBtn = controlsContainer.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Dock to right sidebar' }
        });
        setIcon(dockBtn, 'panel-right');
        dockBtn.onClickEvent(async (e) => {
            e.stopPropagation();
            await this.plugin.setChatMode('docked');
        });

        this.minBtn = controlsContainer.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Minimize' }
        });
        setIcon(this.minBtn, 'minus');
        this.minBtn.onClickEvent((e) => {
            e.stopPropagation();
            this.toggleMinimize();
        });

        const closeBtn = controlsContainer.createEl('button', {
            cls: 'clickable-icon chat-close-btn',
            attr: { 'aria-label': 'Close' }
        });
        setIcon(closeBtn, 'x');
        closeBtn.onClickEvent((e) => {
            e.stopPropagation();
            this.close();
        });

        this.mainBodyWrapper = contentEl.createDiv({ cls: 'chat-main-body-wrapper' });

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

        await renderChatInterface(this.mainBodyWrapper, this.app, this.plugin, this.plugin.currentSessionId, {
            isDocked: false
        });

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
                    this.plugin.saveData(this.plugin.settings);
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
        await renderChatInterface(this.mainBodyWrapper, this.app, this.plugin, sessionId, {
            isDocked: false
        });
    }

    public updateSessionBadge(newSessionId: string) {
        const badgeText = this.mainBodyWrapper?.querySelector('.chat-session-id-text');
        if (badgeText) {
            badgeText.textContent = newSessionId;
        }
    }

    onClose() {
        this.plugin.activeChatModal = null;
        this.contentEl.empty();
    }
}
