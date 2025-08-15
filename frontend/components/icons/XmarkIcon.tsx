import React from 'react';

interface XmarkIconProps {
  className?: string;
  size?: number;
}

export const XmarkIcon: React.FC<XmarkIconProps> = ({ className = "", size = 37 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 37 37" 
      fill="none" 
      className={className}
    >
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M29.1074 26.9858L20.6219 18.5003L29.1074 10.0148C29.6924 9.42983 29.6924 8.47883 29.1074 7.89383C28.5224 7.30883 27.5714 7.30883 26.9864 7.89383L18.5009 16.3793L10.0154 7.89383C9.43039 7.30883 8.47939 7.30883 7.89439 7.89383C7.30939 8.47883 7.30939 9.42983 7.89439 10.0148L16.3799 18.5003L7.89439 26.9858C7.30789 27.5723 7.30939 28.5218 7.89439 29.1068C8.47939 29.6918 9.42889 29.6933 10.0154 29.1068L18.5009 20.6213L26.9864 29.1068C27.5714 29.6918 28.5224 29.6918 29.1074 29.1068C29.6924 28.5218 29.6939 27.5708 29.1074 26.9858Z" 
        fill="currentColor"
      />
    </svg>
  );
};
