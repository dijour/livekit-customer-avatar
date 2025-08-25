import { useCallback, useReducer } from 'react';
import { useRoomData } from './useRoomData';

// Types for the avatar setup flow
export type AvatarSetupState = {
  step: 'photo-capture' | 'creating-avatar' | 'ready' | 'skipped';
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('showLoadingAvatar', {
          detail: { photo: action.payload }
        }));
      }
      return {
        ...state,
        userPhoto: action.payload,
        step: 'creating-avatar',
        error: null,
      };
    
    case 'AVATAR_CREATION_STARTED':
      // Dispatch event to show floating loading avatar
      
      return {
        ...state,
        step: 'creating-avatar',
        error: null,
      };
    
    case 'AVATAR_CREATED':
      // Dispatch event to hide floating loading avatar
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hideLoadingAvatar'));
      }
      return {
        ...state,
        assetId: action.payload,
        step: 'ready',
        error: null,
      };
    
    case 'AVATAR_CREATION_FAILED':
      // Dispatch event to hide floating loading avatar on failure
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hideLoadingAvatar'));
      }
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

export function useAvatarSetup(voiceCloningEnabled: boolean = false) {
  const [state, dispatch] = useReducer(avatarSetupReducer, initialState);
  const { sendVoiceCloningPreference, sendAvatarData, sendModeSwitch } = useRoomData();

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

      await sendVoiceCloningPreference(voiceCloningEnabled);
      
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

    // Send avatar data and mode switch message via LiveKit room data
    try {
      // Send voice cloning preference first
      await sendVoiceCloningPreference(voiceCloningEnabled);
      
      // Get the created avatar ID from state
      const assetId = localStorage.getItem("hedraAssetId");
      
      if (assetId) {
        // Send avatar data
        await sendAvatarData(assetId);
      }

      // Then send mode switch message with avatar ID
      await sendModeSwitch('avatar', assetId || undefined);
    } catch (error) {
      console.error('Failed to send mode switch message:', error);
    }
  }, [createAvatar, voiceCloningEnabled, sendVoiceCloningPreference, sendAvatarData, sendModeSwitch]);

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
    isCreatingAvatar: state.step === 'creating-avatar',
    isReady: state.step === 'ready' || state.step === 'skipped',
    canStartConversation: state.step === 'ready' || state.step === 'skipped',
  };
}
