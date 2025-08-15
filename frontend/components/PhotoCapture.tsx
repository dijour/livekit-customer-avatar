"use client";

import React, { useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./Button";
import { MaskedMediaView } from "./MaskedMediaView";

interface PhotoCaptureProps {
  onPhotoCapture: (photoBlob: Blob) => void;
  onSkip: () => void;
  onStateChange?: (state: { isStreaming: boolean; capturedPhoto: boolean; currentStep: 'capture' | 'enhance' | 'confirm' }) => void;
  onShowAlexaTransition?: () => void;
}

export interface PhotoCaptureRef {
  startCamera: () => void;
  capturePhoto: () => void;
}

const PhotoCapture = forwardRef<PhotoCaptureRef, PhotoCaptureProps>(({ onPhotoCapture, onSkip, onStateChange, onShowAlexaTransition }, ref) => {
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
    console.log('🎥 PhotoCapture: startCamera() called');
    try {
      setError(null);
      console.log('🎥 PhotoCapture: Requesting camera access...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      
      console.log('🎥 PhotoCapture: Camera access granted, setting video source');
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      setStream(mediaStream);
      setIsStreaming(true);
      onStateChange?.({ isStreaming: true, capturedPhoto: !!capturedPhoto, currentStep });
      console.log('🎥 PhotoCapture: Camera started successfully');
    } catch (err) {
      console.error("🎥 PhotoCapture ERROR accessing camera:", err);
      setError("Failed to access camera. Please check permissions.");
      console.error("Camera access error:", err);
    }
  }, [capturedPhoto, currentStep, onStateChange]);

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
        onStateChange?.({ isStreaming: false, capturedPhoto: true, currentStep });
        
        // If not in modify mode, automatically proceed to avatar creation
        if (!isModifyMode) {
          // Show Alexa transition overlay
          onShowAlexaTransition?.();
          // Directly call onPhotoCapture with the blob to skip all confirmation screens
          onPhotoCapture(blob);
        }
      }
    }, "image/jpeg", 0.8);
  }, [stopCamera, isModifyMode, onPhotoCapture, onStateChange, currentStep, onShowAlexaTransition]);

  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    startCamera,
    capturePhoto
  }), [startCamera, capturePhoto]);

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
      stopCamera();
    }
  }, [stopCamera]);


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
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
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

      {/* Error message - moved to fixed position */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 text-red-400 text-center bg-red-900/20 px-4 py-2 rounded-lg"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
});

PhotoCapture.displayName = 'PhotoCapture';

export default PhotoCapture;
