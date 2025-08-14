"use client";

import { CloseIcon } from "@components/CloseIcon";
import { NoAgentNotification } from "@components/NoAgentNotification";
import TranscriptionView from "@components/TranscriptionView";
import PhotoCapture from "@components/PhotoCapture";
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
import { Room, RoomEvent } from "livekit-client";
import { useCallback, useContext, useEffect, useState } from "react";
import type { ConnectionDetails } from "./api/connection-details/route";
import type { RoomContextType } from "../types/room";

export default function Page() {
  const [room] = useState(new Room());
  const [isSimulation, setIsSimulation] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const avatarSetup = useAvatarSetup();

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
        // Use GET request if no asset ID
        response = await fetch(url.toString());
      }
      
      const connectionDetailsData: ConnectionDetails = await response.json();
      console.log("Connection details:", connectionDetailsData);

      await room.connect(connectionDetailsData.serverUrl, connectionDetailsData.participantToken);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (error) {
      console.error("Failed to connect:", error);
      setIsAutoConnecting(false);
    }
  }, [room, avatarSetup.state.assetId]);

  // Auto-start conversation when avatar setup is ready
  useEffect(() => {
    if (avatarSetup.canStartConversation && room.state === 'disconnected') {
      onConnectButtonClicked();
    }
  }, [avatarSetup.canStartConversation, room.state, onConnectButtonClicked]);

  useEffect(() => {
    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);

    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
    };
  }, [room]);

  return (
    // anchor
    <main data-lk-theme="default" style={{fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center'}} className="h-screen bg-[#0E1A27] flex flex-col">
      <RoomContext.Provider value={Object.assign(room, { isSimulation, setIsSimulation }) as RoomContextType}>
        <AnimatePresence mode="wait">
          {avatarSetup.showPhotoCapture ? (
            <PhotoCapture 
              key="photo-capture"
              onPhotoCapture={avatarSetup.handlePhotoCapture}
              onSkip={avatarSetup.handleSkipPhoto}
            />
          ) : (
            <SimpleVoiceAssistant 
              key="voice-assistant"
              onConnectButtonClicked={onConnectButtonClicked}
              isSimulation={isSimulation}
              setIsSimulation={setIsSimulation}
              isAutoConnecting={isAutoConnecting}
            />
          )}
        </AnimatePresence>

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
