import React from 'react';

interface BrowseIconProps {
  className?: string;
  size?: number;
}

export const BrowseIcon: React.FC<BrowseIconProps> = ({ className = "", size = 32 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 32 32" 
      fill="none" 
      className={className}
    >
      <path 
        opacity="0.5" 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M6.66536 5.3335H25.332V4.00016C25.332 2.5335 24.132 1.3335 22.6654 1.3335H9.33203C7.86536 1.3335 6.66536 2.5335 6.66536 4.00016V5.3335ZM7.9987 6.66683H23.9987C25.4654 6.66683 26.6654 7.86683 26.6654 9.3335V10.6668H5.33203V9.3335C5.33203 7.86683 6.53203 6.66683 7.9987 6.66683Z" 
        fill="currentColor"
      />
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M25.3333 12H6.66662C5.11329 12 3.88929 13.3227 4.00796 14.8707L4.93062 26.8707C5.03729 28.26 6.19596 29.3333 7.58929 29.3333H24.4093C25.8026 29.3333 26.9613 28.26 27.068 26.8707L27.9906 14.8707C28.1106 13.3227 26.8866 12 25.3333 12Z" 
        fill="currentColor"
      />
    </svg>
  );
};
