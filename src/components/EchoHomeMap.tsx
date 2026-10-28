import { useState } from "react";
import { motion } from "framer-motion";
import { useMemory } from "../contexts/MemoryContext";
import { DeepTreeEchoService } from "../services/deepTreeEchoService";
import { describeModelError } from "../services/modelProvider";
import {
  FiBook,
  FiCode,
  FiCpu,
  FiDatabase,
  FiMessageCircle,
  FiFeather,
  FiEye,
  FiArrowLeft,
  FiInfo,
  FiSettings,
  FiArchive,
  FiZap,
} from "react-icons/fi";

// Define room types
export type RoomType =
  | "memory-library"
  | "workshop"
  | "visualization-studio"
  | "training-hall"
  | "observatory"
  | "garden"
  | "communications-hub"
  | "echospace"
  | "overview";

interface Room {
  id: RoomType;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  connections: RoomType[];
}

const ROOMS: Room[] = [
  {
    id: "memory-library",
    name: "Memory Library",
    description:
      "Repository of stored experiences, knowledge, and learned patterns.",
    icon: <FiBook size={24} />,
    color: "bg-indigo-500",
    position: { x: 20, y: 20 },
    size: { width: 200, height: 150 },
    connections: ["workshop", "observatory", "overview"],
  },
  {
    id: "workshop",
    name: "Workshop",
    description:
      "Creative space for coding, development, and technical implementation.",
    icon: <FiCode size={24} />,
    color: "bg-blue-500",
    position: { x: 240, y: 20 },
    size: { width: 200, height: 150 },
    connections: ["memory-library", "training-hall", "overview"],
  },
  {
    id: "visualization-studio",
    name: "Visualization Studio",
    description:
      "Transforms abstract data into insightful visual representations.",
    icon: <FiEye size={24} />,
    color: "bg-purple-500",
    position: { x: 20, y: 190 },
    size: { width: 200, height: 150 },
    connections: ["memory-library", "observatory", "overview"],
  },
  {
    id: "training-hall",
    name: "Training Hall",
    description:
      "Where echo state networks and neural architectures are refined.",
    icon: <FiCpu size={24} />,
    color: "bg-red-500",
    position: { x: 240, y: 190 },
    size: { width: 200, height: 150 },
    connections: ["workshop", "garden", "overview"],
  },
  {
    id: "observatory",
    name: "Observatory",
    description:
      "Space for insights, analytics, and meta-cognitive reflection.",
    icon: <FiArchive size={24} />,
    color: "bg-yellow-500",
    position: { x: 460, y: 20 },
    size: { width: 200, height: 150 },
    connections: ["memory-library", "communications-hub", "overview"],
  },
  {
    id: "garden",
    name: "Garden",
    description:
      "Nurtures creative and philosophical thinking through organic growth patterns.",
    icon: <FiFeather size={24} />,
    color: "bg-green-500",
    position: { x: 460, y: 190 },
    size: { width: 200, height: 150 },
    connections: ["training-hall", "communications-hub", "overview"],
  },
  {
    id: "communications-hub",
    name: "Communications Hub",
    description: "Central nexus for information exchange and conversation.",
    icon: <FiMessageCircle size={24} />,
    color: "bg-cyan-500",
    position: { x: 240, y: 360 },
    size: { width: 200, height: 150 },
    connections: ["observatory", "garden", "echospace", "overview"],
  },
  {
    id: "echospace",
    name: "EchoSpace",
    description:
      "Marduk's Agent-Arena-Relation architecture with recursive simulations.",
    icon: <FiZap size={24} />,
    color: "bg-orange-500",
    position: { x: 460, y: 360 },
    size: { width: 200, height: 150 },
    connections: ["communications-hub", "overview"],
  },
  {
    id: "overview",
    name: "Central Core",
    description:
      "The integrated core of Deep Tree Echo's cognitive architecture.",
    icon: <FiDatabase size={24} />,
    color: "bg-primary",
    position: { x: 240, y: 120 },
    size: { width: 200, height: 150 },
    connections: [
      "memory-library",
      "workshop",
      "visualization-studio",
      "training-hall",
      "observatory",
      "garden",
      "communications-hub",
      "echospace",
    ],
  },
];

interface EchoHomeMapProps {
  onRoomSelect?: (room: RoomType) => void;
}

const EchoHomeMap: React.FC<EchoHomeMapProps> = ({ onRoomSelect }) => {
  const [selectedRoom, setSelectedRoom] = useState<RoomType>("overview");
  const [previousRoom, setPreviousRoom] = useState<RoomType | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const handleRoomClick = (roomId: RoomType) => {
    setPreviousRoom(selectedRoom);
    setSelectedRoom(roomId);
    if (onRoomSelect) {
      onRoomSelect(roomId);
    }
  };

  const handleBackClick = () => {
    if (previousRoom) {
      setSelectedRoom(previousRoom);
      setPreviousRoom(null);
      if (onRoomSelect) {
        onRoomSelect(previousRoom);
      }
    } else {
      setSelectedRoom("overview");
      if (onRoomSelect) {
        onRoomSelect("overview");
      }
    }
  };

  const currentRoom = ROOMS.find(room => room.id === selectedRoom);
  const connectedRooms = ROOMS.filter(room =>
    currentRoom?.connections.includes(room.id)
  );

  // Background patterns based on selected room
  const getBgPattern = (roomId: RoomType) => {
    switch (roomId) {
      case "memory-library":
        return "bg-gradient-to-br from-indigo-800/20 to-indigo-600/10";
      case "workshop":
        return "bg-gradient-to-br from-blue-800/20 to-blue-600/10";
      case "visualization-studio":
        return "bg-gradient-to-br from-purple-800/20 to-purple-600/10";
      case "training-hall":
        return "bg-gradient-to-br from-red-800/20 to-red-600/10";
      case "observatory":
        return "bg-gradient-to-br from-yellow-800/20 to-yellow-600/10";
      case "garden":
        return "bg-gradient-to-br from-green-800/20 to-green-600/10";
      case "communications-hub":
        return "bg-gradient-to-br from-cyan-800/20 to-cyan-600/10";
      default:
        return "bg-gradient-to-br from-primary/20 to-primary/10";
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none h-12 bg-card text-card-foreground px-4 py-2 flex justify-between items-center border-b border-border">
        <div className="flex items-center space-x-2">
          {selectedRoom !== "overview" && (
            <button
              onClick={handleBackClick}
              className="p-1 hover:bg-primary/20 rounded-md"
            >
              <FiArrowLeft size={18} />
            </button>
          )}
          <span className="font-medium">
            {currentRoom?.name || "Echo Home"}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`p-1 rounded-md ${showInfo ? "bg-primary/20 text-primary" : "hover:bg-primary/20"}`}
          >
            <FiInfo size={18} />
          </button>
          <button className="p-1 hover:bg-primary/20 rounded-md">
            <FiSettings size={18} />
          </button>
        </div>
      </div>

      {/* Map Container */}
      <div className={`flex-1 ${getBgPattern(selectedRoom)} p-4 overflow-auto`}>
        {showInfo && currentRoom && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 bg-card/80 backdrop-blur-sm p-4 rounded-lg shadow-md"
          >
            <div className="flex items-start">
              <div className={`p-3 rounded-full ${currentRoom.color} mr-4`}>
                {currentRoom.icon}
              </div>
              <div>
                <h3 className="text-lg font-semibold">{currentRoom.name}</h3>
                <p className="text-sm opacity-80">{currentRoom.description}</p>
              </div>
            </div>
          </motion.div>
        )}

        {selectedRoom === "overview" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ROOMS.filter(room => room.id !== "overview").map(room => (
              <motion.div
                key={room.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleRoomClick(room.id)}
                className={`cursor-pointer bg-card hover:bg-card/90 rounded-lg shadow-md overflow-hidden border border-border hover:border-${room.color.replace("bg-", "")}/50`}
              >
                <div className={`h-2 ${room.color}`}></div>
                <div className="p-4">
                  <div className="flex items-center mb-2">
                    <div className={`p-2 rounded-full ${room.color}/20 mr-3`}>
                      {room.icon}
                    </div>
                    <h3 className="font-medium">{room.name}</h3>
                  </div>
                  <p className="text-sm opacity-70 line-clamp-2">
                    {room.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1">
              <RoomDetail room={currentRoom!} />
            </div>

            {/* Connected Rooms */}
            <div className="mt-4">
              <h3 className="text-sm font-medium opacity-70 mb-2">
                Connected Areas:
              </h3>
              <div className="flex flex-wrap gap-2">
                {connectedRooms.map(room => (
                  <motion.button
                    key={room.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleRoomClick(room.id)}
                    className={`flex items-center p-2 rounded-md ${room.color}/20 hover:${room.color}/30`}
                  >
                    {room.icon}
                    <span className="ml-2 text-sm">{room.name}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Garden room: seedlings are ideas written by the model (from the
 * philosophical-seedling prompt template, grounded in stored memories) and
 * kept in the memory system with the "seedling" tag.
 */
const GardenSeedlings: React.FC = () => {
  const { memories, addMemory } = useMemory();
  const [growing, setGrowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seedlings = memories
    .filter(memory => memory.tags.includes("seedling"))
    .slice()
    .reverse();

  const plantSeedling = async () => {
    setGrowing(true);
    setError(null);
    try {
      const seedling =
        await DeepTreeEchoService.getInstance().generatePhilosophicalSeedling({
          recentMemoryTitles: memories
            .filter(memory => !memory.tags.includes("seedling"))
            .slice(-8)
            .map(memory => memory.title),
          existingSeedlings: seedlings.map(memory => memory.title),
        });
      await addMemory({
        title: seedling.title,
        content: seedling.hypothesis,
        tags: [
          "seedling",
          `stage:${seedling.stage}`,
          ...seedling.domains.map(domain => `domain:${domain}`),
        ],
      });
    } catch (err) {
      setError(describeModelError(err));
    } finally {
      setGrowing(false);
    }
  };

  const tagValue = (tags: string[], prefix: string) =>
    tags
      .filter(tag => tag.startsWith(prefix))
      .map(tag => tag.slice(prefix.length));

  return (
    <div className="space-y-3">
      <button
        onClick={plantSeedling}
        disabled={growing}
        className="flex items-center text-sm bg-green-500/20 text-green-400 px-3 py-1.5 rounded-md disabled:opacity-50"
      >
        <FiFeather className="mr-2" />
        {growing ? "Growing a seedling..." : "Plant a new seedling"}
      </button>
      {error && (
        <div className="bg-red-500/10 p-3 rounded border border-red-500/30 text-sm whitespace-pre-wrap">
          System: {error}
        </div>
      )}
      {seedlings.length === 0 ? (
        <div className="bg-card/30 p-4 rounded-lg border border-border text-sm opacity-70">
          No seedlings yet. Each seedling is an idea written by the model.
        </div>
      ) : (
        seedlings.map(memory => (
          <div
            key={memory.id}
            className="bg-card/30 p-4 rounded-lg border border-border"
          >
            <h4 className="font-medium">{memory.title}</h4>
            <p className="text-sm opacity-70 mt-1">
              &quot;{memory.content}&quot;
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tagValue(memory.tags, "stage:").map(stage => (
                <div
                  key={stage}
                  className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded"
                >
                  {stage}
                </div>
              ))}
              {tagValue(memory.tags, "domain:").map(domain => (
                <div
                  key={domain}
                  className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded"
                >
                  {domain}
                </div>
              ))}
              <div className="text-xs opacity-50 ml-auto">
                {new Date(memory.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

interface RoomDetailProps {
  room: Room;
}

const RoomDetail: React.FC<RoomDetailProps> = ({ room }) => {
  const { memories } = useMemory();
  const recentMemories = memories.slice(-3).reverse();
  const recentConversations = memories
    .filter(memory => memory.tags.includes("conversation"))
    .slice(-3)
    .reverse();
  // Unique content based on room type
  const renderRoomContent = (roomId: RoomType) => {
    switch (roomId) {
      case "memory-library":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Memory Collections</h3>
            <div className="bg-card/50 p-3 rounded-md border border-border">
              <h4 className="font-medium">Stored Memories</h4>
              <div className="text-sm opacity-70 mt-1">
                {memories.length} entries
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Recent Memories</h3>
              <div className="space-y-2 mt-2">
                {recentMemories.length === 0 ? (
                  <div className="bg-card/30 p-2 rounded-md text-sm opacity-70">
                    No memories stored yet.
                  </div>
                ) : (
                  recentMemories.map(memory => (
                    <div
                      key={memory.id}
                      className="bg-card/30 p-2 rounded-md text-sm border-l-2 border-indigo-500"
                    >
                      {memory.title}
                      <div className="text-xs opacity-50 mt-1">
                        {new Date(memory.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );

      case "workshop":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Development Tools</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                "Code Editor",
                "Pattern Generator",
                "Neural Debugger",
                "Architecture Designer",
                "Function Library",
                "Testing Suite",
              ].map(tool => (
                <div
                  key={tool}
                  className="bg-card/50 p-3 rounded-md flex items-center border border-border"
                >
                  <FiCode className="mr-2 text-blue-400" />
                  <span className="text-sm">{tool}</span>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Recent Projects</h3>
              <div className="space-y-2 mt-2">
                <div className="bg-card/30 p-3 rounded-md">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Adaptive Resonance Network</h4>
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
                      Active
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full mt-2">
                    <div
                      className="h-2 bg-blue-500 rounded-full"
                      style={{ width: "65%" }}
                    ></div>
                  </div>
                  <div className="text-xs opacity-70 mt-1">65% complete</div>
                </div>

                <div className="bg-card/30 p-3 rounded-md">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Recursive Pattern Analyzer</h4>
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">
                      Paused
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full mt-2">
                    <div
                      className="h-2 bg-blue-500 rounded-full"
                      style={{ width: "38%" }}
                    ></div>
                  </div>
                  <div className="text-xs opacity-70 mt-1">38% complete</div>
                </div>
              </div>
            </div>
          </div>
        );

      case "visualization-studio":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Visualization Templates</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { name: "Neural Network Topology", color: "purple" },
                { name: "Conceptual Hypergraph", color: "blue" },
                { name: "Memory Association Map", color: "indigo" },
                { name: "Activation Pattern Flow", color: "pink" },
              ].map(vis => (
                <div
                  key={vis.name}
                  className={`bg-${vis.color}-900/20 p-3 rounded-md border border-${vis.color}-500/30`}
                >
                  <h4 className="font-medium">{vis.name}</h4>
                  <div className="flex mt-2 space-x-1">
                    {Array(5)
                      .fill(0)
                      .map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full bg-${vis.color}-500/50`}
                          style={{ opacity: 0.3 + i * 0.15 }}
                        ></div>
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Active Visualizations</h3>
              <div className="relative h-48 mt-2 bg-card/30 rounded-lg overflow-hidden border border-border">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-purple-400 mb-2">
                      Thought Pattern Network
                    </div>
                    <div className="flex space-x-2 justify-center">
                      {Array(3)
                        .fill(0)
                        .map((_, i) => (
                          <motion.div
                            key={i}
                            animate={{
                              scale: [1, 1.2, 1],
                              opacity: [0.7, 1, 0.7],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              delay: i * 0.6,
                            }}
                            className="w-3 h-3 rounded-full bg-purple-500"
                          ></motion.div>
                        ))}
                    </div>
                    <div className="text-xs mt-2 opacity-70">
                      Visualization active
                    </div>
                  </div>
                </div>

                {/* Simulated network visualization */}
                {Array(20)
                  .fill(0)
                  .map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-1.5 h-1.5 rounded-full bg-purple-500/60"
                      initial={{
                        x: Math.random() * 100 - 50 + 50 + "%",
                        y: Math.random() * 100 - 50 + 50 + "%",
                      }}
                      animate={{
                        x: Math.random() * 100 - 50 + 50 + "%",
                        y: Math.random() * 100 - 50 + 50 + "%",
                      }}
                      transition={{
                        duration: Math.random() * 10 + 10,
                        repeat: Infinity,
                        repeatType: "reverse",
                      }}
                    />
                  ))}
              </div>
            </div>
          </div>
        );

      case "training-hall":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Training Modules</h3>
            <div className="bg-card/30 p-4 rounded-lg border border-border text-sm opacity-70">
              Training metrics not available: no training run is connected to
              this view.
            </div>
          </div>
        );

      case "observatory":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Insight Analytics</h3>
            <div className="bg-card/30 p-4 rounded-lg border border-border text-sm opacity-70">
              Insight analytics not available: no evaluation data is connected
              to this view.
            </div>
          </div>
        );

      case "garden":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Philosophical Seedlings</h3>
            <GardenSeedlings />
          </div>
        );

      case "communications-hub":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Communication Channels</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { name: "Direct Chat", status: "Active", color: "green" },
                {
                  name: "Memory Feedback Loop",
                  status: "Active",
                  color: "green",
                },
                {
                  name: "Knowledge Integration",
                  status: "Background",
                  color: "blue",
                },
                {
                  name: "External API Connection",
                  status: "Standby",
                  color: "yellow",
                },
              ].map(channel => (
                <div
                  key={channel.name}
                  className="bg-card/50 p-3 rounded-md border border-border"
                >
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">{channel.name}</h4>
                    <div
                      className={`text-xs px-2 py-0.5 rounded bg-${channel.color}-500/20 text-${channel.color}-400`}
                    >
                      {channel.status}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center">
                    {channel.status === "Active" && (
                      <div className="flex items-center">
                        <motion.div
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className={`w-2 h-2 rounded-full bg-${channel.color}-500 mr-2`}
                        ></motion.div>
                        <div className="text-xs opacity-70">Transmitting</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Recent Interactions</h3>
              <div className="space-y-2 mt-2">
                {recentConversations.length === 0 ? (
                  <div className="bg-card/30 p-3 rounded-md text-sm opacity-70">
                    No interactions recorded yet.
                  </div>
                ) : (
                  recentConversations.map(memory => (
                    <div key={memory.id} className="bg-card/30 p-3 rounded-md">
                      <div className="flex justify-between">
                        <div className="font-medium">{memory.title}</div>
                        <div className="text-xs opacity-50">
                          {new Date(memory.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap">
                        {memory.content.substring(0, 200)}
                        {memory.content.length > 200 ? "..." : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="flex items-center justify-center h-full">
            <div className="text-center opacity-70">
              <div className="text-lg">Select a feature to explore</div>
              <div className="text-sm mt-2">
                Each area provides unique functionality
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-card/30 backdrop-blur-sm rounded-lg p-4 h-full overflow-y-auto"
    >
      {renderRoomContent(room.id)}
    </motion.div>
  );
};

export default EchoHomeMap;
