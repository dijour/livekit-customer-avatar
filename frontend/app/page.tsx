"use client";

import { NoAgentNotification } from "@components/NoAgentNotification";
import TranscriptionView from "@components/TranscriptionView";
import PhotoCapture, { PhotoCaptureRef } from "@components/PhotoCapture";
import { CaptionIcon, CaptionOffIcon, MicrophoneOnIcon, MicrophoneOffIcon, XmarkIcon, BrowseIcon, PreferencesIcon, ChevronIcon } from '../components/icons';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { Popover } from '../components/Popover';
import { MaskedMediaView } from "@components/MaskedMediaView";
import { useAvatarSetup } from '../hooks/useAvatarSetup';

import { useRoomData } from '../hooks/useRoomData';
import {
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useVoiceAssistant,
  useLocalParticipant,
} from "@livekit/components-react";
import { AnimatePresence, motion } from "framer-motion";
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant } from "livekit-client";
import { useCallback, useContext, useEffect, useState, useRef } from "react";
import type { ConnectionDetails } from "./api/connection-details/route";
import type { RoomContextType } from "../types/room";

export default function Page() {
  const [room] = useState(new Room());
  const [isSimulation, setIsSimulation] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [showPhotoCaptureButton, setShowPhotoCaptureButton] = useState(true);
  const [showAlexaTransition, setShowAlexaTransition] = useState(false);
  const [showAvatarAppears, setShowAvatarAppears] = useState(false);
  const [voiceCloningEnabled, setVoiceCloningEnabled] = useState(false);
  const avatarSetup = useAvatarSetup(voiceCloningEnabled);
  const photoCaptureRef = useRef<PhotoCaptureRef | null>(null);

  // Check URL parameters for voice cloning enablement
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const enableVoiceCloning = urlParams.get('voiceCloning') === 'true' ||
        urlParams.get('voice') === 'true' ||
        window.location.hash.includes('voice');
      setVoiceCloningEnabled(enableVoiceCloning);
      console.log('🎤 Voice cloning enabled:', enableVoiceCloning);
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
      room.registerRpcMethod('startCamera', async () => {
        console.log('🎥 Frontend RPC: startCamera called');

        // Photo capture UI should now always be available when no avatar exists
        console.log('🎥 Avatar exists:', !!avatarSetup.state.assetId);

        // Wait a moment for component to be ready if needed
        if (!photoCaptureRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('🎥 photoCaptureRef.current:', photoCaptureRef.current);
        console.log('🎥 photoCaptureRef.current?.startCamera:', photoCaptureRef.current?.startCamera);

        if (photoCaptureRef.current?.startCamera) {
          console.log('🎥 Calling photoCaptureRef.current.startCamera()');
          photoCaptureRef.current.startCamera();
          console.log('🎥 startCamera() called successfully');
          return JSON.stringify("Camera started");
        }
        console.log('🎥 ERROR: Photo capture component not available');
        return JSON.stringify("Camera component not available");
      });

      room.registerRpcMethod('capturePhoto', async () => {
        console.log('RPC: capturePhoto called');
        if (photoCaptureRef.current?.capturePhoto) {
          photoCaptureRef.current.capturePhoto();
          // Show Alexa transition video during avatar generation
          setShowAlexaTransition(true);
          return JSON.stringify("Photo captured");
        }
        return JSON.stringify("Photo capture component not available");
      });

      room.registerRpcMethod('skipPhoto', async () => {
        console.log('RPC: skipPhoto called');
        avatarSetup.handleSkipPhoto();
        return JSON.stringify("Photo skipped");
      });

      room.registerRpcMethod('isCameraActive', async () => {
        console.log('📷 RPC Method Called: isCameraActive');
        // Check if camera is available and ready
        const isActive = photoCaptureRef.current?.startCamera !== undefined;
        console.log('📷 Camera active status:', isActive);
        return isActive ? "true" : "false";
      });

    } catch (error) {
      console.error("Failed to connect:", error);
      setIsAutoConnecting(false);
    }
  }, [room, avatarSetup]);



  // Monitor avatar creation and trigger phase transition
  useEffect(() => {
    console.log('🎭 Avatar state check:', {
      showAlexaTransition,
      assetId: avatarSetup.state.assetId,
      showAvatarAppears
    });
    if (showAlexaTransition && avatarSetup.state.assetId && !showAvatarAppears) {
      console.log('🎭 Avatar ready! Triggering avatar appears video');
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
                console.log("Photo capture UI should now be visible, step:", avatarSetup.state.step);
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
        console.log('🧹 Clearing existing room participants from previous session');
        room.remoteParticipants.clear();
      }

      // Clear room metadata to prevent avatar mode persistence
      if (room.metadata) {
        console.log('🧹 Clearing room metadata from previous session');
        // Clear metadata by setting it to empty via setMetadata
        room.localParticipant.setMetadata('');
      }

      // Clear avatar state from API endpoint on session start
      try {
        await fetch('/api/clear-avatar-state', { method: 'POST' });
        console.log('🧹 Cleared avatar state from API');
      } catch (error) {
        console.error('Failed to clear avatar state on session start:', error);
      }
    };

    clearSessionState();
  }, [room]);

  // Auto-start conversation only after user interaction (to allow audio playback)
  useEffect(() => {
    if (hasUserInteracted && room.state === 'disconnected' && !isAutoConnecting) {
      onConnectButtonClicked();
    }
  }, [hasUserInteracted, room.state, isAutoConnecting, onConnectButtonClicked]);

  const handleStartExperience = useCallback(() => {
    setHasUserInteracted(true);
  }, []);

  const handleResetExperience = useCallback(async () => {
    // Disconnect from room and clear all room state
    if (room.state === 'connected') {
      await room.disconnect();
    }

    // Clear any lingering room participants or agents
    room.remoteParticipants.clear();

    // Clear room metadata to ensure fresh start
    if (room.metadata) {
      room.localParticipant.setMetadata('');
    }

    // Reset all states
    setHasUserInteracted(false);
    setIsAutoConnecting(false);
    setIsSimulation(false);

    // Reset avatar setup
    avatarSetup.reset();

    // Clear localStorage
    localStorage.removeItem("hedraAssetId");

    // Reset voice state on backend
    try {
      await fetch('/api/reset-voice-state', { method: 'POST' });
    } catch (error) {
      console.error('Failed to reset voice state:', error);
    }

    // Clear avatar state from API endpoint
    try {
      await fetch('/api/clear-avatar-state', { method: 'POST' });
    } catch (error) {
      console.error('Failed to clear avatar state:', error);
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
      <main data-lk-theme="default" style={{ fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center' }} className="h-screen bg-[#0E1A27] flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md mx-auto px-6"
        >

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
    <main data-lk-theme="default" style={{ fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center' }} className="h-screen bg-[#0E1A27] flex flex-col">
      <RoomContext.Provider value={Object.assign(room, { isSimulation, setIsSimulation }) as RoomContextType}>


        {/* Show photo capture overlay when no avatar exists or when triggered by agent */}
        <AnimatePresence mode="wait">
          {(!avatarSetup.state.assetId || avatarSetup.showPhotoCapture) && (
            <PhotoCapture
              key="photo-capture"
              ref={photoCaptureRef}
              onPhotoCapture={avatarSetup.handlePhotoCapture}
              onSkip={avatarSetup.handleSkipPhoto}
              onShowAlexaTransition={() => {
                console.log('🎬 PhotoCapture triggered Alexa transition');
                setShowAlexaTransition(true);
              }}
              onStateChange={(state) => {
                // Update PhotoCaptureControls state when PhotoCapture state changes
                if (photoCaptureRef.current) {
                  // Find and update the PhotoCaptureControls component state
                  const event = new CustomEvent('photoCaptureStateChange', { detail: state });
                  window.dispatchEvent(event);
                }
              }}
            />
          )}
        </AnimatePresence>

        {/* Alexa transition video overlay during avatar generation */}
        <AnimatePresence>
          {showAlexaTransition && (
            <motion.div
              key="alexa-transition"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
            >
              <div className="relative w-full h-full flex items-center justify-center">
                {!showAvatarAppears ? (
                  // Phase 1: Loop transition video until avatar is ready
                  <video
                    autoPlay
                    loop
                    muted
                    className="w-auto h-auto max-w-full max-h-full object-contain"
                    onLoadStart={() => console.log('🎬 Alexa transition video loading...')}
                    onCanPlay={() => console.log('🎬 Alexa transition video can play')}
                    onError={(e) => console.error('🎬 Alexa transition video error:', e)}
                  >
                    <source src="/videos/alexa_transition.mp4" type="video/mp4" />
                  </video>
                ) : (
                  // Phase 2: Play avatar appears video once
                  <video
                    autoPlay
                    muted
                    className="w-auto h-auto max-w-full max-h-full object-contain"
                    onEnded={() => {
                      // Fade out the entire overlay after avatar appears video ends
                      setTimeout(() => {
                        setShowAlexaTransition(false);
                        setShowAvatarAppears(false);
                      }, 500);
                    }}
                  >
                    <source src="/videos/avatar_appears.mp4" type="video/mp4" />
                  </video>
                )}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white text-center">
                  <p className="text-lg font-medium">
                    {!showAvatarAppears ? "Creating your personalized avatar..." : "Your avatar is ready!"}
                  </p>
                  <p className="text-sm opacity-75 mt-2">
                    {!showAvatarAppears ? "This will just take a moment" : "Welcome to your personalized experience"}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Always show voice assistant for agent connection */}
        <SimpleVoiceAssistant
          onConnectButtonClicked={onConnectButtonClicked}
          isSimulation={isSimulation}
          setIsSimulation={setIsSimulation}
          isAutoConnecting={isAutoConnecting}
          photoCaptureRef={photoCaptureRef}
          onResetExperience={handleResetExperience}
          showPhotoCaptureButton={showPhotoCaptureButton}
          avatarExists={!!avatarSetup.state.assetId}
          onShowAlexaTransition={() => setShowAlexaTransition(true)}
        />

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
  isSimulation: boolean;
  setIsSimulation: (value: boolean) => void;
  isAutoConnecting: boolean;
  photoCaptureRef: React.RefObject<PhotoCaptureRef | null>;
  onResetExperience: () => Promise<void>;
  showPhotoCaptureButton: boolean;
  avatarExists: boolean;
  onShowAlexaTransition: () => void;
}) {
  const { state: agentState } = useVoiceAssistant();
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

  return (
    <div className="h-screen flex flex-col relative">
      <AnimatePresence mode="wait">
        {agentState !== "disconnected" && (
          <>
            {/* Main content area - shows agent visualizer when connected */}
            <div className="flex-1 flex items-center justify-center">
              <motion.div
                key="connected"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
              >
                <AgentVisualizer />
              </motion.div>
            </div>

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

                {/* Center status text - horizontally centered, vertically aligned with buttons */}
                {/* <div className="absolute left-1/2 top-[36px] -translate-x-1/2 h-[72px] flex items-center text-white text-[24px] whitespace-nowrap">
                  <PhotoCaptureStatus />
                </div> */}

                {/* Right buttons */}
                <div className="absolute right-[48px] top-[36px] flex gap-4">
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
              <div className="flex-1">
                {showCaptions && (
                  <TranscriptionView />
                )}
              </div>

              {/* Center column - Avatar visual editing controls (only when avatar exists and is visible) */}
              {props.avatarExists && (
                <div className="flex-shrink-0">
                  <AvatarVisualControls />
                </div>
              )}

              {/* Right column - Photo capture controls */}
              <div className="flex-shrink-0">
                <PhotoCaptureControls photoCaptureRef={props.photoCaptureRef} showPhotoCaptureButton={props.showPhotoCaptureButton} avatarExists={!!props.avatarExists} onShowAlexaTransition={props.onShowAlexaTransition} />
              </div>
            </div>

            <RoomAudioRenderer />
            <NoAgentNotification state={agentState} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentVisualizer() {
  const { videoTrack } = useVoiceAssistant();
  const { isSimulation } = useContext(RoomContext) as RoomContextType;
  if (isSimulation) {
    return (
      <div className="relative rounded-2xl overflow-hidden aspect-square mx-auto" style={{ width: 'min(80vh, 80vw)', height: 'min(80vh, 80vw)' }}>
        <MaskedMediaView>
          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
            <img src="/images/martha.png" alt="AI Agent" className="w-full h-full object-cover" />
          </div>
        </MaskedMediaView>
      </div>
    );
  }
  if (videoTrack) {
    return (
      <div className="relative rounded-2xl overflow-hidden aspect-square mx-auto" style={{ width: 'min(80vh, 80vw)', height: 'min(80vh, 80vw)' }}>
        <MaskedMediaView>
          <VideoTrack trackRef={videoTrack} />
        </MaskedMediaView>
      </div>
    );
  }
  // No audio visualization - return null when no video
  return null;
}


function AvatarVisualControls() {
  const [personalityEnabled, setPersonalityEnabled] = useState(false);
  const [filtersEnabled, setFiltersEnabled] = useState(false);
  const [currentPersonalityIndex, setCurrentPersonalityIndex] = useState(0);
  const [selectedPersonalityIndex, setSelectedPersonalityIndex] = useState(0); // Core personality is selected by default
  const [hasInteractedWithCarousel, setHasInteractedWithCarousel] = useState(false);
  const [loadingFilter, setLoadingFilter] = useState<string | null>(null);
  const personalityRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const { publishData } = useRoomData();

  // Personality carousel data
  const personalities = [
    { name: "Core", subtitle: "The Alexa you know and love.", media: "/videos/heart.mp4" }, //heart
    { name: "Minimalist", subtitle: "Adequate. Your primary question or topic for today's discussion?", media: "/videos/check.mp4" }, //checkmark
    { name: "Supporter", subtitle: "Living my best life cheering on amazing people like YOU! Keep shining.", media: "/videos/flower.mp4" }, //actual flowers
    { name: "Free Spirit", subtitle: "All good vibes here, dude. Taking it easy as usual.", media: "/videos/clouds.mp4" }, //clouds
    { name: "Dreamer", subtitle: "My spirit is doing cartwheels through the universe.", media: "/videos/star.mp4" }, //star
    { name: "Rockstar", subtitle: "Living so legendarily right now that even my haters are taking notes.", media: "/videos/fireworks.mp4" }, //flowers?

  ];
  const { state } = useAvatarSetup();
  const blob = state.userPhoto; // This is your original photo blob
  const handlePersonalitySelection = useCallback(async () => {
    const selectedPersonality = personalities[currentPersonalityIndex];
    console.log('🎭 Personality selected:', selectedPersonality.name);

    // Send personality selection to backend via LiveKit data channel
    try {
      await publishData('personality_selection', {
        personalityName: selectedPersonality.name,
        personalityIndex: currentPersonalityIndex
      });
      console.log('📡 Personality data sent to backend');
    } catch (error) {
      console.error('Failed to send personality data:', error);
    }

    // Update selected personality and close the popover
    setSelectedPersonalityIndex(currentPersonalityIndex);
    setPersonalityEnabled(false);
    setHasInteractedWithCarousel(false);
  }, [currentPersonalityIndex, personalities, publishData]);

  const handlePersonalityToggle = useCallback((toggled: boolean) => {
    console.log('🔄 handlePersonalityToggle called:', { toggled });

    // Only open/close the popover - no personality selection logic
    setPersonalityEnabled(toggled);
    console.log('Personality:', toggled ? 'enabled' : 'disabled');

    // Reset carousel interaction state when closing
    if (!toggled) {
      setHasInteractedWithCarousel(false);
    }
  }, []);

  const handleFiltersToggle = useCallback((toggled: boolean) => {
    // Prevent closing if a filter is currently loading
    if (!toggled && loadingFilter) {
      return;
    }
    setFiltersEnabled(toggled);
    console.log('Filters:', toggled ? 'enabled' : 'disabled');
  }, [loadingFilter]);

  const closePersonalityPopover = useCallback(() => {
    setPersonalityEnabled(false);
    setHasInteractedWithCarousel(false);
  }, []);

  const closeFiltersPopover = useCallback(() => {
    // Prevent closing if a filter is currently loading
    if (loadingFilter) {
      return;
    }
    setFiltersEnabled(false);
  }, [loadingFilter]);

  const handleFilterSelection = useCallback(async (filterName: string) => {
    // Send immediate message to agent that filter process is starting
    try {
      // Create a message based on the filter type
      const filterMessages: Record<string, string> = {
        "add a funny hat": "Got it, I'm adding a funny hat. Please hold!",
        "make me pixar style": "Got it, I'm transforming into Pixar style. Please hold!",
        "give me studio lighting": "Got it, I'm creating an oil painting version of myself. Please hold!"
      };
      
      // Default message if filter type isn't in our predefined list
      const lowerCaseFilterName = filterName.toLowerCase();
      const message = filterMessages[lowerCaseFilterName] || 
        `Got it. I'll have a new appearance very soon. Please hold.`;
      
      await publishData('agent_message', {
        message,
        filterName,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to send agent message:', error);
    }

    // Set loading state
    setLoadingFilter(filterName);

    console.log('🎨 Filter selected:', filterName);
    const currentID = localStorage.getItem("hedraAssetId");
    console.log(currentID);

    const assetResponse = await fetch(`/api/get-hedra-asset?id=${currentID}`);
    const assetResult = await assetResponse.json();
    const assetUrl = assetResult.data[0]?.asset?.url;
    console.log('Asset URL:', assetUrl);

    // Download the image from the URL and convert to blob
    let blob = null;
    if (assetUrl) {
      try {
        const imageResponse = await fetch(assetUrl);
        blob = await imageResponse.blob();
        console.log('Downloaded image blob:', blob);
        const enhanceFormData = new FormData();
        enhanceFormData.append("image", blob, "photo.jpg");
        enhanceFormData.append("prompt", filterName);
        const enhanceResponse = await fetch("/api/enhance-image", {
          method: "POST",
          body: enhanceFormData,
        });

        const enhanceResult = await enhanceResponse.json();
        console.log('Modified image result:', enhanceResult);
        if (enhanceResult.success) {
          // Convert base64 string back to blob for upload
          const base64Data = enhanceResult.enhancedImage;
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const enhancedBlob = new Blob([byteArray], { type: 'image/jpeg' });

          console.log('Enhanced blob created:', enhancedBlob.size, 'bytes');

          const avatarFormData = new FormData();
          avatarFormData.append("photo", enhancedBlob, "avatar-photo.jpg");

          const avatarResponse = await fetch("/api/create-avatar", {
            method: "POST",
            body: avatarFormData,
          });
          const avatarResult = await avatarResponse.json();
          console.log('New avatar result:', avatarResult);

          if (!avatarResult.assetId) {
            throw new Error("No asset ID received from avatar creation");
          }

          // Send avatar ID to backend via LiveKit data channel
          try {
            await publishData('filter_selection', {
              filterID: avatarResult.assetId,
              timestamp: Date.now()
            });
            console.log('📡 Filter data sent to backend');
          } catch (error) {
            console.error('Failed to send filter data:', error);
          }
        }

      } catch (error) {
        console.error('Failed to download image from URL:', error);
        return;
      }
    } else {
      console.error('No asset URL found');
      return;
    }

    // Here, we need to take our current photo, and modify it with our modify image endpoint.
    // we will then upload the modified image to Hedra and obtain a new avatar ID.
    // then, below, we will send the new avatar ID to the backend via LiveKit data channel.

    if (!blob) {
      console.error('No original photo blob available');
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
  }, [publishData]);

  // Carousel navigation functions
  const goToPreviousPersonality = useCallback(() => {
    console.log('⬅️ Previous personality clicked');
    setCurrentPersonalityIndex((prev) =>
      prev === 0 ? personalities.length - 1 : prev - 1
    );
    setHasInteractedWithCarousel(true);
    console.log('🎯 hasInteractedWithCarousel set to true');
  }, [personalities.length]);

  const goToNextPersonality = useCallback(() => {
    console.log('➡️ Next personality clicked');
    setCurrentPersonalityIndex((prev) =>
      (prev + 1) % personalities.length
    );
    setHasInteractedWithCarousel(true);
    console.log('🎯 hasInteractedWithCarousel set to true');
  }, [personalities.length]);

  const currentPersonality = personalities[currentPersonalityIndex];

  return (
    <div className="flex gap-4 relative">
      <div className="relative">
        <Toggle
          ref={personalityRef}
          isToggled={personalityEnabled}
          onToggle={handlePersonalityToggle}
          icon={<BrowseIcon size={32} />}
          className="w-[210px]"
        >
          Personality
        </Toggle>
        <Popover
          width={436}
          align="center"
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
              {currentPersonality.media.endsWith('.mp4') ? (
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
                style={{ transformOrigin: 'center' }}
              >
                <ChevronIcon size={32} />
              </motion.button>

              <motion.button
                onClick={goToNextPersonality}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 hover:opacity-70 transition-opacity"

                transition={{ duration: 0.1 }}
                style={{ transformOrigin: 'center' }}
              >
                <ChevronIcon size={32} className="rotate-180" />
              </motion.button>
              <motion.div
                className="absolute bottom-0 left-0 right-0 z-10 flex flex-row justify-start gap-4 items-end p-[28px]"
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <div className="flex flex-col w-full">
                  <div className="text-white text-xl font-bold leading-8">{currentPersonality.name}</div>
                  <div className="text-white/50 text-base font-normal leading-6 ">
                    {currentPersonality.subtitle}
                  </div>
                </div>

                {currentPersonalityIndex !== selectedPersonalityIndex && (
                  <Button width="144px" height="60px"
                    onClick={handlePersonalitySelection}
                    className="w-[144px] h-[60px] bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white px-6 py-2 rounded-full text-xl font-medium transition-colors"
                  >
                    Use this
                  </Button>
                )}


              </motion.div>
            </motion.div>

            {/* Navigation arrows positioned absolutely */}

          </div>
        </Popover>
      </div>

      <div className="relative">
        <Toggle

          ref={filtersRef}
          isToggled={filtersEnabled}
          onToggle={handleFiltersToggle}
          icon={<PreferencesIcon size={32} />}
        >
          Filters
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
        </Popover>
      </div>
    </div>
  );
}

function PhotoCaptureControls({ photoCaptureRef, showPhotoCaptureButton, avatarExists, onShowAlexaTransition }: { photoCaptureRef: React.RefObject<PhotoCaptureRef | null>; showPhotoCaptureButton: boolean; avatarExists: boolean; onShowAlexaTransition: () => void }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(false);
  const [currentStep, setCurrentStep] = useState<'capture' | 'enhance' | 'confirm'>('capture');
  const [error] = useState<string | null>(null);

  // Feature flag: enable full workflow only if URL contains #modify
  const isModifyMode = typeof window !== 'undefined' && window.location.hash.includes('modify');

  // Listen for state changes from PhotoCapture component
  useEffect(() => {
    const handleStateChange = (event: CustomEvent) => {
      const state = event.detail;
      setIsStreaming(state.isStreaming);
      setCapturedPhoto(state.capturedPhoto);
      setCurrentStep(state.currentStep);
    };

    window.addEventListener('photoCaptureStateChange', handleStateChange as EventListener);
    return () => {
      window.removeEventListener('photoCaptureStateChange', handleStateChange as EventListener);
    };
  }, []);

  const handleStartCamera = useCallback(async () => {
    console.log('🎥 Frontend Button Clicked: startCamera called');
    console.log('🎥 photoCaptureRef.current:', photoCaptureRef.current);
    console.log('🎥 photoCaptureRef.current?.startCamera:', photoCaptureRef.current?.startCamera);

    if (photoCaptureRef.current?.startCamera) {
      console.log('🎥 Calling photoCaptureRef.current.startCamera()');
      photoCaptureRef.current.startCamera();
      console.log('🎥 startCamera() called successfully');

      // Inform backend about state change
      const room = (window as { liveKitRoom?: Room }).liveKitRoom;
      if (room) {
        try {
          await room.localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify({ action: "camera_started", timestamp: Date.now() })),
            { topic: "user_state_change" }
          );
          console.log('📡 Sent camera_started state to backend');
        } catch (error) {
          console.error('Failed to send state change to backend:', error);
        }
      }

      return JSON.stringify("Camera started");
    }
    console.log('🎥 ERROR: Photo capture component not available');
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

  const enhancePhoto = useCallback(() => {
    console.log("🎨 PhotoCaptureControls: Calling PhotoCapture.enhancePhoto");
    if (photoCaptureRef.current?.enhancePhoto) {
      photoCaptureRef.current.enhancePhoto();
    } else {
      console.log("🎨 ERROR: PhotoCapture enhancePhoto method not available");
    }
  }, [photoCaptureRef]);

  const useOriginalPhoto = useCallback(() => {
    console.log("📸 PhotoCaptureControls: Calling PhotoCapture.useOriginalPhoto");
    if (photoCaptureRef.current?.useOriginalPhoto) {
      photoCaptureRef.current.useOriginalPhoto();
    } else {
      console.log("📸 ERROR: PhotoCapture useOriginalPhoto method not available");
    }
  }, [photoCaptureRef]);

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
            <Button key="start" onClick={handleStartCamera}>
              Start Camera
            </Button>
          )}

          {isStreaming && (
            <Button key="capture" onClick={handleCapturePhoto}>
              Take Photo
            </Button>
          )}

          {capturedPhoto && currentStep === 'capture' && isModifyMode && (
            <>
              <Button key="retake" onClick={retakePhoto}>
                Retake
              </Button>
              <Button key="enhance" onClick={enhancePhoto}>
                Add a hat
              </Button>
              <Button key="use-original" onClick={useOriginalPhoto}>
                Use Original
              </Button>
            </>
          )}

          {currentStep === 'confirm' && isModifyMode && (
            <>
              <Button key="retake-confirm" onClick={retakePhoto}>
                Retake
              </Button>
              <Button key="confirm-final" onClick={useOriginalPhoto}>
                Use This Photo
              </Button>
            </>
          )}
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
