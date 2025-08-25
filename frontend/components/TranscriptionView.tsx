import useCombinedTranscriptions from "@hooks/useCombinedTranscriptions";
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function TranscriptionView() {
  const combinedTranscriptions = useCombinedTranscriptions();

  // Get only the most recent assistant message
  const transcriptions = combinedTranscriptions;
  const mostRecentAssistantMessage = React.useMemo(() => {
    const assistantMessages = transcriptions.filter(segment => segment.role === 'assistant');
    return assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null;
  }, [transcriptions]);

  return (
    <div className="relative h-full">
      <div className="h-[120px] flex flex-col gap-2 overflow-y-auto justify-end">
        <AnimatePresence mode="wait">
          {mostRecentAssistantMessage && (
            <motion.div
              key={mostRecentAssistantMessage.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ 
                duration: 0.4, 
                ease: [0.09, 1.04, 0.245, 1.055],
                scale: { duration: 0.3 }
              }}
              className="p-2 self-start fit-content"
            >
              {mostRecentAssistantMessage.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
