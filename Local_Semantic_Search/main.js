const { Plugin, PluginSettingTab, Setting, Modal, Notice, MarkdownView } = require('obsidian');

// --- 1. DEFAULT SETTINGS ---
const DEFAULT_SETTINGS = {
    ollamaUrl: 'http://localhost:11434',
    embeddingModel: '', 
};

// --- 2. TEXT & MATH UTILITIES ---
class VectorMath {
    static cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB) return 0;
        if (vecA.length !== vecB.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

class TextProcessor {
    // Split note into paragraphs and filter out tiny useless bits
    static splitIntoChunks(text) {
        if (!text) return [];
        return text.split(/\n\s*\n/)
            .map(chunk => chunk.trim())
            .filter(chunk => chunk.length > 20); 
    }
}

// --- 3. OLLAMA API SERVICE ---
class OllamaService {
    constructor(settings) {
        this.settings = settings;
    }

    async getModels() {
        try {
            const response = await fetch(`${this.settings.ollamaUrl}/api/tags`);
            const data = await response.json();
            if (!data.models || !Array.isArray(data.models)) return [];
            return data.models.map(m => m.name);
        } catch (error) {
            console.error("[Semantic Search] Failed to fetch models:", error);
            return [];
        }
    }

    async getEmbedding(text) {
        if (!text || text.trim() === "") return null;
        try {
            const response = await fetch(`${this.settings.ollamaUrl}/api/embed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.settings.embeddingModel,
                    input: text
                })
            });
            if (!response.ok) return null;
            const data = await response.json();
            
            // Handle both modern array and older object fallback responses
            if (data.embeddings && data.embeddings.length > 0) return data.embeddings[0];
            else if (data.embedding) return data.embedding;
            return null;
        } catch (error) {
            return null;
        }
    }
}

// --- 4. LOCAL DATABASE MANAGER ---
class VectorDatabase {
    constructor(plugin) {
        this.plugin = plugin;
        this.dbPath = `${this.plugin.manifest.dir}/vectors.json`;
        this.data = []; 
    }

    async load() {
        const adapter = this.plugin.app.vault.adapter;
        if (await adapter.exists(this.dbPath)) {
            try {
                const content = await adapter.read(this.dbPath);
                const parsed = JSON.parse(content);
                this.data = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                this.data = []; // Reset if corrupted
            }
        } else {
            this.data = [];
        }
    }

    async save() {
        try {
            const adapter = this.plugin.app.vault.adapter;
            await adapter.write(this.dbPath, JSON.stringify(this.data));
        } catch (error) {
            console.error("[Semantic Search] Error saving db:", error);
        }
    }

    clear() {
        this.data = [];
    }
}

// --- 5. SEARCH UI MODAL ---
class SemanticSearchModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const titleEl = contentEl.createEl('h2', { text: 'Semantic Search' });
        titleEl.style.fontWeight = '800';
        titleEl.style.letterSpacing = '-0.5px';
        titleEl.style.background = 'linear-gradient(90deg, var(--interactive-accent), #3b82f6)';
        titleEl.style.webkitBackgroundClip = 'text';
        titleEl.style.webkitTextFillColor = 'transparent';
        titleEl.style.marginBottom = '20px';

        const inputEl = contentEl.createEl('input', { type: 'text', placeholder: 'Enter conceptual search...' });
        inputEl.style.width = '100%';
        inputEl.style.marginBottom = '10px';

        const buttonGroup = contentEl.createEl('div', { 
            style: 'display: flex; align-items: center; width: 100%; margin-bottom: 20px;' 
        });
        
        const btnEl = buttonGroup.createEl('button', { text: 'Search' });
        btnEl.style.marginBottom = '0'; 

        const refreshBtnEl = buttonGroup.createEl('button', { text: 'Refresh Index' });
        refreshBtnEl.style.marginBottom = '0';
        refreshBtnEl.style.backgroundColor = 'var(--interactive-normal)';
        refreshBtnEl.style.color = 'var(--text-normal)';
        refreshBtnEl.style.border = '1px solid var(--background-modifier-border)';
        refreshBtnEl.style.padding = '6px 14px'; 
        refreshBtnEl.style.fontSize = '12px'; 
        refreshBtnEl.style.marginLeft = 'auto';

        const resultsContainer = contentEl.createEl('div');

        btnEl.onclick = async () => {
            const query = inputEl.value;
            if (!query) return;

            if (!this.plugin.db.data || this.plugin.db.data.length === 0) {
                resultsContainer.setText('No valid data found. Please index first.');
                return;
            }

            resultsContainer.empty();
            resultsContainer.createEl('p', { text: 'Thinking...' });

            const queryVector = await this.plugin.ollama.getEmbedding(query);
            if (!queryVector) {
                resultsContainer.setText('Error: Local model failed to process search parameters.');
                return;
            }

            try {
                // Compare search vector against every text chunk
                const results = this.plugin.db.data.map((chunkItem) => {
                    const score = VectorMath.cosineSimilarity(queryVector, chunkItem.embedding);
                    return { path: chunkItem.path, text: chunkItem.text, score };
                });

                results.sort((a, b) => b.score - a.score);

                resultsContainer.empty();
                
                // Change result limit to 7
                const topResults = results.slice(0, 7);
                
                if (topResults.length === 0) {
                    resultsContainer.setText('No items evaluated metrics.');
                    return;
                }

                topResults.forEach(res => {
                    const div = resultsContainer.createEl('div', { style: 'margin-bottom: 8px;' });
                    
                    // Create preview text for visual clarity
                    const previewText = res.text.length > 60 ? res.text.substring(0, 60) + '...' : res.text;
                    const linkText = `${res.path} (Match: ${(res.score * 100).toFixed(1)}%)\n"${previewText}"`;
                    
                    const link = div.createEl('a', { text: linkText });
                    link.style.whiteSpace = 'pre-line'; // Ensure preview drops to next line
                    link.style.fontSize = '13px';
                    
                    link.onclick = async () => {
                        // Locate the file in the vault
                        const targetFile = this.app.vault.getAbstractFileByPath(res.path);
                        if (targetFile) {
                            // Open the file inside the workspace
                            const leaf = this.app.workspace.getLeaf(false);
                            await leaf.openFile(targetFile);
                            
                            // Access the text editor to find and highlight the chunk
                            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (view && res.text) {
                                const content = view.editor.getValue();
                                const index = content.indexOf(res.text);
                                
                                if (index !== -1) {
                                    const startPos = view.editor.offsetToPos(index);
                                    const endPos = view.editor.offsetToPos(index + res.text.length);
                                    
                                    // Highlight the exact text and scroll to it
                                    view.editor.setSelection(startPos, endPos);
                                    view.editor.scrollIntoView({from: startPos, to: endPos}, true);
                                }
                            }
                        }
                        this.close();
                    };
                });
            } catch (error) {
                resultsContainer.setText(`Loop Execution Error: ${error.message}`);
            }
        };

        refreshBtnEl.onclick = async () => {
            refreshBtnEl.setText('Updating...');
            refreshBtnEl.disabled = true;
            btnEl.disabled = true;
            inputEl.disabled = true;
            resultsContainer.setText('Scanning vault... Please check the status bar for live progress.');

            await this.plugin.indexVault();

            refreshBtnEl.setText('Refresh Index');
            refreshBtnEl.disabled = false;
            btnEl.disabled = false;
            inputEl.disabled = false;
            resultsContainer.setText('✅ Database updated successfully! Ready to search.');
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- 6. SETTINGS TAB ---
class SemanticSearchSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Local Semantic Search Settings' });

        const currentCount = this.plugin.db.data ? this.plugin.db.data.length : 0;
        containerEl.createEl('p', { 
            text: `📊 Database Status: ${currentCount} text chunks currently indexed.`,
            style: 'font-weight: bold; color: var(--text-accent); margin-bottom: 20px;'
        });

        const models = await this.plugin.ollama.getModels();

        new Setting(containerEl)
            .setName('Ollama Model')
            .setDesc('Select the local model used for embeddings.')
            .addDropdown(dropdown => {
                models.forEach(model => dropdown.addOption(model, model));
                dropdown
                    .setValue(this.plugin.settings.embeddingModel)
                    .onChange(async (value) => {
                        this.plugin.settings.embeddingModel = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Index Vault')
            .setDesc('Safely read and generate vectors for all text paragraphs in your vault.')
            .addButton(btn => btn
                .setButtonText('Start Indexing')
                .onClick(async () => {
                    new Notice('Starting indexing... Check the bottom status bar for live progress.');
                    await this.plugin.indexVault();
                    this.display();
                }));
    }
}

// --- 7. MAIN PLUGIN CLASS ---
module.exports = class LocalSemanticSearchPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        
        this.ollama = new OllamaService(this.settings);
        this.db = new VectorDatabase(this);
        await this.db.load();

        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        this.addRibbonIcon('brain', 'Semantic Search', () => {
            new SemanticSearchModal(this.app, this).open();
        });

        this.addCommand({
            id: 'open-semantic-search',
            name: 'Open Semantic Search',
            callback: () => {
                new SemanticSearchModal(this.app, this).open();
            }
        });

        this.addSettingTab(new SemanticSearchSettingTab(this.app, this));
    }

    updateStatusBar() {
        const count = this.db.data ? this.db.data.length : 0;
        this.statusBarItem.setText(`🧠 Semantic Search: ${count} chunks ready`);
    }

    async generateIndexReport(successfulNotes, failedNotes) {
        const reportPath = 'Semantic Search Index Report.md';
        
        let content = `# Semantic Search Indexing Report\n`;
        content += `> Generated on: ${new Date().toLocaleString()}\n\n`;
        content += `**Successfully Indexed Notes:** ${successfulNotes.length}\n`;
        content += `**Failed Notes:** ${failedNotes.length}\n\n`;
        content += `---\n\n`;

        if (failedNotes.length > 0) {
            content += `## ❌ Failed Notes\n`;
            content += `*These files failed processing completely.*\n\n`;
            failedNotes.forEach(path => {
                content += `- [[${path}]]\n`;
            });
            content += `\n`;
        }

        if (successfulNotes.length > 0) {
            content += `## ✅ Indexed Notes\n`;
            content += `*These files successfully converted paragraphs to math vectors.*\n\n`;
            successfulNotes.forEach(path => {
                content += `- [[${path}]]\n`;
            });
        }

        const fileExists = await this.app.vault.adapter.exists(reportPath);
        if (fileExists) {
            await this.app.vault.adapter.write(reportPath, content);
        } else {
            await this.app.vault.create(reportPath, content);
        }
    }

    async indexVault() {
        if (!this.settings.embeddingModel) {
            new Notice("Please select an Ollama model first.");
            return;
        }

        const files = this.app.vault.getMarkdownFiles();
        this.db.clear(); 

        let successfulNotes = [];
        let failedNotes = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            this.statusBarItem.setText(`🧠 Indexing: ${i + 1} / ${files.length} (${file.basename})`);

            try {
                // Strict read-only logic
                const content = await this.app.vault.cachedRead(file);
                
                // Break note into paragraph chunks
                const chunks = TextProcessor.splitIntoChunks(content);
                let fileSuccess = false;

                // Process each chunk separately
                for (const chunk of chunks) {
                    const embedding = await this.ollama.getEmbedding(chunk);
                    if (embedding && Array.isArray(embedding)) {
                        this.db.data.push({
                            path: file.path,
                            text: chunk, // Save chunk text for highlighting later
                            embedding: embedding
                        });
                        fileSuccess = true;
                    }
                }

                if (fileSuccess) {
                    successfulNotes.push(file.path);
                } else {
                    failedNotes.push(file.path);
                }

            } catch (fileError) {
                failedNotes.push(file.path);
                console.error(`[Semantic Search] Read error on note: "${file.path}"`, fileError);
            }
        }
        
        await this.db.save();
        this.updateStatusBar();
        await this.generateIndexReport(successfulNotes, failedNotes);

        if (failedNotes.length > 0) {
            new Notice(`⚠️ Indexing finished with ${failedNotes.length} errors! Check report.`);
        } else {
            new Notice(`✅ Indexing finished perfectly! Saved ${successfulNotes.length} notes.`);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};