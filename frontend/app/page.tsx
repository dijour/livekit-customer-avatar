"use client";

import { CloseIcon } from "@components/CloseIcon";
import { NoAgentNotification } from "@components/NoAgentNotification";
import TranscriptionView from "@components/TranscriptionView";
import PhotoCapture from "@components/PhotoCapture";
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
  const [showPhotoCapture, setShowPhotoCapture] = useState(true);
  const [userPhoto, setUserPhoto] = useState<Blob | null>(null);

  const handlePhotoCapture = useCallback(async (photoBlob: Blob) => {
    setUserPhoto(photoBlob);
    setShowPhotoCapture(false);
    console.log("Photo captured:", photoBlob);
    
    try {
      // Send photo to Hedra API for avatar creation
      const formData = new FormData();
      formData.append("photo", photoBlob, "avatar-photo.jpg");
      
      console.log("Sending photo to Hedra API...");
      
      const response = await fetch("/api/create-avatar", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log("Hedra asset created successfully:", result);
      
      // Store the asset ID for use in the agent
      if (result.assetId) {
        localStorage.setItem("hedraAssetId", result.assetId);
        console.log("Stored asset ID:", result.assetId);
        
        // Also set it for the backend agent
        try {
          await fetch("/api/set-avatar-id", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ assetId: result.assetId }),
          });
          console.log("Asset ID set for backend agent");
        } catch (error) {
          console.error("Failed to set asset ID for backend:", error);
        }
      }
      
    } catch (error) {
      console.error("Failed to create Hedra avatar:", error);
      // Continue anyway - the conversation can still work without the avatar
    }
  }, []);

  const handleSkipPhoto = useCallback(() => {
    setShowPhotoCapture(false);
    console.log("Photo capture skipped");
  }, []);

  const onConnectButtonClicked = useCallback(async () => {
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
    
    // Check if we have an asset ID from photo capture
    const assetId = localStorage.getItem("hedraAssetId");
    
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
  }, [room]);

  useEffect(() => {
    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);

    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
    };
  }, [room]);

  return (
    // anchor
    <main data-lk-theme="default" style={{fontFamily: 'Amazon Ember Display, system-ui, sans-serif', backgroundImage: 'url("/images/Bkg 15 Hub XL Landscape Dark.svg")', backgroundSize: 'cover', backgroundPosition: 'center'}} className="h-full grid content-center bg-[#0E1A27]">
      <RoomContext.Provider value={Object.assign(room, { isSimulation, setIsSimulation }) as RoomContextType}>
        <div className=" max-w-[1024px] w-[90vw] mx-auto max-h-[90vh]">
          <AnimatePresence mode="wait">
            {showPhotoCapture ? (
              <PhotoCapture 
                key="photo-capture"
                onPhotoCapture={handlePhotoCapture}
                onSkip={handleSkipPhoto}
              />
            ) : (
              <SimpleVoiceAssistant 
                key="voice-assistant"
                onConnectButtonClicked={onConnectButtonClicked}
                isSimulation={isSimulation}
                setIsSimulation={setIsSimulation}
              />
            )}
          </AnimatePresence>
        </div>
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
}) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <>
      <AnimatePresence mode="wait">
        {agentState === "disconnected" ? (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="grid items-center justify-center h-full"
          >
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
              onClick={() => props.onConnectButtonClicked()}
            >
              Start a conversation
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="connected"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex flex-col items-center gap-4 h-full"
          >
            <AgentVisualizer />
            <div className="flex-1 w-full">
              <TranscriptionView />
            </div>
            <div className="w-full">
              <ControlBar onConnectButtonClicked={props.onConnectButtonClicked} />
            </div>
            <RoomAudioRenderer />
            <NoAgentNotification state={agentState} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AgentVisualizer() {
  const { state: agentState, videoTrack, audioTrack } = useVoiceAssistant();
  const { isSimulation } = useContext(RoomContext) as RoomContextType;
  if (isSimulation) {
    return (
      <div className="h-[512px] w-[512px] rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
        <img src="/images/martha.png" alt="AI Agent" />
      </div>
    );
  }
  if (videoTrack) {
    return (
      <div className="h-[512px] w-[512px] rounded-lg overflow-hidden">
        <VideoTrack trackRef={videoTrack} />
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      <BarVisualizer
        state={agentState}
        barCount={5}
        trackRef={audioTrack}
        className="agent-visualizer"
        options={{ minHeight: 24 }}
      />
    </div>
  );
}

function ControlBar(props: { onConnectButtonClicked: () => void }) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <div className="relative h-[60px]">
      <AnimatePresence>
        {agentState === "disconnected" && (
          <motion.button
            initial={{ opacity: 0, top: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 1, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="uppercase absolute left-1/2 -translate-x-1/2 px-4 py-2 bg-white text-black rounded-md"
            onClick={() => props.onConnectButtonClicked()}
          >
            Start a conversation
          </motion.button>
        )}
      </AnimatePresence>
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
