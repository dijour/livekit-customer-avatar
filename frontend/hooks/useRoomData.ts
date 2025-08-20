import { useCallback } from 'react';
import { Room } from 'livekit-client';

export function useRoomData() {
  const publishData = useCallback(async (topic: string, data: any) => {
    try {
      const room = (window as any).liveKitRoom as Room;
      if (room && room.localParticipant) {
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(data)),
          { topic }
        );
        console.log(`📡 Sent ${topic} data:`, data);
        return true;
      } else {
        console.warn(`⚠️ Room not available for ${topic} message`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to send ${topic} data:`, error);
      return false;
    }
  }, []);

  const sendVoiceCloningPreference = useCallback(async (enabled: boolean) => {
    return await publishData('voice_cloning_preference', { voiceCloningEnabled: enabled });
  }, [publishData]);

  const sendAvatarData = useCallback(async (assetId: string) => {
    return await publishData('avatar_data', { assetId });
  }, [publishData]);

  const sendModeSwitch = useCallback(async (mode: string, avatarId?: string) => {
    return await publishData('mode_switch', { action: 'switch_mode', mode, avatarId });
  }, [publishData]);

  const sendUserStateChange = useCallback(async (action: string, timestamp?: number) => {
    return await publishData('user_state_change', { action, timestamp: timestamp || Date.now() });
  }, [publishData]);

  return {
    publishData,
    sendVoiceCloningPreference,
    sendAvatarData,
    sendModeSwitch,
    sendUserStateChange,
  };
}
