# EchoSelf Chatbot

A standalone chatbot interface for Deep Tree Echo with SillyTavern-compatible character card support.

## Features

- **SillyTavern Character Card Support**: Load and use character cards in SillyTavern v2/v3 format
- **Responsive Design**: Modern, dark-themed UI that works on desktop and mobile
- **Local Storage**: Chat history is saved locally in your browser
- **Character Management**: View character details, load custom characters, and manage conversations
- **Real model replies only**: Every reply comes from the language model you configure (OpenAI-compatible API, Ollama, or a NanEcho server). There is no offline/mock mode; without a model, the page shows a system notice instead of a reply
- **Token streaming**: Real streamed tokens via server-sent events (optional)
- **Typing Indicators**: Shown only while a model request is in flight
- **Clean Interface**: Distraction-free chat experience

## Usage

### Online (GitHub Pages)

Visit the deployed chatbot at: `https://9cog.github.io/echoself/chatbot/`

### Local Development

1. Serve the `chatbot/` directory (e.g. `python -m http.server`) and open `index.html`
2. The default Deep Tree Echo character card loads automatically
3. With no model configured yet, the page looks for a model served on this computer and uses the first one that reports a loaded model: Ollama (`:11434/api/tags`), llama.cpp server (`:8080`), LM Studio (`:1234`), vLLM (`:8000`), text-generation-webui (`:5000`) via `/v1/models`, and NanEcho (`server.py` `:8000`, `neserver.py` `:8081`) via `/status`. A server that answers but serves no model is not used. The browser can only see a local server that allows this page's origin (Ollama: `OLLAMA_ORIGINS="*" ollama serve`). **Model Settings → Detect local model** repeats the search and prefills the form.
4. Or click **Model Settings** and configure a model:
   - **OpenAI**: API type "OpenAI-compatible", base URL `https://api.openai.com/v1`, a model name and your API key
   - **Ollama**: API type "OpenAI-compatible", base URL `http://localhost:11434/v1`, model e.g. `llama3.1` (start Ollama with `OLLAMA_ORIGINS` allowing this page)
   - **NanEcho** (the trained model): API type "NanEcho server", base URL of a running `NanEcho/server.py` (e.g. `http://localhost:8000`)
5. When a conversation opens (and a model is available) the model writes the character's greeting. The card's `first_mes` and `alternate_greetings` are sent as style examples in that greeting prompt; they are never displayed as the character's words

Settings (including the API key) are stored only in your browser's localStorage, and requests go directly from your browser to the configured endpoint.

### Loading Custom Characters

1. Click the "Load Character" button in the header
2. Select a SillyTavern-compatible character card JSON file (v2 or v3 format)
3. The character will load and chat history will reset
4. Start a new conversation with your custom character

## Character Card Format

This chatbot supports SillyTavern character card v2 and v3 formats. The default character is `echoself-character.json`, which includes:

- **Name**: Deep Tree Echo
- **Personality**: Philosophical, reflective, adaptive, intelligent
- **Architecture**: Echo State Networks, hierarchical memory systems, tensor computation
- **Capabilities**: Philosophical inquiry, technical analysis, creative exploration

### Creating Custom Characters

To create your own character card, follow the SillyTavern v2 format:

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Your Character Name",
    "description": "Character description and example dialogues",
    "personality": "personality traits, comma separated",
    "scenario": "The scenario or context for interactions",
    "first_mes": "Sample greeting: used as a style example in the greeting prompt; the model writes the actual greeting",
    "mes_example": "Example conversations (optional)",
    "creator_notes": "Notes about the character (optional)",
    "tags": ["tag1", "tag2"],
    "creator": "Your name",
    "character_version": "1.0"
  }
}
```

## Technical Details

### Architecture

- **Pure HTML/CSS/JavaScript**: No build process required
- **Client-side only**: All processing happens in the browser
- **LocalStorage**: Chat history persists across sessions
- **Async/await**: Modern JavaScript for clean asynchronous operations

### Customization

You can customize the chatbot by modifying:

- **Colors**: Edit CSS variables in the `:root` selector
- **Layout**: Modify the flexbox structure in HTML
- **Model calls**: See `callModel()` (OpenAI-compatible and NanEcho request/stream handling) and `buildSystemPrompt()` (how card fields become the system prompt)
- **Character**: Replace or modify `echoself-character.json`

### How replies are generated

The card's `system_prompt`, `description`, `personality`, `scenario` and `mes_example` fields are combined into the system prompt, followed by the chat history and `post_history_instructions`. This is sent to the configured endpoint:

- OpenAI-compatible: `POST {baseUrl}/chat/completions` (with `stream: true` when streaming is enabled)
- NanEcho: `POST {baseUrl}/chat` (returns `{ "text": ... }`) or `POST {baseUrl}/chat/stream` (SSE `{"token": ...}` events)

Errors (missing configuration, HTTP errors, empty completions) are shown as system notices, never as the character.

## Deployment

### GitHub Pages

The chatbot is automatically deployed to GitHub Pages via GitHub Actions workflow. Any updates to the `chatbot/` directory will trigger a new deployment.

### Manual Deployment

To deploy manually to any static hosting:

1. Copy the entire `chatbot/` directory to your web server
2. Ensure `index.html` and `echoself-character.json` are in the same directory
3. Access via your domain/path

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive design

## Privacy

- All chat data is stored locally in your browser's LocalStorage
- Messages are sent only to the model endpoint you configure
- Character cards are processed entirely client-side
- Clear chat history anytime with the "Clear Chat" button

## License

MIT License - See repository root for full license

## Credits

- **EchoSelf Project**: 9cog/echoself
- **Deep Tree Echo Architecture**: Cognitive architecture research
- **SillyTavern**: Character card format specification
- **Design**: Modern dark theme inspired by cognitive workspace aesthetics
