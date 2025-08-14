"use client";

import { CloseIcon } from "@components/CloseIcon";
import { NoAgentNotification } from "@components/NoAgentNotification";
import TranscriptionView from "@components/TranscriptionView";
import PhotoCapture, { PhotoCaptureRef } from "@components/PhotoCapture";
import { Button } from "@components/Button";
import { MaskedMediaView } from "@components/MaskedMediaView";
import { useAvatarSetup } from "../hooks/useAvatarSetup";
import {
  BarVisualizer,
  DisconnectButton,
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  VoiceAssistantControlBar,
  useVoiceAssistant,
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
      room.localParticipant.registerRpcMethod('startCamera', async () => {
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
      
      room.localParticipant.registerRpcMethod('capturePhoto', async () => {
        console.log('RPC: capturePhoto called');
        if (photoCaptureRef.current?.capturePhoto) {
          photoCaptureRef.current.capturePhoto();
          return JSON.stringify("Photo captured");
        }
        return JSON.stringify("Photo capture component not available");
      });
      
      room.localParticipant.registerRpcMethod('skipPhoto', async () => {
        console.log('RPC: skipPhoto called');
        avatarSetup.handleSkipPhoto();
        return JSON.stringify("Photo skipped");
      });
      
    } catch (error) {
      console.error("Failed to connect:", error);
      setIsAutoConnecting(false);
    }
  }, [room, avatarSetup.state.assetId, avatarSetup]);

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
          <motion.h1 
            className="text-4xl font-bold text-white mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Welcome to Your Avatar Experience
          </motion.h1>
          
          <motion.p 
            className="text-xl text-white/80 mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Alexa will guide you through creating your personalized avatar using voice commands
          </motion.p>
          
          <motion.button
            onClick={handleStartExperience}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xl font-semibold rounded-full hover:from-blue-600 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Start Voice Experience
          </motion.button>
          
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
          {/* {avatarSetup.showPhotoCapture && ( */}
            <PhotoCapture 
              key="photo-capture"
              ref={photoCaptureRef}
              onPhotoCapture={avatarSetup.handlePhotoCapture}
              onSkip={avatarSetup.handleSkipPhoto}
            />
          {/* )} */}
        </AnimatePresence>

        {/* Always show voice assistant for agent connection */}
        <SimpleVoiceAssistant 
          onConnectButtonClicked={onConnectButtonClicked}
          isSimulation={isSimulation}
          setIsSimulation={setIsSimulation}
          isAutoConnecting={isAutoConnecting}
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

const DUMMY_CONVERSATION = [
  { id: '1', role: 'user', text: 'Hello, can you help me with my project?' },
  { id: '2', role: 'assistant', text: 'Of course! I\'d be happy to help. What kind of project are you working on?' },
  { id: '3', role: 'user', text: 'I\'m building a React application and having trouble with state management.' },
  { id: '4', role: 'assistant', text: 'I see. There are several approaches to state management in React. Could you tell me more about your specific requirements?' }
];

function SimpleVoiceAssistant(props: { 
  onConnectButtonClicked: () => void;
  isSimulation: boolean;
  setIsSimulation: (value: boolean) => void;
  isAutoConnecting: boolean;
}) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <div className="h-screen flex flex-col">
      <AnimatePresence mode="wait">
        {agentState !== "disconnected" && (
          <>
            {/* Main media area */}
            <div className="flex-1 flex flex-col items-center justify-center p-4">
              <motion.div
                key="connected"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
                className="flex flex-col items-center gap-6 h-full justify-center"
              >
                <AgentVisualizer />
                <div className="h-16 w-full max-w-4xl">
                  <TranscriptionView />
                </div>
              </motion.div>
            </div>
            
            {/* Bottom control bar */}
            <div className="p-4">
              <ControlBar onConnectButtonClicked={props.onConnectButtonClicked} />
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
      <div className="aspect-square rounded-lg overflow-hidden" style={{ width: 'min(60vh, 60vw)', height: 'min(60vh, 60vw)' }}>
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
      <div className="aspect-square rounded-lg overflow-hidden" style={{ width: 'min(60vh, 60vw)', height: 'min(60vh, 60vw)' }}>
        <MaskedMediaView>
          <VideoTrack trackRef={videoTrack} />
        </MaskedMediaView>
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      <BarVisualizer
        state={agentState}
        barCount={7}
        trackRef={audioTrack}
        className="agent-visualizer"
        options={{ minHeight: 32 }}
      />
    </div>
  );
}

function ControlBar(props: { onConnectButtonClicked: () => void }) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <div className="relative h-[60px]">
      <AnimatePresence>
        {agentState !== "disconnected" && agentState !== "connecting" && (
          <motion.div
            initial={{ opacity: 0, top: "10px" }}
            animate={{ opacity: 1, top: 0 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 0.4, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex h-8 absolute left-1/2 -translate-x-1/2  justify-center"
          >
            <VoiceAssistantControlBar controls={{ leave: false }} />
            <DisconnectButton>
              <CloseIcon />
            </DisconnectButton>
          </motion.div>
        )}
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
