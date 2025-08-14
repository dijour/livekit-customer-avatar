"use client";

import React from "react";

// CSS styles for media mask
const mediaStyles = `
  .media-mask {
    -webkit-mask: 
      linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
    mask: 
      linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
  
  .media-mask::before {
    content: '';
    position: absolute;
    inset: 0;
    background: 
      linear-gradient(to right, rgba(0,0,0,0.8) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.8) 100%),
      linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.8) 100%);
    pointer-events: none;
    z-index: 1;
  }
`;

// Reusable masked media view component
interface MaskedMediaViewProps {
  children: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
}

export function MaskedMediaView({ children, overlay, className = "" }: MaskedMediaViewProps) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: mediaStyles }} />
      <div className={`relative w-full h-full media-mask ${className}`}>
        {children}
        {overlay && (
          <div className="absolute inset-0 flex items-center justify-center">
            {overlay}
          </div>
        )}
      </div>
    </>
  );
}
