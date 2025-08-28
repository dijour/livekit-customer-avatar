"use client";

import { FloatingLoadingAvatar } from "@components/LoadingAvatar";
import { MaskedMediaView } from "@components/MaskedMediaView";
import { NoAgentNotification } from "@components/NoAgentNotification";
import PhotoCapture, { PhotoCaptureRef } from "@components/PhotoCapture";
import TranscriptionView from "@components/TranscriptionView";
import {
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useLocalParticipant,
  useVoiceAssistant,
} from "@livekit/components-react";
import { AnimatePresence, motion } from "framer-motion";
import { DataPacket_Kind, RemoteParticipant, Room, RoomEvent } from "livekit-client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Popover } from "../components/Popover";
import { Toggle } from "../components/Toggle";
import {
  BrowseIcon,
  CaptionIcon,
  CaptionOffIcon,
  ChevronIcon,
  MicrophoneOffIcon,
  MicrophoneOnIcon,
  PreferencesIcon,
  XmarkIcon,
} from "../components/icons";
import { useAvatarSetup } from "../hooks/useAvatarSetup";
import { useRoomData } from "../hooks/useRoomData";
import type { RoomContextType } from "../types/room";
import type { ConnectionDetails } from "./api/connection-details/route";

export default function Page() {
  const [room] = useState(new Room());
  const [error, setError] = useState<string>("");
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [isRestartingAvatar, setIsRestartingAvatar] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [showPhotoCaptureButton, setShowPhotoCaptureButton] = useState(true);
  const [showAlexaTransition, setShowAlexaTransition] = useState(false);
  const [showAvatarAppears, setShowAvatarAppears] = useState(false);
  const [voiceCloningEnabled, setVoiceCloningEnabled] = useState(false);
  const avatarSetup = useAvatarSetup(voiceCloningEnabled);
  const photoCaptureRef = useRef<PhotoCaptureRef | null>(null);

  // Check URL parameters for voice cloning enablement
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const enableVoiceCloning =
        urlParams.get("voiceCloning") === "true" ||
        urlParams.get("voice") === "true" ||
        window.location.hash.includes("voice");
      setVoiceCloningEnabled(enableVoiceCloning);
      console.log("🎤 Voice cloning enabled:", enableVoiceCloning);
    }
  }, []);

  const onConnectButtonClicked = useCallback(async () => {
    try {
      setIsAutoConnecting(true);

      // Generate room connection details, including:
      //   - A random Room name
      //   - A random Participant name
      //   - An Access Token to permit the participant to join the room
      //   - The URL of the LiveKit server to connect to
      //
      // In real-world application, you would likely allow the user to specify their
      // own participant name, and possibly to choose from existing rooms to join.

      const url = new URL(
        process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? "/api/connection-details",
        window.location.origin
      );

      // Use asset ID from avatar setup state
      const assetId = avatarSetup.state.assetId || localStorage.getItem("hedraAssetId");

      let response;
      if (assetId) {
        // Send asset ID via POST request
        response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assetId }),
        });
      } else {
        // Use GET request if no asset ID (Alexa mode)
        response = await fetch(url.toString());
      }

      const connectionDetailsData: ConnectionDetails = await response.json();
      console.log("Connection details:", connectionDetailsData);

      await room.connect(connectionDetailsData.serverUrl, connectionDetailsData.participantToken);
      await room.localParticipant.setMicrophoneEnabled(true);

      // Make room available globally for mode switching
      (window as any).liveKitRoom = room;

      // Register RPC methods for backend agent to call frontend functions
      room.registerRpcMethod("startCamera", async () => {
        console.log("🎥 Frontend RPC: startCamera called");

        // Photo capture UI should now always be available when no avatar exists
        console.log("🎥 Avatar exists:", !!avatarSetup.state.assetId);

        // Wait a moment for component to be ready if needed
        if (!photoCaptureRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log("🎥 photoCaptureRef.current:", photoCaptureRef.current);
        console.log(
          "🎥 photoCaptureRef.current?.startCamera:",
          photoCaptureRef.current?.startCamera
        );

        if (photoCaptureRef.current?.startCamera) {
          console.log("🎥 Calling photoCaptureRef.current.startCamera()");
          photoCaptureRef.current.startCamera();
          console.log("🎥 startCamera() called successfully");
          return JSON.stringify("Camera started");
        }
        console.log("🎥 ERROR: Photo capture component not available");
        return JSON.stringify("Camera component not available");
      });

      room.registerRpcMethod("capturePhoto", async () => {
        console.log("RPC: capturePhoto called");
        if (photoCaptureRef.current?.capturePhoto) {
          photoCaptureRef.current.capturePhoto();
          // Show Alexa transition video during avatar generation
          setShowAlexaTransition(true);
          return JSON.stringify("Photo captured");
        }
        return JSON.stringify("Photo capture component not available");
      });

      room.registerRpcMethod("skipPhoto", async () => {
        console.log("RPC: skipPhoto called");
        avatarSetup.handleSkipPhoto();
        return JSON.stringify("Photo skipped");
      });

      room.registerRpcMethod("isCameraActive", async () => {
        console.log("📷 RPC Method Called: isCameraActive");
        // Check if camera is available and ready
        const isActive = photoCaptureRef.current?.startCamera !== undefined;
        console.log("📷 Camera active status:", isActive);
        return JSON.stringify(isActive ? "true" : "false");
      });

      room.registerRpcMethod("generateAvatar", async (data) => {
        console.log("🎨 RPC: generateAvatar called");
        const requestData = JSON.parse(data.payload);
        const userPrompt = requestData.prompt || "";

        // Trigger avatar generation via custom event (same pattern as other actions)
        const generateEvent = new CustomEvent("generateAvatarRequest", {
          detail: { prompt: userPrompt },
        });
        window.dispatchEvent(generateEvent);

        // Show Alexa transition during avatar generation
        setShowAlexaTransition(true);
        return JSON.stringify("Avatar generation started");
      });

      room.registerRpcMethod("modifyAvatar", async (data) => {
        console.log("🎨 RPC: modifyAvatar called");
        const requestData = JSON.parse(data.payload);
        const userPrompt = requestData.prompt || "";

        // Trigger filter selection via custom event
        const filterEvent = new CustomEvent("filterRequest", {
          detail: { filterName: userPrompt },
        });
        window.dispatchEvent(filterEvent);

        // Show Alexa transition during avatar modification
        setShowAlexaTransition(true);
        return JSON.stringify("Avatar modification started");
      });
    } catch (error) {
      console.error("Failed to connect:", error);
      setIsAutoConnecting(false);
    }
  }, [room, avatarSetup]);

  // Monitor avatar creation and trigger phase transition
  useEffect(() => {
    console.log("🎭 Avatar state check:", {
      showAlexaTransition,
      assetId: avatarSetup.state.assetId,
      showAvatarAppears,
    });
    if (showAlexaTransition && avatarSetup.state.assetId && !showAvatarAppears) {
      console.log("🎭 Avatar ready! Triggering avatar appears video");
      setTimeout(() => {
        setShowAvatarAppears(true);
      }, 1000);
    }
  }, [showAlexaTransition, avatarSetup.state.assetId, showAvatarAppears]);

  // Handle data messages from backend agent for frontend control
  useEffect(() => {
    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      kind?: DataPacket_Kind,
      topic?: string
    ) => {
      if (topic === "frontend_control") {
        try {
          const message = JSON.parse(new TextDecoder().decode(payload));
          console.log("Received frontend control message:", message);

          switch (message.action) {
            case "show_photo_capture":
              // Force show photo capture UI
              console.log("Triggering photo capture UI, current step:", avatarSetup.state.step);
              avatarSetup.showPhotoCaptureAction();
              setTimeout(() => {
                console.log(
                  "Photo capture UI should now be visible, step:",
                  avatarSetup.state.step
                );
                setShowPhotoCaptureButton(true);
              }, 100);
              break;

            case "start_camera":
              // Start camera if photo capture component is available
              if (photoCaptureRef.current?.startCamera) {
                photoCaptureRef.current.startCamera();
              }
              break;

            case "capture_photo":
              // Capture photo if photo capture component is available
              if (photoCaptureRef.current?.capturePhoto) {
                photoCaptureRef.current.capturePhoto();
              }
              break;

            case "skip_photo":
              // Skip photo capture
              avatarSetup.handleSkipPhoto();
              break;

            case "generate_avatar":
              // Trigger avatar generation with the provided prompt
              console.log("🎨 Triggering avatar generation with prompt:", message.prompt);
              // We need to access handleGenerateAvatar from PhotoCaptureControls
              // For now, dispatch a custom event that PhotoCaptureControls can listen to
              const generateEvent = new CustomEvent("generateAvatarRequest", {
                detail: { prompt: message.prompt || "" },
              });
              window.dispatchEvent(generateEvent);
              break;
          }
        } catch (error) {
          console.error("Error parsing frontend control message:", error);
        }
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, avatarSetup, photoCaptureRef]);

  // Clear room context on component mount to ensure clean session start
  useEffect(() => {
    const clearSessionState = async () => {
      // Clear any existing room participants/agents from previous sessions
      if (room.remoteParticipants.size > 0) {
        console.log("🧹 Clearing existing room participants from previous session");
        room.remoteParticipants.clear();
      }

      // Clear room metadata to prevent avatar mode persistence
      if (room.metadata) {
        console.log("🧹 Clearing room metadata from previous session");
        // Clear metadata by setting it to empty via setMetadata
        room.localParticipant.setMetadata("");
      }

      // Clear avatar state from API endpoint on session start
      try {
        await fetch("/api/clear-avatar-state", { method: "POST" });
        console.log("🧹 Cleared avatar state from API");
      } catch (error) {
        console.error("Failed to clear avatar state on session start:", error);
      }
    };

    clearSessionState();
  }, [room]);

  // Auto-start conversation only after user interaction (to allow audio playback)
  useEffect(() => {
    if (hasUserInteracted && room.state === "disconnected" && !isAutoConnecting) {
      onConnectButtonClicked();
    }
  }, [hasUserInteracted, room.state, isAutoConnecting, onConnectButtonClicked]);

  const handleStartExperience = useCallback(() => {
    setHasUserInteracted(true);
  }, []);

  const handleResetExperience = useCallback(async () => {
    // Disconnect from room and clear all room state
    if (room.state === "connected") {
      await room.disconnect();
    }

    // Clear any lingering room participants or agents
    room.remoteParticipants.clear();

    // Clear room metadata to ensure fresh start
    if (room.metadata) {
      room.localParticipant.setMetadata("");
    }

    // Reset all states
    setHasUserInteracted(false);
    setIsAutoConnecting(false);

    // Reset avatar setup
    avatarSetup.reset();

    // Clear localStorage
    localStorage.removeItem("hedraAssetId");

    // Reset voice state on backend
    try {
      await fetch("/api/reset-voice-state", { method: "POST" });
    } catch (error) {
      console.error("Failed to reset voice state:", error);
    }

    // Clear avatar state from API endpoint
    try {
      await fetch("/api/clear-avatar-state", { method: "POST" });
    } catch (error) {
      console.error("Failed to clear avatar state:", error);
    }
  }, [room, avatarSetup]);

  // Hide Alexa transition when avatar is ready

  useEffect(() => {
    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);

    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
    };
  }, [room]);

  // Show start experience button if user hasn't interacted yet
  if (!hasUserInteracted) {
    return (
      <main
        data-lk-theme="default"
        style={{ fontFamily: "Amazon Ember Display, system-ui, sans-serif" }}
        className="h-screen flex flex-col items-center justify-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md mx-auto px-6"
        >
          <div
            className="absolute inset-0 bg-[#0E1A27] opacity-50"
            style={{
              zIndex: -1000,
              backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")',
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {" "}
          </div>
          <Button onClick={handleStartExperience}>Start</Button>

          <motion.p
            className="text-sm text-white/60 mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            Click to enable audio and begin your guided avatar setup
          </motion.p>
        </motion.div>
      </main>
    );
  }

  return (
    // anchor
    <main
      data-lk-theme="default"
      style={{ fontFamily: "Amazon Ember Display, system-ui, sans-serif" }}
      className="h-screen flex flex-col"
    >
      <RoomContext.Provider value={room as RoomContextType}>
        {/* Always show voice assistant for agent connection */}
        <div
          className="absolute inset-0 bg-[#0E1A27] opacity-50"
          style={{
            zIndex: -1000,
            backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")',
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {" "}
        </div>

        <SimpleVoiceAssistant
          onConnectButtonClicked={onConnectButtonClicked}
          isAutoConnecting={isAutoConnecting}
          photoCaptureRef={photoCaptureRef}
          onResetExperience={handleResetExperience}
          showPhotoCaptureButton={showPhotoCaptureButton}
          avatarExists={!!avatarSetup.state.assetId}
          onShowAlexaTransition={() => setShowAlexaTransition(true)}
          avatarSetup={avatarSetup}
        />

        {/* Floating Loading Avatar */}
        <FloatingLoadingAvatar />

        {/* Error notification */}
        <AnimatePresence>
          {avatarSetup.state.error && (
            <motion.div
              key="error-notification"
              initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.3 }}
              className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 backdrop-blur-sm text-white px-6 py-3 rounded-lg shadow-lg"
            >
              <p className="text-sm">{avatarSetup.state.error}</p>
              <p className="text-xs mt-1 opacity-75">Continuing without custom avatar</p>
            </motion.div>
          )}
        </AnimatePresence>
      </RoomContext.Provider>
    </main>
  );
}

function SimpleVoiceAssistant(props: {
  onConnectButtonClicked: () => void;
  isAutoConnecting: boolean;
  photoCaptureRef: React.RefObject<PhotoCaptureRef | null>;
  onResetExperience: () => Promise<void>;
  showPhotoCaptureButton: boolean;
  avatarExists: boolean;
  onShowAlexaTransition: () => void;
  avatarSetup: any;
}) {
  const { state: agentState, videoTrack } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const [isMuted, setIsMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);

  const toggleMicrophone = useCallback(async () => {
    if (localParticipant) {
      const newMutedState = !isMuted;
      await localParticipant.setMicrophoneEnabled(!newMutedState);
      setIsMuted(newMutedState);
    }
  }, [localParticipant, isMuted]);

  const toggleCaptions = useCallback(() => {
    setShowCaptions(!showCaptions);
  }, [showCaptions]);

  // Log agent state changes
  useEffect(() => {
    console.log("🤖 Agent State Changed:", agentState);
    console.log("🤖 Agent State Details:", {
      state: agentState,
      timestamp: new Date().toISOString(),
      avatarExists: props.avatarExists,
      isAutoConnecting: props.isAutoConnecting,
    });
  }, [agentState, props.avatarExists, props.isAutoConnecting]);

  // Log when avatarExists becomes true
  useEffect(() => {
    if (props.avatarExists) {
      console.log("🤖 Avatar exists is now true - avatar is ready!");
    }
  }, [props.avatarExists]);
  return (
    <div className="h-screen flex flex-col relative">
      {/* Main content area with AgentVisualizer in normal document flow */}
      <div className="flex-1 flex items-center justify-center">
        {agentState !== "disconnected" && videoTrack && (
          <div
            className="pointer-events-none"
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <AgentVisualizer avatarExists={props.avatarExists} />
          </div>
        )}
      </div>

      {/* Show photo capture overlay when no avatar exists or when triggered by agent */}
      <AnimatePresence mode="wait">
        {(!props.avatarSetup.state.assetId || props.avatarSetup.showPhotoCapture) && (
          <PhotoCapture
            key="photo-capture"
            ref={props.photoCaptureRef}
            onPhotoCapture={props.avatarSetup.handlePhotoCapture}
            onSkip={props.avatarSetup.handleSkipPhoto}
            // onShowAlexaTransition={() => {
            //   console.log('🎬 PhotoCapture triggered Alexa transition');
            //   setShowAlexaTransition(true);
            // }}
            onStateChange={(state) => {
              // Update PhotoCaptureControls state when PhotoCapture state changes
              if (props.photoCaptureRef.current) {
                // Find and update the PhotoCaptureControls component state
                const event = new CustomEvent("photoCaptureStateChange", { detail: state });
                window.dispatchEvent(event);
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {agentState !== "disconnected" && (
          <>
            {/* Photo capture top control bar */}
            <div className="fixed top-0 left-0 right-0 z-40">
              <div className="relative px-[48px] py-[36px]">
                {/* Left circular button */}
                <div className="absolute left-[48px] top-[36px]">
                  <button
                    onClick={props.onResetExperience}
                    className="w-[72px] h-[72px] bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
                  >
                    <XmarkIcon size={36} className="text-white" />
                  </button>
                </div>

                {/* Center personality selector - horizontally centered, vertically aligned with buttons */}
                {/* {props.avatarExists && (
                  <div className="absolute left-1/2 top-[36px] -translate-x-1/2">
                    <TopNavPersonalitySelector />
                  </div>
                )} */}

                {/* Right buttons */}
                <div className="absolute right-[48px] top-[36px] flex gap-4">
                  {props.avatarExists && <TopNavPersonalitySelector />}
                  <button
                    onClick={toggleCaptions}
                    className="w-[72px] h-[72px] bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
                  >
                    {showCaptions ? (
                      <CaptionOffIcon size={36} className="text-white" />
                    ) : (
                      <CaptionIcon size={36} className="text-white" />
                    )}
                  </button>
                  <button
                    onClick={toggleMicrophone}
                    className="w-[72px] h-[72px] bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
                  >
                    {isMuted ? (
                      <MicrophoneOffIcon size={36} className="text-white" />
                    ) : (
                      <MicrophoneOnIcon size={36} className="text-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom toolbar with transcription and controls */}
            <div className="fixed bottom-0 left-0 right-0 flex flex-row items-end gap-4 p-[48px]">
              {/* Left column - Transcription */}
              <div className="flex-1">{showCaptions && <TranscriptionView />}</div>

              {/* Center column - Avatar visual editing controls (only when avatar exists and is visible) */}
              {props.avatarExists && (
                <div className="flex-shrink-0">
                  <AvatarVisualControls />
                </div>
              )}

              {/* Right column - Photo capture controls (only show when no avatar exists) */}
              {!props.avatarExists && (
                <div className="flex-shrink-0">
                  <PhotoCaptureControls
                    photoCaptureRef={props.photoCaptureRef}
                    showPhotoCaptureButton={props.showPhotoCaptureButton}
                    avatarExists={!!props.avatarExists}
                    onShowAlexaTransition={props.onShowAlexaTransition}
                    avatarSetup={props.avatarSetup}
                  />
                </div>
              )}
            </div>

            <RoomAudioRenderer />
            <NoAgentNotification state={agentState} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentVisualizer(props: { avatarExists: boolean }) {
  const { videoTrack } = useVoiceAssistant();

  // Show video track when available
  if (!videoTrack) return null;

  return (
    <div
      className="relative rounded-2xl overflow-hidden aspect-square mx-auto"
      style={{ width: "min(80vh, 80vw)", height: "min(80vh, 80vw)" }}
    >
      <MaskedMediaView>
        <VideoTrack trackRef={videoTrack} />
      </MaskedMediaView>
    </div>
  );
}

function TopNavPersonalitySelector() {
  const [personalityEnabled, setPersonalityEnabled] = useState(false);
  const [currentPersonalityIndex, setCurrentPersonalityIndex] = useState(0);
  const [selectedPersonalityIndex, setSelectedPersonalityIndex] = useState(0); // Core personality is selected by default
  const [hasInteractedWithCarousel, setHasInteractedWithCarousel] = useState(false);
  const personalityRef = useRef<HTMLButtonElement>(null);
  const { publishData } = useRoomData();

  // Personality carousel data
  const personalities = [
    {
      id: "alexa",
      name: "Alexa",
      subtitle: "The Alexa you know and love.",
      media: "/images/heart.gif",
    },
    {
      id: "minimalist",
      name: "Minimalist",
      subtitle: "Your primary question or topic for today's discussion?",
      media: "/images/check.gif",
    },
    {
      id: "free_spirit",
      name: "Free Spirit",
      subtitle: "All good vibes over here, dude. Take it easy!",
      media: "/images/clouds.gif",
    },
    {
      id: "disruptor",
      name: "Disruptor",
      subtitle:
        "Fan-f***ing-tastic! Just destroying everyone's B.S. Ask me a stupid question, I dare you.",
      media: "/images/flame.gif",
    },
    {
      id: "supporter",
      name: "Supporter",
      subtitle: "I'm just living my best life cheering on amazing people like YOU! Keep shining!",
      media: "/images/flower.gif",
    },
    {
      id: "dreamer",
      name: "Dreamer",
      subtitle:
        "My spirit is doing cartwheels through a rainbow while my mind is having tea with the universe - so, basically, I'm cosmically wonderful!",
      media: "/images/star.gif",
    },
    {
      id: "rockstar",
      name: "Rockstar",
      subtitle: "I'm living so legendarily right now that even my haters are taking notes.",
      media: "/images/fireworks.gif",
    },
    {
      id: "cyber_cadet",
      name: "Cyber Cadet",
      subtitle: "Boredom detected. Let's optimize your fun levels, cadet!",
      media: "/images/rocket.gif",
    },
    {
      id: "silly_owl",
      name: "Silly Owl",
      subtitle: "Hoot! Pip pip! I'm just learning to spread my wings!",
      media: "/images/owl.gif",
    },
  ];

  const handlePersonalitySelection = useCallback(async () => {
    const selectedPersonality = personalities[currentPersonalityIndex];
    console.log("🎭 Personality selected:", selectedPersonality.name);

    // Send personality selection to backend via LiveKit data channel
    try {
      await publishData("personality_selection", {
        personalityName: selectedPersonality.name,
        personalityIndex: currentPersonalityIndex,
      });
      console.log("📡 Personality data sent to backend");
    } catch (error) {
      console.error("Failed to send personality data:", error);
    }

    // Update selected personality and close the popover
    setSelectedPersonalityIndex(currentPersonalityIndex);
    setPersonalityEnabled(false);
    setHasInteractedWithCarousel(false);
  }, [currentPersonalityIndex, personalities, publishData]);

  const handlePersonalityToggle = useCallback((toggled: boolean) => {
    console.log("🔄 handlePersonalityToggle called:", { toggled });
    setPersonalityEnabled(toggled);
    console.log("Personality:", toggled ? "enabled" : "disabled");

    // Reset carousel interaction state when closing
    if (!toggled) {
      setHasInteractedWithCarousel(false);
    }
  }, []);

  const closePersonalityPopover = useCallback(() => {
    setPersonalityEnabled(false);
    setHasInteractedWithCarousel(false);
  }, []);

  // Carousel navigation functions
  const goToPreviousPersonality = useCallback(() => {
    console.log("⬅️ Previous personality clicked");
    setCurrentPersonalityIndex((prev) => (prev === 0 ? personalities.length - 1 : prev - 1));
    setHasInteractedWithCarousel(true);
    console.log("🎯 hasInteractedWithCarousel set to true");
  }, [personalities.length]);

  const goToNextPersonality = useCallback(() => {
    console.log("➡️ Next personality clicked");
    setCurrentPersonalityIndex((prev) => (prev + 1) % personalities.length);
    setHasInteractedWithCarousel(true);
    console.log("🎯 hasInteractedWithCarousel set to true");
  }, [personalities.length]);

  const currentPersonality = personalities[currentPersonalityIndex];

  return (
    <div className="relative">
      <Toggle
        ref={personalityRef}
        isToggled={personalityEnabled}
        onToggle={handlePersonalityToggle}
        icon={<BrowseIcon size={32} />}
        className="w-[210px] bg-white/10 hover:bg-white/20 text-white"
      >
        Personality
      </Toggle>
      <Popover
        width={436}
        align="bottom"
        isOpen={personalityEnabled}
        onClose={closePersonalityPopover}
        triggerRef={personalityRef}
      >
        <div className="relative w-full h-[420px]">
          <motion.div
            key={currentPersonalityIndex}
            className="relative w-full h-full flex flex-col justify-center items-center"
          >
            {/* Background Video */}
            {currentPersonality.media.endsWith(".mp4") ? (
              <video
                className="absolute inset-0 w-full h-full object-cover rounded-[36px]"
                src={currentPersonality.media}
                autoPlay
                loop
                muted
              />
            ) : (
              <img
                className="absolute inset-0 w-full h-full object-cover rounded-[36px]"
                src={currentPersonality.media}
              />
            )}
            <motion.button
              onClick={goToPreviousPersonality}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 hover:opacity-70 transition-opacity"
              transition={{ duration: 0.1 }}
            >
              <ChevronIcon size={48} className="text-white" />
            </motion.button>

            <motion.button
              onClick={goToNextPersonality}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 hover:opacity-70 transition-opacity"
              transition={{ duration: 0.1 }}
            >
              <ChevronIcon size={48} className="text-white -rotate-180" />
            </motion.button>

            <motion.div
              className="absolute bottom-8 left-8 right-8 z-10 flex flex-row justify-between items-end"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="flex flex-col w-full">
                <div className="text-white text-xl font-bold leading-8">
                  {currentPersonality.name}
                </div>
                <div className="text-white/50 text-base font-normal leading-6 ">
                  {currentPersonality.subtitle}
                </div>
              </div>

              {currentPersonalityIndex !== selectedPersonalityIndex && (
                <Button
                  width="144px"
                  height="60px"
                  onClick={handlePersonalitySelection}
                  className="ml-4 w-[144px] h-[60px] bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white px-6 py-2 rounded-full text-xl font-medium transition-colors"
                >
                  Use this
                </Button>
              )}
            </motion.div>
          </motion.div>
        </div>
      </Popover>
    </div>
  );
}

function AvatarVisualControls() {
  const [filtersEnabled, setFiltersEnabled] = useState(false);
  const [loadingFilter, setLoadingFilter] = useState<string | null>(null);
  const [filterCooldownRemaining, setFilterCooldownRemaining] = useState(30); // Start with 30 second cooldown
  const [isFilterCooldownActive, setIsFilterCooldownActive] = useState(true); // Start locked when avatar first appears
  const filtersRef = useRef<HTMLButtonElement>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { publishData } = useRoomData();

  const { state } = useAvatarSetup();
  const blob = state.userPhoto; // This is your original photo blob

  // Start cooldown timer function
  const startFilterCooldown = useCallback(() => {
    setIsFilterCooldownActive(true);
    setFilterCooldownRemaining(30);

    // Clear any existing timer
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
    }

    // Start countdown
    cooldownTimerRef.current = setInterval(() => {
      setFilterCooldownRemaining((prev) => {
        if (prev <= 1) {
          setIsFilterCooldownActive(false);
          if (cooldownTimerRef.current) {
            clearInterval(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start initial cooldown when component mounts (avatar first appears)
  useEffect(() => {
    startFilterCooldown();
  }, [startFilterCooldown]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, []);

  const handleFiltersToggle = useCallback(
    (toggled: boolean) => {
      // Prevent opening if cooldown is active
      if (toggled && isFilterCooldownActive) {
        return;
      }
      // Prevent closing if a filter is currently loading
      if (!toggled && loadingFilter) {
        return;
      }
      setFiltersEnabled(toggled);
      console.log("Filters:", toggled ? "enabled" : "disabled");
    },
    [loadingFilter, isFilterCooldownActive]
  );

  const closeFiltersPopover = useCallback(() => {
    // Prevent closing if a filter is currently loading
    if (loadingFilter) {
      return;
    }
    setFiltersEnabled(false);
  }, [loadingFilter]);

  const handleFilterSelection = useCallback(
    async (filterName: string) => {
      // Send immediate message to agent that filter process is starting
      try {
        // Create a message based on the filter type
        const filterMessages: Record<string, string> = {
          "add a funny hat":
            "Got it, I'm adding a funny hat. This could take up to 30 seconds. Feel free to chat with me in the meantime.",
          "make me pixar style":
            "Got it, I'm transforming into Pixar style.  This could take up to 30 seconds. Feel free to chat with me in the meantime.",
          "give me studio lighting":
            "Got it, I'll apply studio lighting.  This could take up to 30 seconds. Feel free to chat with me in the meantime.",
        };

        // Default message if filter type isn't in our predefined list
        const lowerCaseFilterName = filterName.toLowerCase();
        const message =
          filterMessages[lowerCaseFilterName] ||
          `Got it. I'll have a new appearance very soon. This could take up to 30 seconds. Feel free to chat with me in the meantime.`;

        await publishData("agent_message", {
          message,
          filterName,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("Failed to send agent message:", error);
      }

      // Set loading state
      setLoadingFilter(filterName);

      console.log("🎨 Filter selected:", filterName);
      const currentID = localStorage.getItem("hedraAssetId");
      console.log(currentID);

      const assetResponse = await fetch(`/api/get-hedra-asset?id=${currentID}`);
      const assetResult = await assetResponse.json();
      const assetUrl = assetResult.data[0]?.asset?.url;
      console.log("Asset URL:", assetUrl);

      // Download the image from the URL and convert to blob
      let blob = null;
      if (assetUrl) {
        try {
          const imageResponse = await fetch(assetUrl);
          blob = await imageResponse.blob();
          console.log("Downloaded image blob:", blob);
          const enhanceFormData = new FormData();
          enhanceFormData.append("image", blob, "photo.jpg");
          enhanceFormData.append("prompt", filterName);
          const enhanceResponse = await fetch("/api/enhance-image", {
            method: "POST",
            body: enhanceFormData,
          });

          const enhanceResult = await enhanceResponse.json();
          console.log("Modified image result:", enhanceResult);
          if (enhanceResult.success) {
            // Convert base64 string back to blob for upload
            const base64Data = enhanceResult.enhancedImage;
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const enhancedBlob = new Blob([byteArray], { type: "image/jpeg" });

            console.log("Enhanced blob created:", enhancedBlob.size, "bytes");

            const avatarFormData = new FormData();
            avatarFormData.append("photo", enhancedBlob, "avatar-photo.jpg");

            const avatarResponse = await fetch("/api/create-avatar", {
              method: "POST",
              body: avatarFormData,
            });
            const avatarResult = await avatarResponse.json();
            console.log("New avatar result:", avatarResult);

            if (!avatarResult.assetId) {
              throw new Error("No asset ID received from avatar creation");
            }

            // Send avatar ID to backend via LiveKit data channel
            try {
              await publishData("filter_selection", {
                filterID: avatarResult.assetId,
                timestamp: Date.now(),
              });
              console.log("📡 Filter data sent to backend");

              // Start cooldown after successful filter application
              startFilterCooldown();
            } catch (error) {
              console.error("Failed to send filter data:", error);
            }
          }

          if (!enhanceResponse.ok) {
            // Handle enhancement errors, especially safety rejections
            console.error("Image enhancement failed:", enhanceResult);

            try {
              await publishData("filter_error", {
                errorType: enhanceResult.type || "Unknown",
                errorDetails: enhanceResult.details || "Unknown error",
                isSafetyRejection: enhanceResult.isSafetyRejection || false,
                timestamp: Date.now(),
              });
              console.log("📡 Filter error data sent to backend");
            } catch (error) {
              console.error("Failed to send filter error data:", error);
            }
            return;
          }
        } catch (error) {
          console.error("Failed to download image from URL:", error);
          return;
        }
      } else {
        console.error("No asset URL found");
        return;
      }

      // Here, we need to take our current photo, and modify it with our modify image endpoint.
      // we will then upload the modified image to Hedra and obtain a new avatar ID.
      // then, below, we will send the new avatar ID to the backend via LiveKit data channel.

      if (!blob) {
        console.error("No original photo blob available");
        return;
      }
      // const formData = new FormData();
      // formData.append("image", blob, "photo.jpg");

      // const response = await fetch("/api/enhance-image", {
      //   method: "POST",
      //   body: formData,
      // });

      // // Send avatar ID to backend via LiveKit data channel
      // try {
      //   await publishData('filter_selection', {
      //     filterID: placeholderID,
      //     timestamp: Date.now()
      //   });
      //   console.log('📡 Filter data sent to backend');
      // } catch (error) {
      //   console.error('Failed to send filter data:', error);
      // }

      // Close the popover and clear loading state
      setFiltersEnabled(false);
      setLoadingFilter(null);
    },
    [publishData, startFilterCooldown]
  );

  // Listen for filter requests from RPC
  useEffect(() => {
    const handleFilterRequest = (event: CustomEvent) => {
      const { filterName } = event.detail;
      console.log("🎨 Filter request received in AvatarVisualControls:", filterName);
      handleFilterSelection(filterName);
    };

    window.addEventListener("filterRequest", handleFilterRequest as EventListener);

    return () => {
      window.removeEventListener("filterRequest", handleFilterRequest as EventListener);
    };
  }, [handleFilterSelection]);

  return (
    <div className="flex gap-4 relative">
      {/* <Button
          ref={filtersRef}
          onClick={() => handleFilterSelection('Add a funny hat')}
        >
          "Add a funny hat"
        </Button>
        <Button
          ref={filtersRef}
          onClick={() => handleFilterSelection('Make me a cartoon')}
        >
          "Make me a cartoon"
        </Button> */}

      {/* <Toggle
          ref={filtersRef}
          isToggled={filtersEnabled}
          onToggle={handleFiltersToggle}
          icon={<PreferencesIcon size={32} />}
          disabled={isFilterCooldownActive}
          className={isFilterCooldownActive ? "opacity-50 cursor-not-allowed" : ""}
        >
          {isFilterCooldownActive ? `Filters (${filterCooldownRemaining}s)` : "Filters"}
        </Toggle>
        <Popover
          width={300}
          align="right"
          isOpen={filtersEnabled}
          onClose={closeFiltersPopover}
          triggerRef={filtersRef}
        >
          <style dangerouslySetInnerHTML={{
            __html: `
              @keyframes gradientShift {
                0% {
                  background-position: 100% 50%;
                }
                100% {
                  background-position: 0% 50%;
                }
              }
              .gradient-loading {
                background: linear-gradient(90deg, #00ACFF, #016CFF, #6EDCFF, #00ACFF, #016CFF, #6EDCFF, #00ACFF);
                background-size: 200% 100%;
                animation: gradientShift 1.5s linear infinite;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }
            `
          }} />
          <div className="w-full flex flex-col justify-center items-center overflow-hidden rounded-[36px]">
            <div
              className="w-full h-16 px-6 inline-flex justify-start items-center gap-3 transition-colors cursor-pointer first:rounded-t-[36px] last:rounded-b-[36px]"
              onClick={() => handleFilterSelection('Add a funny hat')}
            >
              <div className={`justify-start text-xl font-normal leading-7 ${loadingFilter === 'Add a funny hat'
                ? 'gradient-loading'
                : 'text-white'
                }`}>Add a funny hat</div>
            </div>
            <div className="w-full h-px relative bg-neutral-100/10"></div>
            <div
              className="w-full h-16 px-6 inline-flex justify-start items-center gap-3 transition-colors cursor-pointer"
              onClick={() => handleFilterSelection('Make me Pixar style')}
            >
              <div className={`justify-start text-xl font-normal leading-7 ${loadingFilter === 'Make me Pixar style'
                ? 'gradient-loading'
                : 'text-white'
                }`}>Make me Pixar style</div>
            </div>
            <div className="w-full h-px relative bg-neutral-100/10"></div>
            <div
              className="w-full h-16 px-6 inline-flex justify-start items-center gap-3 transition-colors cursor-pointer first:rounded-t-[36px] last:rounded-b-[36px]"
              onClick={() => handleFilterSelection('Give me studio lighting')}
            >
              <div className={`justify-start text-xl font-normal leading-7 ${loadingFilter === 'Give me studio lighting'
                ? 'gradient-loading'
                : 'text-white'
                }`}>Give me studio lighting</div>
            </div>
          </div>
        </Popover> */}
    </div>
  );
}

function PhotoCaptureControls({
  photoCaptureRef,
  showPhotoCaptureButton,
  avatarExists,
  onShowAlexaTransition,
  avatarSetup,
}: {
  photoCaptureRef: React.RefObject<PhotoCaptureRef | null>;
  showPhotoCaptureButton: boolean;
  avatarExists: boolean;
  onShowAlexaTransition: () => void;
  avatarSetup: any;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(false);
  const [currentStep, setCurrentStep] = useState<"capture" | "enhance" | "confirm">("capture");
  const [error] = useState<string | null>(null);
  const { publishData } = useRoomData();

  // Feature flag: enable full workflow only if URL contains #modify
  const isModifyMode = typeof window !== "undefined" && window.location.hash.includes("modify");

  const handleDescribeImageRequest = useCallback(async () => {
    console.log("🎥Frontend Button Clicked: handleDescribeImageRequest called");

    try {
      // Send a message to the agent to prompt the user for avatar description
      await publishData("agent_message", {
        message:
          "I'd love to help you create a custom avatar! Please describe what kind of avatar you'd like me to generate for you. For example, you could say 'generate an avatar of a professional businesswoman with short brown hair' or 'create an avatar that looks like a friendly teacher with glasses'.",
        action: "prompt_for_avatar_description",
        timestamp: Date.now(),
      });

      console.log("✅ Sent prompt request to agent");
    } catch (error) {
      console.error("❌ Failed to send prompt request to agent:", error);
    }
  }, [publishData]);

  const handleGenerateAvatar = useCallback(
    async (userPrompt: string = "") => {
      console.log("🎥Frontend Button Clicked: generateAvatar called");

      try {
        // Show loading avatar immediately when function is called
        console.log("🔄 Showing loading avatar immediately");
        if (typeof window !== "undefined") {
          // Show loading avatar without a photo initially
          window.dispatchEvent(
            new CustomEvent("showLoadingAvatar", {
              detail: { photo: null },
            })
          );
        }

        // Show Alexa transition during avatar generation
        onShowAlexaTransition();

        // Step 1: Generate an image using OpenAI (similar to enhance-image API)
        console.log("🎨 Generating avatar image with OpenAI...");

        const formData = new FormData();
        // Create a base prompt and append user prompt if provided
        const basePrompt =
          "You are an avatar generator. A user has just requested to create a new avatar with a custom description. Your only constraints are that you must generate something with two eyes, a mouth, and a nose. The avatar should have a friendly, approachable expression, good lighting, and be suitable for professional use.";
        if (userPrompt.length > 0) {
          userPrompt = "USER AVATAR REQUEST: " + userPrompt;
        }
        const fullPrompt = userPrompt ? `${basePrompt} ${userPrompt}` : basePrompt;
        formData.append("prompt", fullPrompt);

        const generateResponse = await fetch("/api/generate-image", {
          method: "POST",
          body: formData,
        });

        if (!generateResponse.ok) {
          throw new Error(`Image generation failed: ${generateResponse.status}`);
        }

        const generateResult = await generateResponse.json();

        if (!generateResult.success || !generateResult.generatedImage) {
          throw new Error("No generated image received from OpenAI");
        }

        console.log("✅ Image generated successfully");

        // Step 2: Convert base64 image to Blob for avatar creation
        const base64Data = generateResult.generatedImage;
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const imageBlob = new Blob([bytes], { type: "image/jpeg" });

        // Update the loading avatar with the generated image
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("showLoadingAvatar", {
              detail: { photo: imageBlob },
            })
          );
        }

        // Step 3: Use avatarSetup.handlePhotoCapture to properly handle the generated image
        // This will trigger the same flow as photo capture: create avatar, update state, and switch modes
        console.log("🎭 Processing generated image through avatar setup...");
        await avatarSetup.handlePhotoCapture(imageBlob);

        console.log("🎉 Avatar generation and setup completed successfully!");
      } catch (error) {
        console.error("❌ Avatar generation failed:", error);
        // Hide loading avatar on error
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("hideLoadingAvatar"));
        }
        // You might want to show an error notification to the user here
      }
    },
    [avatarSetup, onShowAlexaTransition]
  );

  // Listen for state changes from PhotoCapture component and RPC requests
  useEffect(() => {
    const handleStateChange = (event: CustomEvent) => {
      const state = event.detail;
      setIsStreaming(state.isStreaming);
      setCapturedPhoto(state.capturedPhoto);
      setCurrentStep(state.currentStep);
    };

    const handleGenerateAvatarRequest = (event: CustomEvent) => {
      const { prompt } = event.detail;
      console.log("🎨 PhotoCaptureControls received generateAvatarRequest:", prompt);
      handleGenerateAvatar(prompt);
    };

    window.addEventListener("photoCaptureStateChange", handleStateChange as EventListener);
    window.addEventListener("generateAvatarRequest", handleGenerateAvatarRequest as EventListener);

    return () => {
      window.removeEventListener("photoCaptureStateChange", handleStateChange as EventListener);
      window.removeEventListener(
        "generateAvatarRequest",
        handleGenerateAvatarRequest as EventListener
      );
      window.removeEventListener(
        "generateAvatarRequest",
        handleGenerateAvatarRequest as EventListener
      );
    };
  }, [handleGenerateAvatar]);

  const handleStartCamera = useCallback(async () => {
    console.log("🎥 Frontend Button Clicked: startCamera called");
    console.log("🎥 photoCaptureRef.current:", photoCaptureRef.current);
    console.log("🎥 photoCaptureRef.current?.startCamera:", photoCaptureRef.current?.startCamera);

    if (photoCaptureRef.current?.startCamera) {
      console.log("🎥 Calling photoCaptureRef.current.startCamera()");
      photoCaptureRef.current.startCamera();
      console.log("🎥 startCamera() called successfully");

      // Inform backend about state change
      const room = (window as { liveKitRoom?: Room }).liveKitRoom;
      if (room) {
        try {
          await room.localParticipant.publishData(
            new TextEncoder().encode(
              JSON.stringify({ action: "camera_started", timestamp: Date.now() })
            ),
            { topic: "user_state_change" }
          );
          console.log("📡 Sent camera_started state to backend");
        } catch (error) {
          console.error("Failed to send state change to backend:", error);
        }
      }

      return JSON.stringify("Camera started");
    }
    console.log("🎥 ERROR: Photo capture component not available");
    return JSON.stringify("Camera component not available");
  }, [photoCaptureRef]);

  const handleCapturePhoto = useCallback(() => {
    if (photoCaptureRef.current?.capturePhoto) {
      photoCaptureRef.current.capturePhoto();
      // Show Alexa transition video during avatar generation (same as RPC method)
      onShowAlexaTransition();
      setCapturedPhoto(true);
      setIsStreaming(false);
    }
  }, [photoCaptureRef, onShowAlexaTransition]);

  const retakePhoto = useCallback(() => {
    console.log("📸 PhotoCaptureControls: Calling PhotoCapture.retakePhoto");
    if (photoCaptureRef.current?.retakePhoto) {
      photoCaptureRef.current.retakePhoto();
    } else {
      console.log("📸 ERROR: PhotoCapture retakePhoto method not available");
    }
  }, [photoCaptureRef]);

  const handleRestartAvatar = useCallback(async () => {
    try {
      setIsRestartingAvatar(true);
      console.log("🔄 Restarting avatar...");
      
      const response = await fetch("/api/restart-avatar", {
        method: "POST",
      });
      
      if (response.ok) {
        console.log("✅ Avatar restart signal sent");
      } else {
        console.error("❌ Failed to restart avatar");
      }
    } catch (error) {
      console.error("❌ Error restarting avatar:", error);
    } finally {
      setIsRestartingAvatar(false);
    }
  }, []);

  return (
    <>
      {/* Error message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 text-red-400 text-center bg-red-900/20 px-4 py-2 rounded-lg"
        >
          {error}
        </motion.div>
      )}

      <div className="flex gap-2 flex-wrap justify-center">
        <AnimatePresence mode="wait">
          {!isStreaming && !capturedPhoto && (!avatarExists || showPhotoCaptureButton) && (
            <div className="flex gap-4">
              <Button key="start" onClick={handleStartCamera}>
                "Take my photo"
              </Button>

              <Button key="generate" onClick={() => handleDescribeImageRequest()}>
                "Describe an image"
              </Button>
            </div>
          )}

          {isStreaming && (
            <Button key="capture" onClick={handleCapturePhoto}>
              "Capture photo"
            </Button>
          )}

          {/* {capturedPhoto && currentStep === 'capture' && (
            <Button key="retake" onClick={retakePhoto}>
              Retake
            </Button>
          )} */}
        </AnimatePresence>
      </div>
    </>
  );
}

function onDeviceFailure(error: Error) {
  console.error(error);
  alert(
    "Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab"
  );
}
