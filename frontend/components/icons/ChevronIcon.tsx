import React from 'react';

interface ChevronIconProps {
  className?: string;
  size?: number;
}

export const ChevronIcon: React.FC<ChevronIconProps> = ({ className = "", size = 32 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 32 32" 
      fill="none" 
      className={className}
    >
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M18.6683 23.9998C18.327 23.9998 17.9856 23.8692 17.7256 23.6092L11.059 16.9425C10.5376 16.4212 10.5376 15.5785 11.059 15.0572L17.7256 8.39051C18.247 7.86918 19.0896 7.86918 19.611 8.39051C20.1323 8.91185 20.1323 9.75451 19.611 10.2758L13.887 15.9998L19.611 21.7238C20.1323 22.2452 20.1323 23.0878 19.611 23.6092C19.351 23.8692 19.0096 23.9998 18.6683 23.9998Z" 
        fill="currentColor"
      />
    </svg>
  );
};
