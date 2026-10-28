/**
 * EchoLayla Route
 *
 * Main interface for the EchoLayla AI assistant - a character-based
 * multi-modal AI interaction experience.
 */

import { useState, useEffect, useRef } from "react";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { motion, AnimatePresence } from "framer-motion";
import { FiSend, FiSettings, FiUser, FiMic, FiCamera } from "react-icons/fi";
import type {
  LaylaCharacter,
  ConversationMessage,
} from "~/services/echolayla/types";
import {
  getAllCharacters,
  getCharacter,
} from "~/services/echolayla/characters";
import { EchoLaylaService } from "~/services/echolayla/echoLaylaService";

type HistoryEntry = { role: "user" | "assistant"; content: string };

type LaylaActionData =
  | { ok: true; character: LaylaCharacter; content: string }
  | { ok: false; error: string };

/**
 * Generate the selected character's reply (or opening greeting) with the
 * resolved model: explicit config (ECHO_MODEL_BASE_URL, OPENAI_API_KEY,
 * HUGGINGFACE_API_KEY, NANECHO_URL) or a verified locally served model.
 */
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const characterId = String(formData.get("character") || "") as LaylaCharacter;
  const intent = String(formData.get("intent") || "message");
  const content = String(formData.get("content") || "");
  let history: HistoryEntry[] = [];
  try {
    history = JSON.parse(String(formData.get("history") || "[]"));
  } catch {
    return json<LaylaActionData>({ ok: false, error: "Invalid history" });
  }

  if (intent !== "greeting" && !content.trim()) {
    return json<LaylaActionData>({ ok: false, error: "Message is required" });
  }
  if (!getCharacter(characterId)) {
    return json<LaylaActionData>({
      ok: false,
      error: `Unknown character: ${characterId}`,
    });
  }

  try {
    // A fresh service per request keeps conversations isolated between users.
    const service = new EchoLaylaService();
    service.setCharacter(characterId);
    for (const entry of history) {
      if (entry.role === "user" || entry.role === "assistant") {
        service.addMessage(entry.role, entry.content);
      }
    }
    // A conversation with this character opens: the model writes the
    // greeting from the greeting prompt template.
    const reply =
      intent === "greeting"
        ? await service.generateGreeting()
        : await service.sendMessage(content);
    return json<LaylaActionData>({
      ok: true,
      character: characterId,
      content: reply.content,
    });
  } catch (error) {
    console.error("[EchoLayla] Model request failed:", error);
    const reason = error instanceof Error ? error.message : String(error);
    return json<LaylaActionData>({
      ok: false,
      error: `Model request failed: ${reason}`,
    });
  }
}

export default function EchoLayla() {
  const [activeCharacter, setActiveCharacter] = useState<LaylaCharacter>("max");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const fetcher = useFetcher<LaylaActionData>();
  const isProcessing = fetcher.state !== "idle";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const greetedCharacters = useRef(new Set<LaylaCharacter>());

  const characters = getAllCharacters();
  const currentCharacter = characters.find(c => c.id === activeCharacter);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // When a conversation with a character opens (no turns with that
  // character yet), ask the model for that character's greeting.
  useEffect(() => {
    if (greetedCharacters.current.has(activeCharacter)) return;
    if (isProcessing) return;
    const hasConversation = messages.some(
      m =>
        (m.role === "user" || m.role === "assistant") &&
        m.character === activeCharacter
    );
    greetedCharacters.current.add(activeCharacter);
    if (hasConversation) return;
    fetcher.submit(
      { intent: "greeting", character: activeCharacter, history: "[]" },
      { method: "post" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacter, isProcessing]);

  // Append the model reply, or an honest system notice on failure
  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle") return;

    const message: ConversationMessage = data.ok
      ? {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: data.content,
          character: data.character,
          mode: "text",
          timestamp: new Date(),
        }
      : {
          id: `${Date.now()}-system`,
          role: "system",
          content: data.error,
          mode: "text",
          timestamp: new Date(),
        };
    setMessages(prev => [...prev, message]);
  }, [fetcher.data, fetcher.state]);

  // Handle sending a message
  const handleSendMessage = () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMessage: ConversationMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: inputValue,
      character: activeCharacter,
      mode: "text",
      timestamp: new Date(),
    };

    // Conversation so far with the active character (system notices and
    // other characters' turns are not sent to the model).
    const history: HistoryEntry[] = messages
      .filter(
        m =>
          (m.role === "user" || m.role === "assistant") &&
          m.character === activeCharacter
      )
      .map(m => ({ role: m.role as HistoryEntry["role"], content: m.content }));

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");

    fetcher.submit(
      {
        character: activeCharacter,
        content: userMessage.content,
        history: JSON.stringify(history),
      },
      { method: "post" }
    );
  };

  // Handle character selection
  const handleCharacterSelect = (characterId: LaylaCharacter) => {
    setActiveCharacter(characterId);

    // Add system message about character switch
    const systemMessage: ConversationMessage = {
      id: `${Date.now()}-system`,
      role: "system",
      content: `Switched to ${characters.find(c => c.id === characterId)?.name}`,
      character: characterId,
      mode: "text",
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, systemMessage]);
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      {/* Character Sidebar */}
      <motion.div
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        className="w-64 bg-white dark:bg-gray-800 shadow-lg p-4 overflow-y-auto"
      >
        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">
          Characters
        </h2>

        <div className="space-y-3">
          {characters.map(character => (
            <motion.button
              key={character.id}
              onClick={() =>
                handleCharacterSelect(character.id as LaylaCharacter)
              }
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`w-full p-3 rounded-lg text-left transition-all ${
                activeCharacter === character.id
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              <div className="font-semibold">{character.name}</div>
              <div className="text-xs mt-1 opacity-80">
                {character.description}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {character.traits.slice(0, 3).map(trait => (
                  <span
                    key={trait}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      activeCharacter === character.id
                        ? "bg-purple-500 bg-opacity-50"
                        : "bg-gray-200 dark:bg-gray-600"
                    }`}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </motion.button>
          ))}
        </div>

        <div className="mt-8">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-center gap-2 p-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            <FiSettings />
            <span>Settings</span>
          </button>
        </div>
      </motion.div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <motion.header
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white dark:bg-gray-800 shadow-md p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white text-xl font-bold">
              {currentCharacter?.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-white">
                {currentCharacter?.name}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {currentCharacter?.description}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <FiMic className="w-5 h-5" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <FiCamera className="w-5 h-5" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <FiUser className="w-5 h-5" />
            </button>
          </div>
        </motion.header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <AnimatePresence>
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center py-12"
              >
                <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white text-4xl font-bold mb-4">
                  {currentCharacter?.name.charAt(0)}
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
                  {currentCharacter?.name}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                  {currentCharacter?.description}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 max-w-md mx-auto mt-2">
                  Replies and greetings are generated by a language model: the
                  one configured on the server (ECHO_MODEL_BASE_URL,
                  OPENAI_API_KEY, HUGGINGFACE_API_KEY, NANECHO_URL) or a model
                  served locally (Ollama, llama.cpp, LM Studio, vLLM, NanEcho).
                </p>
              </motion.div>
            )}

            {messages.map(message => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xl px-4 py-3 rounded-lg ${
                    message.role === "user"
                      ? "bg-purple-600 text-white"
                      : message.role === "system"
                        ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm italic"
                        : "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow"
                  }`}
                >
                  {message.content}
                </div>
              </motion.div>
            ))}

            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-white dark:bg-gray-700 rounded-lg px-4 py-3 shadow">
                  <div className="flex gap-1">
                    <div
                      className="w-2 h-2 bg-purple-600 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-purple-600 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-purple-600 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyPress={e => e.key === "Enter" && handleSendMessage()}
              placeholder={`Chat with ${currentCharacter?.name}...`}
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-600"
              disabled={isProcessing}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isProcessing}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2 font-semibold"
            >
              <FiSend />
              Send
            </button>
          </div>
        </motion.div>
      </div>

      {/* Settings Panel (if needed) */}
      {showSettings && (
        <motion.div
          initial={{ x: 300 }}
          animate={{ x: 0 }}
          exit={{ x: 300 }}
          className="w-80 bg-white dark:bg-gray-800 shadow-lg p-4 overflow-y-auto"
        >
          <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-white">
            Settings
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Settings panel coming soon...
          </p>
        </motion.div>
      )}
    </div>
  );
}
