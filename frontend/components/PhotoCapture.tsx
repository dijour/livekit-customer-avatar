"use client";

import React, { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./Button";
import { MaskedMediaView } from "./MaskedMediaView";

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
  const [enhancedPhoto, setEnhancedPhoto] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'capture' | 'enhance' | 'confirm'>('capture');
  
  // Feature flag: enable full workflow only if URL contains #modify
  const isModifyMode = typeof window !== 'undefined' && window.location.hash.includes('modify');

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
        
        // If not in modify mode, automatically proceed to avatar creation
        if (!isModifyMode) {
          // Directly call onPhotoCapture with the blob to skip all confirmation screens
          onPhotoCapture(blob);
        }
      }
    }, "image/jpeg", 0.8);
  }, [stopCamera, isModifyMode, onPhotoCapture]);

  const retakePhoto = useCallback(() => {
    setCapturedPhoto(null);
    setEnhancedPhoto(null);
    setCurrentStep('capture');
    startCamera();
  }, [startCamera]);

  const useOriginalPhoto = useCallback(() => {
    setCurrentStep('confirm');
  }, []);

  const enhancePhoto = useCallback(async () => {
    if (!canvasRef.current) return;

    setIsEnhancing(true);
    setError(null);

    try {
      // Convert canvas to blob for upload
      const blob = await new Promise<Blob>((resolve) => {
        canvasRef.current!.toBlob((blob) => {
          if (blob) resolve(blob);
        }, "image/jpeg", 0.8);
      });

      // Create form data for API call
      const formData = new FormData();
      formData.append("image", blob, "photo.jpg");

      // Call OpenAI enhancement API
      const response = await fetch("/api/enhance-image", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Enhancement failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.enhancedImage) {
        // Convert base64 to blob URL for display
        const enhancedImageBlob = new Blob(
          [Uint8Array.from(atob(result.enhancedImage), c => c.charCodeAt(0))],
          { type: "image/png" }
        );
        const enhancedUrl = URL.createObjectURL(enhancedImageBlob);
        setEnhancedPhoto(enhancedUrl);
        setCurrentStep('confirm');
      } else {
        throw new Error("No enhanced image received");
      }
    } catch (error) {
      console.error("Enhancement failed:", error);
      setError("Failed to enhance image. Using original photo instead.");
      // Fall back to original photo
      setCurrentStep('confirm');
    } finally {
      setIsEnhancing(false);
    }
  }, []);

  const confirmPhoto = useCallback(() => {
    // Use enhanced photo if available, otherwise use original
    const photoToUse = enhancedPhoto || capturedPhoto;
    
    if (enhancedPhoto) {
      // Convert enhanced photo URL back to blob
      fetch(enhancedPhoto)
        .then(res => res.blob())
        .then(blob => onPhotoCapture(blob))
        .catch(() => {
          // Fallback to canvas if enhanced photo fails
          canvasRef.current?.toBlob((blob) => {
            if (blob) onPhotoCapture(blob);
          }, "image/jpeg", 0.8);
        });
    } else {
      // Use original canvas
      canvasRef.current?.toBlob((blob) => {
        if (blob) onPhotoCapture(blob);
      }, "image/jpeg", 0.8);
    }
  }, [onPhotoCapture, enhancedPhoto, capturedPhoto]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopCamera();
      if (capturedPhoto) {
        URL.revokeObjectURL(capturedPhoto);
      }
      if (enhancedPhoto) {
        URL.revokeObjectURL(enhancedPhoto);
      }
    };
  }, [stopCamera, capturedPhoto, enhancedPhoto]);

  return (
    <div className="h-screen flex flex-col">
      {/* Main media area */}
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
          className="relative"
        >
          {/* Photo preview area */}
          <div className="relative rounded-2xl overflow-hidden aspect-square mx-auto" style={{ width: 'min(80vh, 80vw)', height: 'min(80vh, 80vw)' }}>
          <div className="w-full h-full">
            {currentStep === 'confirm' && enhancedPhoto ? (
              <MaskedMediaView>
                <img
                  src={enhancedPhoto}
                  alt="Enhanced photo"
                  className="w-full h-full object-cover"
                />
              </MaskedMediaView>
            ) : capturedPhoto ? (
              <MaskedMediaView
                overlay={isEnhancing ? (
                  <div className="px-4 py-2">
                    <div className="text-white text-center">
                      <p>Enhancing</p>
                    </div>
                  </div>
                ) : undefined}
              >
                <img
                  src={capturedPhoto}
                  alt="Captured photo"
                  className="w-full h-full object-cover"
                />
              </MaskedMediaView>
            ) : isStreaming ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-[min(60vh,60vw)] h-[min(60vh,60vw)] rounded-full overflow-hidden">
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
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                {/* <div className="text-center">
                  <div className="text-6xl mb-4">📷</div>
                  <p>Click "Start Camera" to begin</p>
                </div> */}
              </div>
            )}
          </div>
        </div>

          {/* Hidden canvas for photo capture */}
          <canvas ref={canvasRef} className="hidden" />
        </motion.div>
      </div>

      {/* Bottom control bar */}
      <div className="pb-8">
        {/* Error message */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-center bg-red-900/20 px-4 py-2 rounded-lg mb-4"
          >
            {error}
          </motion.div>
        )}

        {/* Controls */}
        <div className="flex gap-4 flex-wrap justify-center">
        <AnimatePresence mode="wait">
          {!isStreaming && !capturedPhoto && (
            <Button
              key="start"
              // initial={{ opacity: 0, y: 10 }}
              // animate={{ opacity: 1, y: 0 }}
              // exit={{ opacity: 0, y: -10 }}
              onClick={startCamera}
            >
              Start Camera
            </Button>
          )}

          {isStreaming && (
            <Button
              key="capture"
              onClick={capturePhoto}
            >
              Capture Photo
            </Button>
          )}

          {capturedPhoto && currentStep === 'capture' && isModifyMode && (
            <>
              <Button
                key="retake"
                onClick={retakePhoto}
              >
                Retake
              </Button>
              <Button
                key="enhance"
                onClick={enhancePhoto}
                disabled={isEnhancing}
              >
                {isEnhancing ? "Enhancing..." : "Enhance"}
              </Button>
              <Button
                key="use-original"
                onClick={useOriginalPhoto}
              >
                Use Original
              </Button>
            </>
          )}

          {currentStep === 'confirm' && isModifyMode && (
            <>
              <Button
                key="retake-confirm"
                onClick={retakePhoto}
                // variant="secondary"
              >
                Retake
              </Button>
              <Button
                key="confirm-final"
                onClick={confirmPhoto}
              >
                Use This Photo
              </Button>
            </>
          )}
        </AnimatePresence>

        {/* <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onSkip}
          className="px-6 py-3 bg-[#F5F5F5]/25 text-white rounded-full text-[28px] leading-[120%]"
        >
          Skip Photo
        </motion.button> */}
        </div>
      </div>
    </div>
  );
}
