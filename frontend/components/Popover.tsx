import { ReactNode, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  triggerRef: React.RefObject<HTMLElement>;
  align?: 'center' | 'right' | 'bottom';
  width?: number;
}

export function Popover({ isOpen, onClose, children, triggerRef, align = 'center', width = 390 }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      // Small delay to ensure DOM is updated
      const calculatePosition = () => {
        if (!triggerRef.current || !popoverRef.current) return;
        
        const rect = triggerRef.current.getBoundingClientRect();
        const popoverRect = popoverRef.current.getBoundingClientRect();
        const popoverWidth = width;
        
        let left = 0;
        let top = 0;
        
        if (align === 'center') {
          left = rect.left + (rect.width / 2) - (popoverWidth / 2);
          top = rect.top - popoverRect.height - 36; // popover height + 36px gap above button
        } else if (align === 'right') {
          left = rect.right - popoverWidth;
          top = rect.top - popoverRect.height - 36; // popover height + 36px gap above button
        } else if (align === 'bottom') {
          const centerX = rect.left + (rect.width / 2);
          left = centerX - (popoverWidth / 2);
          top = rect.bottom + 12; // 12px gap below button
          
          // Ensure popover stays within viewport bounds with more conservative margins
          const viewportWidth = window.innerWidth;
          const minLeft = 32; // 32px margin from left edge
          const maxLeft = viewportWidth - popoverWidth - 32; // 32px margin from right edge
          
          // Clamp the position to stay within bounds
          if (left < minLeft) {
            left = minLeft;
          } else if (left > maxLeft) {
            left = maxLeft;
          }
        }
        
        setPosition({ top, left });
      };
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(calculatePosition);
    }
  }, [isOpen, align, triggerRef, width]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        triggerRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, triggerRef]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: [0.09, 1.04, 0.245, 1.055] }}
          className="fixed z-50"
          style={{ 
            width: `${width}px`,
            top: position.top,
            left: position.left
          }}
        >
          <div className="bg-gradient-to-b from-white/0 to-white/10 rounded-[36px] backdrop-blur-lg relative">
            <div className="absolute inset-0 bg-[#F5F5F5]/10 rounded-[36px] pointer-events-none"></div>
            <div className="relative z-10">
              {children}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
