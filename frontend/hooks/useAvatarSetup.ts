import { useCallback, useReducer } from 'react';

// Types for the avatar setup flow
export type AvatarSetupState = {
  step: 'photo-capture' | 'creating-avatar' | 'ready' | 'skipped';
  userPhoto: Blob | null;
  assetId: string | null;
  error: string | null;
  isLoading: boolean;
};

type AvatarSetupAction = 
  | { type: 'PHOTO_CAPTURED'; payload: Blob }
  | { type: 'AVATAR_CREATION_STARTED' }
  | { type: 'AVATAR_CREATED'; payload: string }
  | { type: 'AVATAR_CREATION_FAILED'; payload: string }
  | { type: 'PHOTO_SKIPPED' }
  | { type: 'RESET' };

const initialState: AvatarSetupState = {
  step: 'photo-capture',
  userPhoto: null,
  assetId: null,
  error: null,
  isLoading: false,
};

function avatarSetupReducer(state: AvatarSetupState, action: AvatarSetupAction): AvatarSetupState {
  switch (action.type) {
    case 'PHOTO_CAPTURED':
      return {
        ...state,
        userPhoto: action.payload,
        step: 'creating-avatar',
        isLoading: true,
        error: null,
      };
    
    case 'AVATAR_CREATION_STARTED':
      return {
        ...state,
        isLoading: true,
        error: null,
      };
    
    case 'AVATAR_CREATED':
      return {
        ...state,
        assetId: action.payload,
        step: 'ready',
        isLoading: false,
        error: null,
      };
    
    case 'AVATAR_CREATION_FAILED':
      return {
        ...state,
        step: 'ready', // Continue anyway
        isLoading: false,
        error: action.payload,
      };
    
    case 'PHOTO_SKIPPED':
      return {
        ...state,
        step: 'skipped',
        isLoading: false,
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
      
      // Set asset ID for backend agent
      await fetch("/api/set-avatar-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: result.assetId }),
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
  }, [createAvatar]);

  const handleSkipPhoto = useCallback(() => {
    dispatch({ type: 'PHOTO_SKIPPED' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    handlePhotoCapture,
    handleSkipPhoto,
    reset,
    // Computed properties for easier UI logic
    showPhotoCapture: state.step === 'photo-capture',
    isReady: state.step === 'ready' || state.step === 'skipped',
    canStartConversation: state.step === 'ready' || state.step === 'skipped',
  };
}
