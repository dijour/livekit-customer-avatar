import { useCallback, useReducer } from 'react';

// Types for the avatar setup flow
export type AvatarSetupState = {
  step: 'photo-capture' | 'ready' | 'skipped';
  userPhoto: Blob | null;
  assetId: string | null;
  error: string | null;
};

type AvatarSetupAction = 
  | { type: 'PHOTO_CAPTURED'; payload: Blob }
  | { type: 'AVATAR_CREATION_STARTED' }
  | { type: 'AVATAR_CREATED'; payload: string }
  | { type: 'AVATAR_CREATION_FAILED'; payload: string }
  | { type: 'PHOTO_SKIPPED' }
  | { type: 'SHOW_PHOTO_CAPTURE' }
  | { type: 'RESET' };

const initialState: AvatarSetupState = {
  step: 'ready', // Start in ready state, will be triggered to photo-capture by agent
  userPhoto: null,
  assetId: null,
  error: null,
};

function avatarSetupReducer(state: AvatarSetupState, action: AvatarSetupAction): AvatarSetupState {
  switch (action.type) {
    case 'PHOTO_CAPTURED':
      return {
        ...state,
        userPhoto: action.payload,
        step: 'ready',
        error: null,
      };
    
    case 'AVATAR_CREATION_STARTED':
      return {
        ...state,
        error: null,
      };
    
    case 'AVATAR_CREATED':
      return {
        ...state,
        assetId: action.payload,
        step: 'ready',
        error: null,
      };
    
    case 'AVATAR_CREATION_FAILED':
      return {
        ...state,
        step: 'ready', // Continue anyway
        error: action.payload,
      };
    
    case 'PHOTO_SKIPPED':
      return {
        ...state,
        step: 'skipped',
        error: null,
      };
    
    case 'SHOW_PHOTO_CAPTURE':
      return {
        ...state,
        step: 'photo-capture',
        error: null,
      };
    
    case 'RESET':
      return initialState;
    
    default:
      return state;
  }
}

export function useAvatarSetup() {
  const [state, dispatch] = useReducer(avatarSetupReducer, initialState);

  const createAvatar = useCallback(async (photoBlob: Blob): Promise<void> => {
    try {
      dispatch({ type: 'AVATAR_CREATION_STARTED' });

      // Create avatar via Hedra API
      const formData = new FormData();
      formData.append("photo", photoBlob, "avatar-photo.jpg");
      
      const response = await fetch("/api/create-avatar", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Avatar creation failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.assetId) {
        throw new Error("No asset ID received from avatar creation");
      }

      // Store asset ID locally and send to backend
      localStorage.setItem("hedraAssetId", result.assetId);
      
      // Set asset ID for backend agent and trigger voice switch
      await fetch("/api/set-avatar-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          assetId: result.assetId,
          switchVoice: true
        }),
      });

      dispatch({ type: 'AVATAR_CREATED', payload: result.assetId });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("Avatar creation failed:", error);
      dispatch({ type: 'AVATAR_CREATION_FAILED', payload: errorMessage });
    }
  }, []);

  const handlePhotoCapture = useCallback(async (photoBlob: Blob) => {
    dispatch({ type: 'PHOTO_CAPTURED', payload: photoBlob });
    await createAvatar(photoBlob);

    try {
      await fetch('/api/switch-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'avatar' })
      });
    } catch (error) {
      console.error('Failed to switch mode:', error);
    }
  }, [createAvatar]);

  const handleSkipPhoto = useCallback(() => {
    dispatch({ type: 'PHOTO_SKIPPED' });
  }, []);

  const showPhotoCapture = useCallback(() => {
    dispatch({ type: 'SHOW_PHOTO_CAPTURE' });
  }, []);

  const reset = useCallback(async () => {
    // Reset voice state to Alexa mode
    try {
      await fetch("/api/reset-voice-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          clearAssetId: true
        }),
      });
    } catch (error) {
      console.error("Failed to reset voice state:", error);
    }
    
    // Clear local storage
    localStorage.removeItem("hedraAssetId");
    
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    handlePhotoCapture,
    handleSkipPhoto,
    showPhotoCaptureAction: showPhotoCapture,
    reset,
    // Computed properties for easier UI logic
    showPhotoCapture: state.step === 'photo-capture',
    isReady: state.step === 'ready' || state.step === 'skipped',
    canStartConversation: state.step === 'ready' || state.step === 'skipped',
  };
}
