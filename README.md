# Semantic-RAG-Extension-for-Obsidian
Obsidian Semantic Search extension with bge-m3 model.

<img width="578" height="191" alt="rag" src="https://github.com/user-attachments/assets/3889e5b9-eff6-4814-9f17-c133d6d81679" />

🔍 Obsidian Local RAG Search (Semantic Search)
Many times it is hard to search for the right notes, especially when your vault grows too large. Even when searching with specific keywords, traditional search often pops up way too many irrelevant results in the Obsidian note-taking app.

To solve this, I created this local, privacy-first Obsidian extension. It reads your notes and generates an offline vector database using the bge-m3 model via Ollama. Instead of looking for exact word matches, it searches by concept and meaning, instantly finding the top 7 most conceptually similar paragraphs in your vault and linking you directly to them.

⚙️ Getting Started
1. Get Ollama: Install Ollama and run ollama pull bge-m3 in your terminal.
2. Install Plugin: Place the plugin files (main.js, manifest.json, styles.css) into your .obsidian/plugins/ folder and enable it in Obsidian settings.
3. Configure & Index: In the plugin settings, select bge-m3:latest and click Start Indexing to build your local vector database.  
4. Search: Click the 🧠 brain icon in your left sidebar to start searching by meaning!  
