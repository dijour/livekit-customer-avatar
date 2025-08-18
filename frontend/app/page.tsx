"use client";

import { NoAgentNotification } from "@components/NoAgentNotification";
import TranscriptionView from "@components/TranscriptionView";
import PhotoCapture, { PhotoCaptureRef } from "@components/PhotoCapture";
import { CaptionIcon, CaptionOffIcon, MicrophoneOnIcon, MicrophoneOffIcon, XmarkIcon } from '../components/icons';
import { Button } from '../components/Button';
import { MaskedMediaView } from "@components/MaskedMediaView";
import { useAvatarSetup } from "../hooks/useAvatarSetup";
import {
  BarVisualizer,
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
  const [showPhotoCaptureButton, setShowPhotoCaptureButton] = useState(false);
  const [showAlexaTransition, setShowAlexaTransition] = useState(false);
  const [showAvatarAppears, setShowAvatarAppears] = useState(false);
  const avatarSetup = useAvatarSetup();
  const photoCaptureRef = useRef<PhotoCaptureRef | null>(null);

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
      
      // Register RPC methods for backend agent to call frontend functions
      room.registerRpcMethod('startCamera', async () => {
        console.log('🎥 Frontend RPC: startCamera called');
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
    // Disconnect from room
    if (room.state === 'connected') {
      await room.disconnect();
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
      <main data-lk-theme="default" style={{fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center'}} className="h-screen bg-[#0E1A27] flex flex-col items-center justify-center">
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
    <main data-lk-theme="default" style={{fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center'}} className="h-screen bg-[#0E1A27] flex flex-col">
      <RoomContext.Provider value={Object.assign(room, { isSimulation, setIsSimulation }) as RoomContextType}>

        
        {/* Show photo capture overlay when triggered by agent */}
        <AnimatePresence mode="wait">
          {avatarSetup.showPhotoCapture && (
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
              {/* Right column - Photo capture controls */}
              <div className="flex-shrink-0">
                <PhotoCaptureControls photoCaptureRef={props.photoCaptureRef} showPhotoCaptureButton={props.showPhotoCaptureButton} />
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
  const { state: agentState, videoTrack, audioTrack } = useVoiceAssistant();
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

function PhotoCaptureStatus() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(false);
  const [currentStep, setCurrentStep] = useState<'capture' | 'enhance' | 'confirm'>('capture');
  
  if (currentStep === 'capture' && !capturedPhoto && !isStreaming) return 'Enable camera access to scan face';
  if (currentStep === 'capture' && isStreaming) return 'Position your face in the circle';
  if (currentStep === 'capture' && capturedPhoto) return 'Photo captured';
  if (currentStep === 'enhance') return 'Enhancing photo...';
  if (currentStep === 'confirm') return 'Ready to use';
  return 'Ready to capture';
}

function PhotoCaptureControls({ photoCaptureRef, showPhotoCaptureButton }: { photoCaptureRef: React.RefObject<PhotoCaptureRef | null>; showPhotoCaptureButton: boolean }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(false);
  const [enhancedPhoto, setEnhancedPhoto] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'capture' | 'enhance' | 'confirm'>('capture');
  const [error, setError] = useState<string | null>(null);
  const avatarSetup = useAvatarSetup();
  
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

  const handleStartCamera = useCallback(() => {
    console.log('🎥 Frontend Button Clicked: startCamera called');
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
    // photoCaptureRef.current?.startCamera();
    // setIsStreaming(true);
  }, [photoCaptureRef]);

  const handleCapturePhoto = useCallback(() => {
    photoCaptureRef.current?.capturePhoto();
    setCapturedPhoto(true);
    setIsStreaming(false);
  }, [photoCaptureRef]);

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
          {!isStreaming && !capturedPhoto && showPhotoCaptureButton && (
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

function ControlBar(props: { onConnectButtonClicked: () => void }) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <div className="relative h-[60px]">
      <AnimatePresence>
      </AnimatePresence>
    </div>
  );
}

function onDeviceFailure(error: Error) {
  console.error(error);
  alert(
    "Error acquiring camera or microphone permissions. Please make sure you grant the necessary permissions in your browser and reload the tab"
  );
}
