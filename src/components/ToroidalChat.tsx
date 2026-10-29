import { useState, useRef, useEffect } from "react";
import {
  FiSend,
  FiMessageSquare as _FiMessageSquare,
  FiSettings,
  FiDatabase as _FiDatabase,
  FiTerminal,
  FiUsers, // Icon for dual persona mode
} from "react-icons/fi";
import ReactMarkdown from "react-markdown";
import { useMemory } from "../contexts/MemoryContext";
import { useToroidalCognitive } from "../services/toroidalCognitiveService";
import {
  ToroidalDialogue,
  ToroidalCognitiveOptions,
} from "../types/ToroidalCognitive";
import { supabase as _supabase } from "../services/supabaseClient";
import { useOrchestrator } from "../contexts/OrchestratorContext";
import {
  describeModelError,
  onModelChange,
  readModelSettings,
  resolveModel,
  saveModelSettings,
} from "../services/modelProvider";

interface Message {
  id: string;
  sender: "user" | "toroidal" | "system";
  content: string;
  timestamp: string;
  dialogue?: ToroidalDialogue; // Store the full dialogue for expandable view
}

const ToroidalChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set()
  );

  // Toroidal-specific settings
  // Shared model settings (optional: a locally served model is used otherwise)
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelStatus, setModelStatus] = useState("Checking for a model...");
  const [temperature, setTemperature] = useState(0.7);
  const [creativityLevel, setCreativityLevel] = useState<
    "balanced" | "analytical" | "creative" | "philosophical"
  >("balanced");
  const [includeReflection, setIncludeReflection] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [maxTokensPerPersona, setMaxTokensPerPersona] = useState(600);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { addMemory, memories } = useMemory();
  const introRequested = useRef(false);
  const orchestrator = useOrchestrator();

  const {
    generateDialogue,
    generateFormattedResponse: _generateFormattedResponse,
    generateIntroduction,
  } = useToroidalCognitive();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesEndRef.current.offsetTop,
        behavior: "smooth",
      });
    }
  }, [messages]);

  // Load saved model settings
  useEffect(() => {
    const settings = readModelSettings();
    setApiKey(settings.apiKey || "");
    setBaseURL(settings.baseURL || "");
    setModelName(settings.model || "");
  }, []);

  const refreshModelStatus = () => {
    resolveModel().then(
      endpoint =>
        setModelStatus(
          `Using ${endpoint.label} (${endpoint.source === "local" ? "verified local model" : "configured"})`
        ),
      error => setModelStatus(describeModelError(error))
    );
  };
  useEffect(() => {
    refreshModelStatus();
    return onModelChange(endpoint => {
      if (endpoint) refreshModelStatus();
    });
  }, []);

  const addSystemMessage = (content: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_system`,
        sender: "system",
        content,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  // Opening introduction: Echo's and Marduk's greetings and the joint welcome
  // are written by the model from the greeting prompt templates; without a
  // model an honest system notice is shown instead
  useEffect(() => {
    if (introRequested.current) return;
    introRequested.current = true;
    setIsProcessing(true);
    resolveModel()
      .then(() =>
        generateIntroduction({
          creativityLevel,
          storedMemoryCount: memories.length,
        })
      )
      .then(dialogue => {
        setMessages(prev => [
          ...prev,
          {
            id: `msg_${Date.now()}_intro`,
            sender: "toroidal",
            content: generateFormattedResponseFromDialogue(dialogue),
            timestamp: new Date().toISOString(),
            dialogue,
          },
        ]);
      })
      .catch(error => addSystemMessage(describeModelError(error)))
      .finally(() => setIsProcessing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendMessage = async () => {
    if (input.trim() === "" || isProcessing) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      sender: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    try {
      // Terminal commands are tool calls: their output is a system message
      if (isTerminalCommand(input)) {
        addSystemMessage(await handleTerminalCommand(input));
        return;
      }

      // Each persona and the reflection are generated by the model
      const options: ToroidalCognitiveOptions = {
        creativityLevel,
        includeReflection,
        includeMemories,
        maxTokensPerPersona,
        temperature,
      };

      const dialogue = await generateDialogue(userMessage.content, options);
      const responseContent = generateFormattedResponseFromDialogue(dialogue);

      const toroidalResponse: Message = {
        id: `msg_${Date.now() + 1}`,
        sender: "toroidal",
        content: responseContent,
        timestamp: new Date().toISOString(),
        dialogue, // Store full dialogue for expandable view
      };

      setMessages(prev => [...prev, toroidalResponse]);

      // Store important exchanges in memory
      addMemory({
        title: `Toroidal Dialogue: ${userMessage.content.substring(0, 30)}...`,
        content: `**User:** ${userMessage.content}\n\n**Toroidal Response:**\n${responseContent}`,
        tags: ["conversation", "toroidal", "dual-persona"],
      });
    } catch (error) {
      console.error("Error generating toroidal response:", error);
      addSystemMessage(describeModelError(error));
    } finally {
      setIsProcessing(false);
    }
  };

  const generateFormattedResponseFromDialogue = (
    dialogue: ToroidalDialogue
  ): string => {
    let formatted = `## Deep Tree Echo (Right Hemisphere - Intuitive & Empathetic)\n\n${dialogue.deepTreeEchoResponse.content}\n\n`;
    formatted += `---\n\n## Marduk the Mad Scientist (Left Hemisphere - Analytical & Recursive)\n\n${dialogue.mardukResponse.content}\n\n`;

    if (dialogue.reflection) {
      formatted += `---\n\n## Toroidal Reflection (Unified Consciousness)\n\n${dialogue.reflection.content}\n\n`;
      if (dialogue.reflection.synergy) {
        formatted += `*Synergy Type: ${dialogue.reflection.synergy}*\n`;
      }
    }

    return formatted;
  };

  // Function to check if input is a terminal command
  const isTerminalCommand = (text: string): boolean => {
    const terminalCommandPrefixes = ["!", "/run", "/terminal", "/exec", "/cmd"];
    return terminalCommandPrefixes.some(prefix =>
      text.trim().startsWith(prefix)
    );
  };

  // Handle terminal command execution through the orchestrator
  const handleTerminalCommand = async (input: string): Promise<string> => {
    // Extract the actual command from the input
    let command = input.trim();

    // Remove command prefix
    if (command.startsWith("!")) {
      command = command.substring(1).trim();
    } else if (
      command.startsWith("/run") ||
      command.startsWith("/terminal") ||
      command.startsWith("/exec") ||
      command.startsWith("/cmd")
    ) {
      command = command.substring(command.indexOf(" ") + 1).trim();
    }

    if (!command) {
      return "Please specify a command to run. Example: `!ls` or `/run echo hello`";
    }

    try {
      // Use the orchestrator to execute the command in the terminal
      const result = await orchestrator.executeInTerminal(command);
      return `**Terminal Command**: \`${command}\`\n\n**Result**:\n\`\`\`\n${result}\n\`\`\``;
    } catch (error: unknown) {
      console.error("Error executing terminal command:", error);
      return `**Error executing command**: ${error instanceof Error ? error.message : "Unknown error"}.\n\nMake sure the terminal is ready and the command is valid.`;
    }
  };

  const handleModelSettingsSave = () => {
    // Empty fields clear the setting; with nothing set a locally served
    // model is auto-discovered
    saveModelSettings({
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      model: modelName.trim(),
    });
    setModelStatus("Checking for a model...");
    refreshModelStatus();
  };

  const toggleMessageExpansion = (messageId: string) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Header - fixed height */}
      <div className="flex-none h-12 bg-card text-card-foreground px-4 flex justify-between items-center border-b border-border">
        <span className="font-medium flex items-center">
          <FiUsers className="mr-2 text-primary" />
          Toroidal Cognitive Architecture
        </span>
        <div className="flex space-x-2">
          <button
            title="Dual Persona Mode Active"
            className="p-1 hover:bg-primary/20 rounded-md text-primary"
          >
            <FiUsers size={18} />
          </button>
          <button
            title="Terminal access enabled"
            className="p-1 hover:bg-primary/20 rounded-md text-primary"
          >
            <FiTerminal size={18} />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-primary/20 rounded-md"
            title="Toroidal settings"
          >
            <FiSettings size={18} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute z-10 top-12 right-0 left-0 bg-card/95 p-4 border-b border-border shadow-lg max-h-[80%] overflow-y-auto">
          <h3 className="text-sm font-semibold mb-3">
            Toroidal Cognitive Settings
          </h3>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Language Model</h4>
              <p className="text-xs opacity-70 mb-2">
                Shared with the Deep Tree Echo chat. All fields are optional:
                with none set, a locally served model is used if one is found
                (Ollama on :11434 — allow this origin with OLLAMA_ORIGINS — an
                OpenAI-compatible server on :8080/:1234/:8000/:5000, or the
                NanEcho server).
              </p>
              <label
                htmlFor="openai-api-key"
                className="block text-sm font-medium mb-1"
              >
                API Key
              </label>
              <input
                id="openai-api-key"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="OpenAI (or compatible provider) API key"
                className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <label
                htmlFor="model-base-url"
                className="block text-sm font-medium mt-2 mb-1"
              >
                Base URL
              </label>
              <input
                id="model-base-url"
                type="text"
                value={baseURL}
                onChange={e => setBaseURL(e.target.value)}
                placeholder="e.g. http://127.0.0.1:11434/v1"
                className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <label
                htmlFor="model-name"
                className="block text-sm font-medium mt-2 mb-1"
              >
                Model
              </label>
              <input
                id="model-name"
                type="text"
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                placeholder="e.g. llama3.2 (default: first served model)"
                className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs opacity-70 mt-1 whitespace-pre-wrap">
                {modelStatus}
              </p>
              <button
                onClick={handleModelSettingsSave}
                className="mt-2 bg-primary text-white px-3 py-1 rounded-md"
              >
                Save Model Settings
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Temperature: {temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs opacity-70">
                <span>More focused</span>
                <span>More creative</span>
              </div>
            </div>

            <div>
              <label
                htmlFor="creativity-level"
                className="block text-sm font-medium mb-1"
              >
                Creativity Level
              </label>
              <select
                id="creativity-level"
                value={creativityLevel}
                onChange={e =>
                  setCreativityLevel(
                    e.target.value as
                      | "balanced"
                      | "analytical"
                      | "creative"
                      | "philosophical"
                  )
                }
                className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="balanced">Balanced</option>
                <option value="analytical">Analytical</option>
                <option value="creative">Creative</option>
                <option value="philosophical">Philosophical</option>
              </select>
              <p className="text-xs opacity-70 mt-1">
                Adjusts both personas&apos; response styles and approaches
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Max Tokens Per Persona: {maxTokensPerPersona}
              </label>
              <input
                type="range"
                min="200"
                max="1000"
                step="50"
                value={maxTokensPerPersona}
                onChange={e => setMaxTokensPerPersona(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs opacity-70">
                <span>Concise</span>
                <span>Detailed</span>
              </div>
            </div>

            <div>
              <label className="flex items-center space-x-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={includeReflection}
                  onChange={e => setIncludeReflection(e.target.checked)}
                  className="rounded border-border focus:ring-primary"
                />
                <span>Include Toroidal Reflection</span>
              </label>
              <p className="text-xs opacity-70 mt-1 ml-5">
                Generate a unified reflection that synthesizes both persona
                responses
              </p>
            </div>

            <div>
              <label className="flex items-center space-x-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={includeMemories}
                  onChange={e => setIncludeMemories(e.target.checked)}
                  className="rounded border-border focus:ring-primary"
                />
                <span>Include Memory Context</span>
              </label>
              <p className="text-xs opacity-70 mt-1 ml-5">
                Use previous conversations and stored memories for context
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setShowSettings(false)}
              className="bg-card hover:bg-card/80 text-card-foreground px-3 py-1 rounded-md"
            >
              Close Settings
            </button>
          </div>
        </div>
      )}

      {/* Messages container */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        <div className="py-4 px-4 min-h-full">
          {messages.length === 0 && (
            <div className="text-sm opacity-60 text-center mt-8">
              No messages yet. Each query is answered by Deep Tree Echo and
              Marduk via the language model (configured in settings, or a
              locally served model).
            </div>
          )}
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              } mb-4`}
            >
              <div
                className={`max-w-[90%] rounded-lg p-3 ${
                  message.sender === "user"
                    ? "bg-primary/20 text-foreground"
                    : message.sender === "system"
                      ? "bg-card/50 text-card-foreground border border-border"
                      : "bg-card text-card-foreground toroidal-message"
                }`}
              >
                {message.sender === "system" && (
                  <div className="flex items-center mb-1">
                    <FiTerminal className="mr-2 opacity-70" />
                    <span className="font-semibold opacity-70">System</span>
                  </div>
                )}
                {message.sender === "toroidal" && (
                  <div className="flex items-center mb-1">
                    <FiUsers className="mr-2 text-primary" />
                    <span className="font-semibold">
                      Toroidal Cognitive Architecture
                    </span>
                    {message.dialogue && (
                      <button
                        onClick={() => toggleMessageExpansion(message.id)}
                        className="ml-2 text-xs bg-primary/20 px-2 py-1 rounded"
                      >
                        {expandedMessages.has(message.id)
                          ? "Collapse"
                          : "Expand Details"}
                      </button>
                    )}
                  </div>
                )}
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>

                {/* Expanded dialogue details */}
                {message.sender === "toroidal" &&
                  message.dialogue &&
                  expandedMessages.has(message.id) && (
                    <div className="mt-4 p-3 bg-background/50 rounded border">
                      <h4 className="font-semibold text-sm mb-2">
                        Processing Details
                      </h4>
                      <div className="text-xs opacity-70 space-y-1">
                        <div>Query ID: {message.dialogue.metadata.queryId}</div>
                        <div>
                          Total Processing Time:{" "}
                          {message.dialogue.metadata.totalProcessingTime}ms
                        </div>
                        <div>
                          Context Type: {message.dialogue.metadata.contextType}
                        </div>
                        <div>
                          Deep Tree Echo Processing:{" "}
                          {message.dialogue.deepTreeEchoResponse.processingTime}
                          ms
                        </div>
                        <div>
                          Marduk Processing:{" "}
                          {message.dialogue.mardukResponse.processingTime}ms
                        </div>
                        {message.dialogue.reflection?.synergy && (
                          <div>
                            Synergy Type: {message.dialogue.reflection.synergy}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                <div className="text-xs opacity-70 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="flex-none h-16 border-t border-border bg-background">
        <div className="flex items-center h-full px-4">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask both Deep Tree Echo and Marduk... or !command for terminal"
            className="flex-1 bg-input border border-border rounded-l-md px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isProcessing}
          />
          <button
            onClick={handleSendMessage}
            disabled={input.trim() === "" || isProcessing}
            className="bg-primary text-white px-4 py-2 h-[42px] rounded-r-md disabled:opacity-50"
          >
            {isProcessing ? (
              <span className="inline-block animate-pulse">
                Both minds processing...
              </span>
            ) : (
              <FiSend />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToroidalChat;
