"use client";

import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MaskedMediaView } from "./MaskedMediaView";

interface LoadingAvatarProps {
  className?: string;
}

interface FloatingLoadingAvatarProps {
  className?: string;
}

/**
 * Standalone component that renders in a portal outside the React tree
 * This completely avoids state updates during parent render
 */
const LoadingAvatarPortal = ({ className = "" }: FloatingLoadingAvatarProps) => {
  // Initialize state only once when this component mounts
  const [isVisible, setIsVisible] = useState(false);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  
  // Create a portal container that exists outside the main React tree
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  
  // Create the portal container on mount
  useLayoutEffect(() => {
    // Create a div that will exist outside the React tree
    const container = document.createElement('div');
    container.id = 'loading-avatar-portal';
    document.body.appendChild(container);
    setPortalContainer(container);
    
    return () => {
      // Clean up the container on unmount
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
    };
  }, []);
  
  useEffect(() => {
    // Event handlers
    const handleShowLoading = (event: Event) => {
      console.log('🔴 Showing floating loading avatar');
      const customEvent = event as CustomEvent;
      const photoBlob = customEvent?.detail?.photo;
      
      if (photoBlob) {
        // Store URL in ref first to avoid state updates during render
        photoUrlRef.current = URL.createObjectURL(photoBlob);
        // Then update state in a separate tick
        setTimeout(() => {
          setUserPhoto(photoUrlRef.current);
        }, 0);
      }
      // Defer state update to next tick
      setTimeout(() => {
        setIsVisible(true);
      }, 0);
    };

    const handleHideLoading = () => {
      console.log('🔴 Received hide loading avatar event (ignored - staying persistent)');
      // Keep loading avatar visible, don't hide it
      // Photo URL cleanup will happen when component unmounts
    };

    // Listen for custom events
    window.addEventListener('showLoadingAvatar', handleShowLoading as EventListener);
    window.addEventListener('hideLoadingAvatar', handleHideLoading as EventListener);

    return () => {
      // Clean up event listeners
      window.removeEventListener('showLoadingAvatar', handleShowLoading as EventListener);
      window.removeEventListener('hideLoadingAvatar', handleHideLoading as EventListener);
      
      // Clean up any created object URLs
      if (photoUrlRef.current) {
        URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run on mount/unmount
  
  // Only render if we have a portal container
  if (!portalContainer) return null;
  
  // Use createPortal to render outside the React tree
  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.3 }}
          className={`fixed inset-0 flex items-center justify-center pointer-events-none ${className} filter blur-[40px]`}
          style={{ zIndex: -1 }}
        >
          <div className="relative rounded-2xl aspect-square mx-auto" style={{ width: 'min(80vh, 80vw)', height: 'min(80vh, 80vw)' }}>
            {/* Rim lighting circles - positioned behind the masked content */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Orbit container for first circle */}
              <motion.div 
                className="absolute inset-0"
                animate={{ 
                  rotate: 360 
                }}
                transition={{ 
                  duration: 10,
                  ease: "linear",
                  repeat: Infinity,
                  repeatType: "loop"
                }}
                style={{
                  transformOrigin: 'center center'
                }}
              >
                {/* First circle - positioned along the orbit path */}
                <div 
                  className="absolute w-[300px] h-[300px] rounded-full filter blur-[60px] "
                  style={{ 
                    backgroundColor: '#0ABEFF',
                    top: '13%',
                    right: '13%'
                  }}
                />
              </motion.div>
              
              {/* Orbit container for second circle */}
              <motion.div 
                className="absolute inset-0"
                animate={{ 
                  rotate: -360 
                }}
                transition={{ 
                  duration: 5,
                  ease: "linear",
                  repeat: Infinity,
                  repeatType: "loop",
                  delay: 0.5
                }}
                style={{
                  transformOrigin: 'center center'
                }}
              >
                {/* Second circle - positioned along the orbit path */}
                <div 
                  className="absolute w-[300px] h-[300px] rounded-full filter blur-[60px] "
                  style={{ 
                    backgroundColor: '#0ABEFF',
                    bottom: '13%',
                    left: '13%'
                  }}
                />
              </motion.div>
            </div>
            
            <MaskedMediaView>
              <div className="relative w-full h-full">
                {/* User photo with blur effect (if available) */}
                {userPhoto && (
                  <motion.div 
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, ease: "easeInOut" }}
                  >
                    <img 
                      src={userPhoto} 
                      alt="User photo" 
                      className="w-full h-full object-cover"
                    />
                  </motion.div>
                )}
                {!userPhoto && (
                  <div className="absolute inset-0 bg-[#9CDBFF]">
                    {/* <img 
                      src="/images/placeholder.png" 
                      alt="User photo" 
                      className="w-full h-full object-cover "
                    /> */}
                  </div>
                )}
                {/* Loading text overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-white">
                  {/* <div className="text-2xl font-medium mb-4">Generating avatar...</div> */}
                </div>
              </div>
            </MaskedMediaView>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    portalContainer
  );
};

/**
 * FloatingLoadingAvatar component that renders nothing in the React tree
 * Instead, it mounts a completely separate component via portal
 * This approach completely avoids React's render cycle
 */
export function FloatingLoadingAvatar({ className = "" }: FloatingLoadingAvatarProps) {
  // Use a ref to track if the component is mounted
  const isMountedRef = useRef(false);
  
  // Only render the portal component after the component has mounted
  const [isClientSide, setIsClientSide] = useState(false);
  
  useEffect(() => {
    isMountedRef.current = true;
    setIsClientSide(true);
    
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  
  // This component renders nothing in the React tree
  // The portal component handles all rendering outside the tree
  if (!isClientSide) return null;
  
  return <LoadingAvatarPortal className={className} />;
}

/**
 * Original LoadingAvatar component for backward compatibility
 */
export function LoadingAvatar({ className = "" }: LoadingAvatarProps) {
  return (
    <div className={`relative rounded-2xl overflow-hidden aspect-square mx-auto ${className}`} style={{ width: 'min(80vh, 80vw)', height: 'min(80vh, 80vw)' }}>
      <MaskedMediaView>
        <div className="w-full h-full bg-red-500" />
      </MaskedMediaView>
    </div>
  );
}
