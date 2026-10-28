import { useState } from "react";
import { motion } from "framer-motion";
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
    icon: <FiDatabase size={24} />,
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
    connections: ["observatory", "garden", "overview"],
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
                className="cursor-pointer bg-card hover:bg-card/90 rounded-lg shadow-md overflow-hidden border border-border"
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

// Shown wherever live state would be displayed but no data source is
// connected. Nothing here is presented as Echo's actual state.
const NoLiveData: React.FC<{ what: string }> = ({ what }) => (
  <div className="bg-card/30 p-3 rounded-md text-sm opacity-70 border border-dashed border-border mt-2">
    {what}: unavailable - no live data source is connected.
  </div>
);

interface RoomDetailProps {
  room: Room;
}

const RoomDetail: React.FC<RoomDetailProps> = ({ room }) => {
  // Unique content based on room type
  const renderRoomContent = (roomId: RoomType) => {
    switch (roomId) {
      case "memory-library":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Memory Collections</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {["Episodic", "Semantic", "Procedural", "Conceptual"].map(
                type => (
                  <div
                    key={type}
                    className="bg-card/50 p-3 rounded-md border border-border"
                  >
                    <h4 className="font-medium">{type} Memory</h4>
                  </div>
                )
              )}
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Recent Memories</h3>
              <NoLiveData what="Recent memories" />
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
              <NoLiveData what="Project status" />
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
                  className="bg-card/50 p-3 rounded-md border border-border"
                >
                  <h4 className="font-medium">{vis.name}</h4>
                  <div className="flex mt-2 space-x-1">
                    {Array(5)
                      .fill(0)
                      .map((_, i) => (
                        <div
                          key={i}
                          className="h-1.5 flex-1 rounded-full bg-purple-500/50"
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
                      Decorative animation - not live data
                    </div>
                  </div>
                </div>

                {/* Decorative background animation (not model state) */}
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
            <NoLiveData what="Training progress" />

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Active Training Session</h3>
              <NoLiveData what="Training metrics" />
            </div>
          </div>
        );

      case "observatory":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Insight Analytics</h3>
            <NoLiveData what="Insight metrics" />

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Meta-Cognitive Analysis</h3>
              <NoLiveData what="Meta-cognitive insights" />
            </div>
          </div>
        );

      case "garden":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Philosophical Seedlings</h3>
            <NoLiveData what="Ideas in development" />

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Creative Synthesis</h3>
              <NoLiveData what="Creative synthesis" />
            </div>
          </div>
        );

      case "communications-hub":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Communication Channels</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                "Direct Chat",
                "Memory Feedback Loop",
                "Knowledge Integration",
                "External API Connection",
              ].map(channel => (
                <div
                  key={channel}
                  className="bg-card/50 p-3 rounded-md border border-border"
                >
                  <h4 className="font-medium">{channel}</h4>
                </div>
              ))}
            </div>
            <NoLiveData what="Channel status" />

            <div className="mt-4">
              <h3 className="text-lg font-semibold">Recent Interactions</h3>
              <NoLiveData what="Interaction history" />
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
