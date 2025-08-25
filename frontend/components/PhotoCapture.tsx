"use client";

import React, { useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";
import { MaskedMediaView } from "./MaskedMediaView";

interface PhotoCaptureProps {
  onPhotoCapture: (photoBlob: Blob) => void;
  onSkip: () => void;
  onStateChange?: (state: { isStreaming: boolean; capturedPhoto: boolean }) => void;
  onShowAlexaTransition?: () => void;
}

export interface PhotoCaptureRef {
  startCamera: () => void;
  capturePhoto: () => void;
  retakePhoto: () => void;
}

const PhotoCapture = forwardRef<PhotoCaptureRef | null, PhotoCaptureProps>(({ onPhotoCapture, onStateChange, onShowAlexaTransition }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Feature flag: enable full workflow only if URL contains #modify
  const isModifyMode = typeof window !== 'undefined' && window.location.hash.includes('modify');

  const startCamera = useCallback(async () => {
    console.log('🎥 PhotoCapture: startCamera() called');
    console.log('🎥 Environment info:', {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      userAgent: navigator.userAgent,
      hasMediaDevices: !!navigator.mediaDevices,
      hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    });
    
    try {
      setError(null);
      
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported in this browser');
      }
      
      // Check for permissions API support and current state
      if (navigator.permissions) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
          console.log('🎥 Camera permission status:', permissionStatus.state);
          
          if (permissionStatus.state === 'denied') {
            throw new Error('Camera permission has been denied. Please enable camera access in your browser settings.');
          }
        } catch (permError) {
          console.log('🎥 Permission API not fully supported:', permError);
        }
      }
      
      console.log('🎥 PhotoCapture: Requesting camera access...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      });
      
      console.log('🎥 PhotoCapture: Camera access granted, setting video source');
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      setStream(mediaStream);
      setIsStreaming(true);
      onStateChange?.({ isStreaming: true, capturedPhoto: !!capturedPhoto });
      console.log('🎥 PhotoCapture: Camera started successfully');
    } catch (err: unknown) {
      console.error("🎥 PhotoCapture ERROR accessing camera:", err);
      
      let errorMessage = "Failed to access camera. ";
      
      // Type guard to check if err is a DOMException or Error
      const error = err as Error | DOMException;
      
      if (error.name === 'NotAllowedError') {
        errorMessage += "Please allow camera permissions and try again.";
      } else if (error.name === 'NotFoundError') {
        errorMessage += "No camera found on this device.";
      } else if (error.name === 'NotSupportedError') {
        errorMessage += "Camera not supported in this browser.";
      } else if (error.name === 'NotReadableError') {
        errorMessage += "Camera is being used by another application.";
      } else if (error.message && error.message.includes('HTTPS')) {
        errorMessage += "HTTPS is required for camera access in production.";
      } else {
        errorMessage += "Please check your browser settings and permissions.";
      }
      
      setError(errorMessage);
      console.error("Camera access error details:", {
        name: error.name,
        message: error.message,
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol
      });
    }
  }, [capturedPhoto, onStateChange]);

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
        onStateChange?.({ isStreaming: false, capturedPhoto: true });
        
        // Always proceed to avatar creation immediately
        onShowAlexaTransition?.();
        onPhotoCapture(blob);
      }
    }, "image/jpeg", 0.8);
  }, [stopCamera, onPhotoCapture, onStateChange, onShowAlexaTransition]);

  const retakePhoto = useCallback(() => {
    console.log("📸 PhotoCapture: retakePhoto called");
    setCapturedPhoto(null);
    startCamera();
  }, [startCamera]);


  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    startCamera,
    capturePhoto,
    retakePhoto
  }), [startCamera, capturePhoto, retakePhoto]);

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
            {isStreaming ? (
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
