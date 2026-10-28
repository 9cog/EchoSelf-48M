import { useState, useRef, useEffect } from "react";
import {
  FiSend,
  FiMessageSquare,
  FiSettings,
  FiDatabase,
  FiTerminal,
} from "react-icons/fi";
import ReactMarkdown from "react-markdown";
import { useMemory } from "../contexts/MemoryContext";
import { useDeepTreeEcho } from "../services/deepTreeEchoService";
import {
  describeModelError,
  onModelChange,
  readModelSettings,
  resolveModel,
  saveModelSettings,
} from "../services/modelProvider";
import { useMem0AI } from "../services/mem0aiService";
import { supabase } from "../services/supabaseClient";
import { useOrchestrator } from "../contexts/OrchestratorContext";

interface Message {
  id: string;
  sender: "user" | "echo" | "system";
  content: string;
  timestamp: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [creativityLevel, setCreativityLevel] = useState<
    "balanced" | "analytical" | "creative" | "philosophical"
  >("balanced");
  // Model settings (persisted by modelProvider; all optional: without them a
  // locally served model is auto-discovered)
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelStatus, setModelStatus] = useState("Checking for a model...");
  const [useMemoryContext, setUseMemoryContext] = useState(true);
  const [useMem0AIContext, setUseMem0AIContext] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { addMemory, memories } = useMemory();
  const deepTreeEcho = useDeepTreeEcho();
  const greetingRequested = useRef(false);

  const mem0ai = useMem0AI();
  const orchestrator = useOrchestrator();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesEndRef.current.offsetTop,
        behavior: "smooth",
      });
    }
  }, [messages]);

  // Load saved model settings and open the user's Mem0AI store
  useEffect(() => {
    const settings = readModelSettings();
    setApiKey(settings.apiKey || "");
    setBaseURL(settings.baseURL || "");
    setModelName(settings.model || "");

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        mem0ai.initialize(settings.apiKey, data.session.user.id);
      }
    };
    checkSession();
  }, [mem0ai]);

  // Keep the model status line current
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

  /**
   * Run a model call whose tokens stream into a new Echo message. The message
   * is removed again if the call fails, so only model text is ever shown.
   */
  const streamEchoMessage = async (
    run: (onToken: (token: string) => void) => Promise<string>
  ): Promise<string> => {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let created = false;
    const onToken = (token: string) => {
      setMessages(prev => {
        if (!created) {
          created = true;
          return [
            ...prev,
            {
              id,
              sender: "echo",
              content: token,
              timestamp: new Date().toISOString(),
            },
          ];
        }
        return prev.map(m =>
          m.id === id ? { ...m, content: m.content + token } : m
        );
      });
    };
    try {
      const text = await run(onToken);
      // Final text is authoritative (also covers non-streaming servers)
      setMessages(prev =>
        prev.some(m => m.id === id)
          ? prev.map(m => (m.id === id ? { ...m, content: text } : m))
          : [
              ...prev,
              {
                id,
                sender: "echo",
                content: text,
                timestamp: new Date().toISOString(),
              },
            ]
      );
      created = true;
      return text;
    } catch (error) {
      setMessages(prev => prev.filter(m => m.id !== id));
      throw error;
    }
  };

  // Opening greeting: written by the model from the greeting prompt
  // template, or an honest system notice when no model is available
  useEffect(() => {
    if (greetingRequested.current) return;
    greetingRequested.current = true;
    setIsProcessing(true);
    resolveModel()
      .then(endpoint =>
        streamEchoMessage(onToken =>
          deepTreeEcho.generateGreeting({
            storedMemoryCount: memories.length,
            modelLabel: endpoint.label,
            creativityLevel,
            onToken,
          })
        )
      )
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
      // Terminal commands are tool calls: their output is shown as a system
      // message, never voiced by Echo
      if (isTerminalCommand(input)) {
        addSystemMessage(await handleTerminalCommand(input));
        return;
      }

      const useMem0 = mem0ai.isInitialized() && useMem0AIContext;

      // Conversation history for the model (system notices are not part of it)
      const conversationHistory = messages
        .filter(msg => msg.sender !== "system")
        .slice(-6)
        .map(msg => ({
          role:
            msg.sender === "user" ? ("user" as const) : ("assistant" as const),
          content: msg.content,
        }));
      conversationHistory.push({
        role: "user",
        content: userMessage.content,
      });

      // Intent routing picks the prompt template (greeting / identity / help
      // / default); the model writes the reply from it
      const { instructions } = deepTreeEcho.buildPromptTemplate(
        userMessage.content,
        { creativityLevel }
      );

      const responseContent = await streamEchoMessage(onToken =>
        useMem0
          ? // Model response with Mem0AI memory context
            mem0ai.generateResponseWithMemoryContext(
              userMessage.content,
              conversationHistory,
              {
                temperature,
                creativityLevel,
                systemPrompt: instructions,
                onToken,
              }
            )
          : // Model response, with conversation history and stored
            // memories when enabled
            deepTreeEcho.generateResponse(userMessage.content, {
              temperature,
              creativityLevel,
              includeMemories: useMemoryContext,
              conversationHistory: useMemoryContext
                ? conversationHistory
                : undefined,
              onToken,
            })
      );

      const echoResponse = { content: responseContent };

      // Store important exchanges in memory
      addMemory({
        title: `Conversation: ${userMessage.content.substring(0, 30)}...`,
        content: `**User:** ${userMessage.content}\n\n**Echo:** ${echoResponse.content}`,
        tags: ["conversation", "learning"],
      });

      // Also store in Mem0AI if available
      if (mem0ai.isInitialized()) {
        try {
          await mem0ai.addMemory({
            title: `Chat: ${userMessage.content.substring(0, 30)}...`,
            content: `User: ${userMessage.content}\n\nEcho: ${echoResponse.content}`,
            tags: ["conversation", "chat"],
            type: "episodic",
            context: "From chat interaction",
          });
        } catch (error) {
          console.error("Error storing memory in Mem0AI:", error);
        }
      }
    } catch (error) {
      console.error("Error generating response:", error);
      addSystemMessage(describeModelError(error));
    } finally {
      setIsProcessing(false);
    }
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

    const initializeMem0AI = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        mem0ai.initialize(apiKey.trim() || undefined, data.session.user.id);
      }
    };
    initializeMem0AI();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Header - fixed height */}
      <div className="flex-none h-12 bg-card text-card-foreground px-4 flex justify-between items-center border-b border-border">
        <span className="font-medium">Deep Tree Echo Chat</span>
        <div className="flex space-x-2">
          {mem0ai.isInitialized() && (
            <button
              onClick={() => setUseMem0AIContext(!useMem0AIContext)}
              className={`p-1 hover:bg-primary/20 rounded-md ${useMem0AIContext ? "text-primary" : ""}`}
              title={
                useMem0AIContext
                  ? "Mem0AI context enabled"
                  : "Mem0AI context disabled"
              }
            >
              <FiDatabase size={18} />
            </button>
          )}
          <button
            title="Terminal access enabled"
            className="p-1 hover:bg-primary/20 rounded-md text-primary"
          >
            <FiTerminal size={18} />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 hover:bg-primary/20 rounded-md"
            title="Chat settings"
          >
            <FiSettings size={18} />
          </button>
        </div>
      </div>

      {/* Settings Panel - Conditionally rendered over content */}
      {showSettings && (
        <div className="absolute z-10 top-12 right-0 left-0 bg-card/95 p-4 border-b border-border shadow-lg max-h-[80%] overflow-y-auto">
          <h3 className="text-sm font-semibold mb-3">Chat Settings</h3>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Language Model</h4>
              <p className="text-xs opacity-70 mb-2">
                All fields are optional. With none set, a locally served model
                is used if one is found (Ollama on :11434 — allow this origin
                with OLLAMA_ORIGINS — or an OpenAI-compatible server on
                :8080/:1234/:8000/:5000, or the NanEcho server).
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
                placeholder="e.g. http://127.0.0.1:11434/v1 (default: OpenAI API when a key is set)"
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
                placeholder="e.g. llama3.2 or gpt-4o-mini (default: first served model)"
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
                Adjusts Deep Tree Echo&apos;s response style and approach
              </p>
            </div>

            <div>
              <label className="flex items-center space-x-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={useMemoryContext}
                  onChange={e => setUseMemoryContext(e.target.checked)}
                  className="rounded border-border focus:ring-primary"
                />
                <span>Use Basic Memory and Conversation Context</span>
              </label>
              <p className="text-xs opacity-70 mt-1 ml-5">
                When enabled, Deep Tree Echo will use previous messages and
                stored memories to generate more contextual responses
              </p>
            </div>

            {mem0ai.isInitialized() && (
              <div>
                <label className="flex items-center space-x-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={useMem0AIContext}
                    onChange={e => setUseMem0AIContext(e.target.checked)}
                    className="rounded border-border focus:ring-primary"
                  />
                  <span>Use Advanced Mem0AI Context</span>
                </label>
                <p className="text-xs opacity-70 mt-1 ml-5">
                  When enabled, Deep Tree Echo will use the Mem0AI system for
                  enhanced semantic memory search and contextual responses
                </p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium mb-2">Terminal Commands</h4>
              <p className="text-xs opacity-70">
                You can run terminal commands by starting your message with:
              </p>
              <ul className="text-xs ml-5 mt-1 list-disc space-y-1">
                <li>
                  <code>!</code> (exclamation mark) - Example: <code>!ls</code>
                </li>
                <li>
                  <code>/run</code> - Example: <code>/run echo hello</code>
                </li>
                <li>
                  <code>/terminal</code> - Example: <code>/terminal pwd</code>
                </li>
              </ul>
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

      {/* Messages container - scrollable, takes available space */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        <div className="py-4 px-4 min-h-full">
          {messages.length === 0 && (
            <div className="text-sm opacity-60 text-center mt-8">
              No messages yet. Send a message to start a conversation with Deep
              Tree Echo (needs a configured or locally served model; see
              settings).
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
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.sender === "user"
                    ? "bg-primary/20 text-foreground"
                    : message.sender === "system"
                      ? "bg-card/50 text-card-foreground border border-border"
                      : "bg-card text-card-foreground echo-message"
                }`}
              >
                {message.sender === "echo" && (
                  <div className="flex items-center mb-1">
                    <FiMessageSquare className="mr-2 text-primary" />
                    <span className="font-semibold">Deep Tree Echo</span>
                  </div>
                )}
                {message.sender === "system" && (
                  <div className="flex items-center mb-1">
                    <FiTerminal className="mr-2 opacity-70" />
                    <span className="font-semibold opacity-70">System</span>
                  </div>
                )}
                <div className="prose prose-sm dark:prose-invert">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
                <div className="text-xs opacity-70 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area - fixed height at bottom */}
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
            placeholder="Type a message or !command to run in terminal..."
            className="flex-1 bg-input border border-border rounded-l-md px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isProcessing}
          />
          <button
            onClick={handleSendMessage}
            disabled={input.trim() === "" || isProcessing}
            className="bg-primary text-white px-4 py-2 h-[42px] rounded-r-md disabled:opacity-50"
          >
            {isProcessing ? (
              <span className="inline-block animate-pulse">...</span>
            ) : (
              <FiSend />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
