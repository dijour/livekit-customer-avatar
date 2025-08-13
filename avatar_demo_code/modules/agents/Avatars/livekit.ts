
import { RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, DataPacket_Kind } from 'livekit-client';
import { RoomEvent, RpcError, RpcInvocationData } from 'livekit-client';
import { alexaAgent } from './main';
import { MakeProcedure } from 'alexa-agents-api';
import { QuitApp } from 'alexa-agents-api/htmlProceduresToAlexa';

let room: Room;
let parentElement = document.getElementById('livekit')! as HTMLVideoElement;

export async function startLivekit() {
  const serverInfo = await (await fetch('/avatars/token')).json();

  startCallSound("connecting");

  console.log(serverInfo);

  room = new Room();
  room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);

  await room.connect(serverInfo.url, serverInfo.token, {
    autoSubscribe: true
  });

  room.on("disconnected", () => {
    handleEndCall();
  })

  room.registerRpcMethod('endCall', async () => {
    console.log('endCall');
    setTimeout(() => {
      room.disconnect();
      stopMusic();
    }, 100);
    return JSON.stringify("OK");
  })

  room.registerRpcMethod('openCamera', async () => {
    console.log('openCamera');
    openCameraModal();
    return JSON.stringify("Camera opened");
  })

  // Enables the microphone and publishes it to a new audio track
  await room.localParticipant.setMicrophoneEnabled(true);

  // room.disconnect();
}

function handleEndCall() {
  stopMusic();
  startCallSound("end");
  alexaAgent.postProceduresToAlexaDevice([
    MakeProcedure<QuitApp>("Quit App", {})
  ])
  document.getElementById('title')?.classList.add('fade-out');
}


function handleTrackSubscribed(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
) {
  console.log(track);

  startCallSound('start');

  /* Do things with track, publication or participant */
  const element = track.attach(parentElement);
  // parentElement.appendChild(element);

  setTimeout(() => {
    startMusic();
  }, 500);

  if (track.kind === 'video') {
    document.getElementById('title')?.classList.add('fade-in');
    parentElement.classList.add('fade-in-delay');
    //track.on('', () => {})
  }
}


let musicIsPlaying = false;
export function startMusic() {
  if (musicIsPlaying) return;
  musicIsPlaying = true;

  const player = document.getElementById('music') as HTMLAudioElement;
  player.volume = 0.1;
  player.loop = true;
  player.currentTime = 0;
  player.play();

  setTimeout(() => {
    player.volume = 0.05;
  }, 6 * 1000);
}

export function stopMusic() {
  if (!musicIsPlaying) return;
  musicIsPlaying = false;

  const player = document.getElementById('music') as HTMLAudioElement;
  player.pause();
}

let lastCallSound = '';
function stopCallSounds() {
  lastCallSound = '';
  const start = document.getElementById('call-start') as HTMLAudioElement;
  const end = document.getElementById('call-end') as HTMLAudioElement;
  const connecting = document.getElementById('call-connecting') as HTMLAudioElement;

  start.pause();
  end.pause();
  connecting.pause();
}

function startCallSound(name: "start" | "end" | "connecting") {
  if (lastCallSound === name) return;
  lastCallSound = name;

  const start = document.getElementById('call-start') as HTMLAudioElement;
  const end = document.getElementById('call-end') as HTMLAudioElement;
  const connecting = document.getElementById('call-connecting') as HTMLAudioElement;

  connecting.loop = true;

  start.pause();
  end.pause();
  connecting.pause();

  switch (name) {
    case "start": {
      start.currentTime = 0;
      start.play();
      break;
    }

    case "end": {
      end.currentTime = 0;
      end.play();
      break;
    }

    case "connecting": {
      connecting.currentTime = 0;
      connecting.play();
      break;
    }
  }
}

function openCameraModal() {
  // Create camera container (no modal overlay)
  const container = document.createElement('div');
  container.id = 'camera-modal';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    background: white;
    border-radius: 10px;
    padding: 15px;
    width: 300px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    text-align: center;
  `;

  // Create video element for camera feed
  const video = document.createElement('video');
  video.style.cssText = `
    width: 100%;
    height: 200px;
    background: #000;
    border-radius: 5px;
    margin-bottom: 10px;
  `;
  video.autoplay = true;
  video.muted = true;

  // Create canvas for capturing photo (hidden)
  const canvas = document.createElement('canvas');
  canvas.style.display = 'none';

  // Create buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    gap: 10px;
    justify-content: center;
  `;

  const takePhotoBtn = document.createElement('button');
  takePhotoBtn.textContent = 'Take Photo';
  takePhotoBtn.style.cssText = `
    padding: 10px 20px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
  `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = `
    padding: 10px 20px;
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
  `;

  // Add elements to container
  container.appendChild(video);
  buttonContainer.appendChild(takePhotoBtn);
  buttonContainer.appendChild(closeBtn);
  container.appendChild(buttonContainer);
  document.body.appendChild(container);

  // Start camera
  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      video.srcObject = stream;
      
      // Take photo functionality
      takePhotoBtn.onclick = async () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0);
        
        // Convert to blob and stream to agent
        canvas.toBlob(async (blob) => {
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Stream image data to agent
            const writer = await room.localParticipant.streamBytes({
              name: `photo-${Date.now()}`,
              topic: 'photo'
            });
            
            const chunkSize = 15000;
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.slice(i, i + chunkSize);
              await writer.write(chunk);
            }
            
            await writer.close();
            
            console.log('Photo streamed to agent');
            takePhotoBtn.textContent = 'Photo Sent!';
            setTimeout(() => {
              takePhotoBtn.textContent = 'Take Photo';
            }, 2000);
          }
        }, 'image/png');
      };
      
      // Close functionality
      const closeCamera = () => {
        stream.getTracks().forEach(track => track.stop());
        document.body.removeChild(container);
      };
      
      closeBtn.onclick = closeCamera;
    })
    .catch(err => {
      console.error('Error accessing camera:', err);
      container.innerHTML = '<p>Error accessing camera. Please check permissions.</p>';
    });
}