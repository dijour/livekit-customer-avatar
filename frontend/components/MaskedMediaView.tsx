"use client";

import React from "react";

type MaskType = 'gradient' | 'svg-blur';

// CSS styles for gradient mask
const gradientMaskStyles = `
  .media-mask-gradient {
    -webkit-mask: 
      linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
    mask: 
      linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
  
  .media-mask-gradient::before {
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

// CSS styles for SVG blur mask
const svgMaskStyles = `
  .media-mask-svg {
    -webkit-mask: url(#blurred-rect-mask);
    mask: url(#blurred-rect-mask);
  }
`;

// Reusable masked media view component
interface MaskedMediaViewProps {
  children: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
  maskType?: MaskType;
  blurAmount?: number;
  featherSize?: number;
  borderRadius?: number;
}

export function MaskedMediaView({ 
  children, 
  overlay, 
  className = "", 
  maskType = 'gradient',
  blurAmount = 10,
  featherSize = 25,
  borderRadius = 20
}: MaskedMediaViewProps) {
  const maskId = `blurred-rect-mask-${Math.random().toString(36).substr(2, 9)}`;
  
  return (
    <>
      {maskType === 'gradient' && (
        <style dangerouslySetInnerHTML={{ __html: gradientMaskStyles }} />
      )}
      {maskType === 'svg-blur' && (
        <>
          <style dangerouslySetInnerHTML={{ __html: svgMaskStyles.replace('#blurred-rect-mask', `#${maskId}`) }} />
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <mask id={maskId}>
                {/* White rectangle with blur filter for the mask */}
                <rect 
                  x={`${featherSize}%`} 
                  y={`${featherSize}%`} 
                  width={`${100 - featherSize * 2}%`} 
                  height={`${100 - featherSize * 2}%`} 
                  rx={borderRadius}
                  ry={borderRadius}
                  fill="white" 
                  filter={`url(#blur-${maskId})`}
                />
              </mask>
              <filter id={`blur-${maskId}`}>
                <feGaussianBlur in="SourceGraphic" stdDeviation={blurAmount} />
              </filter>
            </defs>
          </svg>
        </>
      )}
      <div className={`relative w-full h-full ${
        maskType === 'gradient' ? 'media-mask-gradient' : 'media-mask-svg'
      } ${className}`}>
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
