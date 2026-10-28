import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import ChatInterface, { Message } from "~/components/ChatInterface";
import { getAIService } from "~/services/ai.server";

export async function loader() {
  const aiService = getAIService();

  return json({
    apiKeyConfigured: aiService.isInitialized(),
  });
}

type ChatActionData =
  | { userMessage: Message; assistantMessage: Message; success: true }
  | { userMessage?: Message; error: string };

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const content = formData.get("content") as string;
  const history = JSON.parse(
    (formData.get("history") as string) || "[]"
  ) as Message[];

  if (!content) {
    return json<ChatActionData>({ error: "Message content is required" });
  }

  const aiService = getAIService();

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
        apiKeyConfigured={loaderData.apiKeyConfigured}
        onConfigureApiKey={() => setShowApiKeyModal(true)}
      />

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4">Model Configuration</h2>
            <p className="mb-2 text-sm opacity-80">
              Replies are generated only by a real language model. The server
              reads the key from the <code>OPENAI_API_KEY</code> environment
              variable; set it and restart the server to enable chat.
            </p>
            <p className="mb-4 text-sm">
              Status:{" "}
              {loaderData.apiKeyConfigured
                ? "API key configured on the server."
                : "No API key configured - chat requests will fail."}
            </p>
            <p className="text-xs mb-4 opacity-70">
              You can get an API key from the{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                OpenAI dashboard
              </a>
              .
            </p>

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
