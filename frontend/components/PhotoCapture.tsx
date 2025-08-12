"use client";

import React, { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface PhotoCaptureProps {
  onPhotoCapture: (photoBlob: Blob) => void;
  onSkip: () => void;
}

export default function PhotoCapture({ onPhotoCapture, onSkip }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      console.log("Starting camera...");
      
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 512 },
          height: { ideal: 512 },
          facingMode: "user"
        }
      });
      
      console.log("Got media stream:", mediaStream);
      console.log("Video tracks:", mediaStream.getVideoTracks());
      
      // Set stream and streaming state to trigger video element rendering
      setStream(mediaStream);
      setIsStreaming(true);
      
    } catch (err) {
      setError("Failed to access camera. Please ensure camera permissions are granted.");
      console.error("Camera access error:", err);
    }
  }, []);

  // Use useEffect to set up video when stream and isStreaming change
  React.useEffect(() => {
    if (stream && isStreaming && videoRef.current) {
      console.log("Setting up video with stream...");
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(console.error);
    }
  }, [stream, isStreaming]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsStreaming(false);
    }
  }, [stream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (blob) {
        const photoUrl = URL.createObjectURL(blob);
        setCapturedPhoto(photoUrl);
        stopCamera();
      }
    }, "image/jpeg", 0.8);
  }, [stopCamera]);

  const retakePhoto = useCallback(() => {
    setCapturedPhoto(null);
    startCamera();
  }, [startCamera]);

  const confirmPhoto = useCallback(() => {
    if (!canvasRef.current) return;

    canvasRef.current.toBlob((blob) => {
      if (blob) {
        onPhotoCapture(blob);
      }
    }, "image/jpeg", 0.8);
  }, [onPhotoCapture]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopCamera();
      if (capturedPhoto) {
        URL.revokeObjectURL(capturedPhoto);
      }
    };
  }, [stopCamera, capturedPhoto]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
      className="flex flex-col items-center gap-6 h-full justify-center"
    >
      

      <div className="relative">
        {/* Video preview or captured photo */}
        <div className="w-[400px] h-[400px] rounded-lg overflow-hidden bg-black">
          {capturedPhoto ? (
            <img
              src={capturedPhoto}
              alt="Captured photo"
              className="w-full h-full object-cover"
            />
          ) : isStreaming ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              className="w-full h-full object-cover scale-x-[-1]"
              onLoadedData={() => console.log("Video loaded")}
              onError={(e) => console.error("Video error:", e)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              {/* <div className="text-center">
                <div className="text-6xl mb-4">📷</div>
                <p>Click "Start Camera" to begin</p>
              </div> */}
            </div>
          )}
        </div>

        {/* Hidden canvas for photo capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Error message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-red-400 text-center bg-red-900/20 px-4 py-2 rounded-lg"
        >
          {error}
        </motion.div>
      )}

      {/* Controls */}
      <div className="flex gap-4">
        <AnimatePresence mode="wait">
          {!isStreaming && !capturedPhoto && (
            <motion.button
              key="start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onClick={startCamera}
              className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
            >
              Start Camera
            </motion.button>
          )}

          {isStreaming && (
            <motion.button
              key="capture"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onClick={capturePhoto}
              className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
            >
              📸 Capture Photo
            </motion.button>
          )}

          {capturedPhoto && (
            <>
              <motion.button
                key="retake"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onClick={retakePhoto}
                className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
              >
                Retake
              </motion.button>
              <motion.button
                key="confirm"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onClick={confirmPhoto}
                className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
              >
                Use This Photo
              </motion.button>
            </>
          )}
        </AnimatePresence>

        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onSkip}
          className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
        >
          Skip Photo
        </motion.button>
      </div>
    </motion.div>
  );
}
