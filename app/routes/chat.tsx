import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import ChatInterface, { Message } from "~/components/ChatInterface";
import { getAIService } from "~/services/ai.server";

export async function loader() {
  const aiService = getAIService();
  // Resolves the configured model, or discovers and verifies a locally
  // served one (Ollama, llama.cpp, LM Studio, vLLM, NanEcho).
  const modelStatus = await aiService.getModelStatus();

  return json({ modelStatus });
}

type ChatActionData =
  | { userMessage?: Message; assistantMessage: Message; success: true }
  | { userMessage?: Message; error: string };

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const content = formData.get("content") as string;
  const history = JSON.parse(
    (formData.get("history") as string) || "[]"
  ) as Message[];

  const aiService = getAIService();

  // A new conversation opens: the model writes the greeting from the
  // "opening" prompt template.
  if (intent === "opening") {
    try {
      const greeting = await aiService.generateGreeting();
      return json<ChatActionData>({
        assistantMessage: {
          id: `msg_${Date.now()}`,
          role: "assistant",
          content: greeting,
          timestamp: new Date().toISOString(),
        },
        success: true,
      });
    } catch (error) {
      console.error("Error generating opening message:", error);
      const reason = error instanceof Error ? error.message : String(error);
      return json<ChatActionData>({ error: `Model request failed: ${reason}` });
    }
  }

  if (!content) {
    return json<ChatActionData>({ error: "Message content is required" });
  }

  // Add user message to history
  const userMessage: Message = {
    id: `msg_${Date.now()}`,
    role: "user",
    content,
    timestamp: new Date().toISOString(),
  };

  // System notices (errors) are UI-only and are never sent to the model.
  const updatedHistory = [
    ...history.filter(msg => msg.role !== "system"),
    userMessage,
  ];

  try {
    // Convert messages to the format expected by the AI service
    const formattedMessages = updatedHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // Generate response from the configured model
    const responseContent =
      await aiService.generateResponseWithHistory(formattedMessages);

    // Create assistant message
    const assistantMessage: Message = {
      id: `msg_${Date.now() + 1}`,
      role: "assistant",
      content: responseContent,
      timestamp: new Date().toISOString(),
    };

    return json<ChatActionData>({
      userMessage,
      assistantMessage,
      success: true,
    });
  } catch (error) {
    console.error("Error generating response:", error);
    const reason = error instanceof Error ? error.message : String(error);
    return json<ChatActionData>({
      userMessage,
      error: `Model request failed: ${reason}`,
    });
  }
}

export default function ChatPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ChatActionData>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const { modelStatus } = loaderData;
  const openingRequested = useRef(false);

  // When the conversation opens, ask the model for its greeting (opening
  // prompt template). Without a model, show an honest system notice.
  useEffect(() => {
    if (openingRequested.current) return;
    openingRequested.current = true;
    if (modelStatus.available) {
      fetcher.submit({ intent: "opening" }, { method: "post" });
    } else {
      setMessages([
        {
          id: `sys_${Date.now()}`,
          role: "system",
          content: modelStatus.error ?? "No language model is available.",
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update messages when action data changes
  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle") return;

    setMessages(prev => {
      const next = [...prev];
      if (data.userMessage) next.push(data.userMessage);
      if ("assistantMessage" in data) {
        next.push(data.assistantMessage);
      } else {
        // Honest system-level notice; never voiced as the assistant.
        next.push({
          id: `sys_${Date.now()}`,
          role: "system",
          content: data.error,
          timestamp: new Date().toISOString(),
        });
      }
      return next;
    });
  }, [fetcher.data, fetcher.state]);

  const isProcessing = fetcher.state !== "idle";

  return (
    <div className="h-screen flex flex-col">
      <ChatInterface
        messages={messages}
        onSendMessage={content => {
          fetcher.submit(
            { content, history: JSON.stringify(messages) },
            { method: "post" }
          );
        }}
        isProcessing={isProcessing}
        apiKeyConfigured={modelStatus.available}
        onConfigureApiKey={() => setShowApiKeyModal(true)}
      />

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4">Model Configuration</h2>
            <p className="mb-2 text-sm opacity-80">
              Replies are generated only by a real language model, hosted or
              local. The server uses, in order: <code>ECHO_MODEL_BASE_URL</code>{" "}
              (+ <code>ECHO_MODEL_NAME</code>, <code>ECHO_MODEL_API_KEY</code>),{" "}
              <code>OPENAI_API_KEY</code>, <code>HUGGINGFACE_API_KEY</code>,{" "}
              <code>NANECHO_URL</code>; otherwise it looks for a model served
              locally (Ollama, llama.cpp, LM Studio, vLLM,
              text-generation-webui, NanEcho) and uses it once it confirms a
              model is loaded. No API key is needed for local models.
            </p>
            <p className="mb-4 text-sm">
              Status:{" "}
              {modelStatus.available
                ? `Using ${modelStatus.description}.`
                : "No model available - chat requests will fail."}
            </p>
            {!modelStatus.available && modelStatus.error && (
              <pre className="text-xs mb-4 opacity-70 whitespace-pre-wrap">
                {modelStatus.error}
              </pre>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowApiKeyModal(false)}
                className="px-4 py-2 border border-border rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
