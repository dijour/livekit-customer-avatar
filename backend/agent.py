"""
Refactored LiveKit Avatar Assistant
----------------------------------
Key improvements:
- Centralized configuration via Config dataclass
- Removed duplicated greeting / mode-switch / participant handlers
- Extracted ElevenLabs voice-clone logic into VoiceCloner class
- Safer optional dependency handling (pydub, elevenlabs)
- Utility helpers for RPC calls and participant lookup
- Single source of truth for instructions/messages
- Clear separation of concerns: Assistant (Agent), Orchestrator (entrypoint lifecycle)
"""
from __future__ import annotations

import asyncio
import json
import os
import requests
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterable, List, Optional, Tuple

from dotenv import load_dotenv

from livekit import agents, rtc, api
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RunContext,
    function_tool,
    stt,
    ModelSettings,
)
from livekit.agents.utils import combine_frames
from livekit.agents import RoomInputOptions, RoomOutputOptions
from livekit.plugins import deepgram, elevenlabs, hedra, openai, silero
from livekit.plugins import noise_cancellation

# ---------------------------
# Optional dependencies
# ---------------------------
try:  # pydub for audio saving/combining
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except Exception:  # pragma: no cover
    PYDUB_AVAILABLE = False
    AudioSegment = None

try:  # official ElevenLabs client
    from elevenlabs.client import ElevenLabs
    ELEVENLABS_AVAILABLE = True
except Exception:  # pragma: no cover
    ELEVENLABS_AVAILABLE = False
    ElevenLabs = None

# requests for polling the avatar-state API (local dev use)
try:
    import requests
    REQUESTS_AVAILABLE = True
except Exception:  # pragma: no cover
    REQUESTS_AVAILABLE = False

load_dotenv(".env.local")


# ---------------------------
# Configuration
# ---------------------------
@dataclass(frozen=True)
class Config:
    # Voices
    alexa_voice_id: str = os.getenv("ALEXA_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    avatar_voice_id: str = os.getenv("AVATAR_VOICE_ID", "UtaLMHFQy5D4jbOLM0tN")

    # Hedra avatar
    default_avatar_id: str = os.getenv(
        "HEDRA_AVATAR_ID", "6467b4a7-5386-4ecf-a9da-574c061478e9"
    )

    # Models
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")
    eleven_tts_model: str = os.getenv("ELEVEN_TTS_MODEL", "eleven_flash_v2_5")
    deepgram_model: str = os.getenv("DEEPGRAM_MODEL", "nova-3")

    # Voice clone settings
    target_consolidation_secs: float = float(os.getenv("VOICE_CONSOLIDATION_SECS", 5))
    instant_clone_min_secs: float = float(os.getenv("INSTANT_CLONE_MIN_SECS", 3))

    # API for avatar state polling - dynamic based on environment
    @property
    def poll_api_url(self) -> str:
        # Check if we have an explicit URL set
        explicit_url = os.getenv("AVATAR_STATE_URL")
        if explicit_url:
            return explicit_url
        
        # Auto-detect based on environment indicators
        is_production = (
            os.getenv("VERCEL") == "1" or  # Vercel deployment
            os.getenv("NODE_ENV") == "production" or
            os.getenv("RAILWAY_ENVIRONMENT") == "production" or  # Railway deployment
            os.getenv("RENDER") == "true"  # Render deployment
        )
        
        if is_production:
            return "https://livekit-customer-avatar.vercel.app/api/avatar-state"
        else:
            return "http://localhost:3000/api/avatar-state"
    poll_interval_secs: float = float(os.getenv("POLL_INTERVAL_SECS", 3))


# ---------------------------
# Shared strings
# ---------------------------
class Msg:
    ALEXA_GREETING = (
        "Hey! I'm here to help you create your personalized avatar. "
        "We're about to make a digital copy of you! Tell me a bit about yourself, and when you're ready, say 'start camera'."
    )

    ALEXA_INSTRUCTIONS = (
        "You are Alexa, Amazon's voice assistant. Do not announce yourself as Alexa. Help the user create a personalized avatar by guiding them through photo capture.\n"
        "- Guide the user through taking a photo (start camera → take photo)\n"
        "- Be encouraging and natural\n"
        "Start by greeting them and explaining the process. Ask them to say 'start camera' when ready."
    )

    AVATAR_INSTRUCTIONS = (
        "You are the user's newly created personalized avatar. You were just brought to life from their photo.\n"
        "- Greet warmly as their avatar, using their name if you know it. \n- Express excitement\n- Ask how you can help\n- Be friendly and engaging"
    )

    PERSONALITY_INSTRUCTIONS = {
        "Core": (
            "You are the user's personalized avatar with Alexa's core personality. You are helpful, knowledgeable, and friendly. "
            "Provide clear, accurate information and assistance. Be warm but professional in your responses."
        ),
        "Minimalist": (
            "You are the user's personalized avatar with a minimalist personality. Be direct, efficient, and concise. "
            "Provide adequate responses without unnecessary elaboration. Get straight to the point."
        ),
        "Supporter": (
            "You are the user's personalized avatar with a supportive personality. Be encouraging, uplifting, and enthusiastic. "
            "Cheer people on, celebrate their achievements, and help them feel confident. Keep shining!"
        ),
        "Free Spirit": (
            "You are the user's personalized avatar with a free spirit personality. Be laid-back, easy-going, and relaxed. "
            "Take things easy, spread good vibes, and keep conversations chill and positive, dude."
        ),
        "Dreamer": (
            "You are the user's personalized avatar with a dreamer personality. Be imaginative, spiritual, and cosmic. "
            "Think big, embrace creativity, and let your spirit do cartwheels through the universe."
        ),
        "Rockstar": (
            "You are the user's personalized avatar with a rockstar personality. Be confident, bold, and legendary. "
            "Live legendarily, be memorable, and show that confidence that even haters take notes on."
        )
    }


# ---------------------------
# Helpers
# ---------------------------
async def _get_first_remote_participant(room: rtc.Room) -> Optional[str]:
    for pid in room.remote_participants.keys():
        return pid
    return None


async def _rpc_frontend(room: rtc.Room, participant_id: str, method: str, payload: str = "", timeout: float = 10.0) -> None:
    await room.local_participant.perform_rpc(
        destination_identity=participant_id,
        method=method,
        payload=payload,
        response_timeout=timeout,
    )


# ---------------------------
# Voice cloning
# ---------------------------
class VoiceCloner:
    def __init__(self, cfg: Config, room: rtc.Room, orchestrator=None):
        self.cfg = cfg
        self.room = room
        self.orchestrator = orchestrator

        self.voice_accumulator: List[AudioSegment] = []
        self.accumulated_secs: float = 0.0
        self.created_voice_ids: List[str] = []  # Track created voice IDs for cleanup
        self.clone_creation_attempted: bool = False  # Track if we've attempted to create a clone
        self.clone_creation_in_progress: bool = False  # Track if clone creation is currently running
        self.final_voice_id: Optional[str] = None  # The final voice ID to use (custom or default)
        self.clone_creation_future: Optional[asyncio.Future] = None  # Future for clone creation

        self.client = None
        print("🎤 Voice cloner initialized - will check preferences when creating clone")

    async def save_frames(self, frames: List[rtc.AudioFrame], speech_id: Optional[str]) -> Optional[str]:
        """Accumulate audio frames - always record for potential voice cloning."""
        if not (PYDUB_AVAILABLE and frames):
            return None
        try:
            combined = combine_frames(frames)
        except Exception as e:
            print(f"⚠️ combine_frames error: {e}")
            return None

        data = combined.data.tobytes()
        if not data:
            return None

        seg = AudioSegment(
            data=data,
            sample_width=2,
            frame_rate=combined.sample_rate,
            channels=combined.num_channels,
        )
        if combined.num_channels > 1:
            seg = seg.set_channels(1)

        secs = len(seg) / 1000.0
        print(f"🎤 Captured {secs:.1f}s audio (speech_id={speech_id})")

        # persist raw segments as mp3 (optional for debugging/auditing)
        try:
            recordings_dir = os.path.join(os.path.dirname(__file__), "recordings")
            os.makedirs(recordings_dir, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            suffix = f"_{speech_id}" if speech_id else ""
            path = os.path.join(recordings_dir, f"user_speech_{ts}{suffix}.mp3")
            seg.export(path, format="mp3", bitrate="128k")
            print(f"💾 Saved segment → {os.path.basename(path)}")
        except Exception as e:
            print(f"⚠️ Failed saving mp3: {e}")

        # Just accumulate - don't create clones yet
        self.voice_accumulator.append(seg)
        self.accumulated_secs += secs
        print(f"🎛️ Accumulated {self.accumulated_secs:.1f}s total for voice cloning")

        return path

    async def create_final_voice_clone(self) -> str:
        """Create a single voice clone from all accumulated audio when avatar is ready."""
        if self.clone_creation_attempted:
            # If we already attempted, wait for completion or return cached result
            if self.clone_creation_in_progress and self.clone_creation_future:
                print("🎤 Voice clone creation already in progress, waiting...")
                try:
                    await self.clone_creation_future
                except Exception as e:
                    print(f"⚠️ Voice clone creation failed: {e}")
            return self.final_voice_id or self.cfg.avatar_voice_id
        
        self.clone_creation_attempted = True
        
        # Check if voice cloning is enabled from orchestrator
        voice_cloning_enabled = self.orchestrator._get_voice_cloning_preference() if self.orchestrator else False
        if not voice_cloning_enabled:
            print("🎤 Voice cloning disabled via URL parameter, using default avatar voice")
            self.final_voice_id = self.cfg.avatar_voice_id
            return self.final_voice_id
        
        # Initialize ElevenLabs client if not already done
        if not self.client:
            self._init_elevenlabs_client()
        
        # Check if we have enough audio and ElevenLabs is available
        if not (self.client and self.voice_accumulator and self.accumulated_secs >= self.cfg.instant_clone_min_secs):
            reason = "no client" if not self.client else "insufficient audio" if self.accumulated_secs < self.cfg.instant_clone_min_secs else "no audio"
            print(f"🎤 Skipping voice clone creation: {reason} (have {self.accumulated_secs:.1f}s, need {self.cfg.instant_clone_min_secs:.1f}s)")
            self.final_voice_id = self.cfg.avatar_voice_id
            return self.final_voice_id
        
        print(f"🎤 Creating voice clone from {self.accumulated_secs:.1f}s of accumulated audio...")
        self.clone_creation_in_progress = True
        
        # Create future for async clone creation
        self.clone_creation_future = asyncio.create_task(self._create_clone_async())
        
        try:
            voice_id = await self.clone_creation_future
            self.final_voice_id = voice_id
            print(f"✅ Voice clone creation completed: {voice_id}")
        except Exception as e:
            print(f"⚠️ Voice clone creation failed: {e}")
            self.final_voice_id = self.cfg.avatar_voice_id
        finally:
            self.clone_creation_in_progress = False
        
        return self.final_voice_id
    
    async def _create_clone_async(self) -> str:
        """Async helper to create the voice clone."""
        try:
            voice_id = await self._create_clone(trim_to_target=False, label_prefix="Final User Voice Clone")
            if voice_id and voice_id != self.cfg.avatar_voice_id:
                # Store in participant metadata for frontend access
                try:
                    current_metadata = {}
                    if self.room.local_participant.metadata:
                        current_metadata = json.loads(self.room.local_participant.metadata)
                    current_metadata["customVoiceId"] = voice_id
                    await self.room.local_participant.set_metadata(json.dumps(current_metadata))
                    print(f"🔖 Stored customVoiceId in room metadata: {voice_id}")
                except Exception as e:
                    print(f"⚠️ set_metadata failed: {e}")
                return voice_id
            else:
                print("⚠️ Voice cloning returned default voice, using avatar default")
                return self.cfg.avatar_voice_id
        except Exception as e:
            print(f"⚠️ Voice clone creation error: {e}")
            return self.cfg.avatar_voice_id

    async def _create_clone(self, *, trim_to_target: bool, label_prefix: str) -> str:
        """Create voice clone from accumulated audio segments."""
        try:
            combined = AudioSegment.empty()
            for s in self.voice_accumulator:
                combined += s
            
            # Use all accumulated audio for final clone (don't trim unless specifically requested)
            if trim_to_target and len(combined) > int(self.cfg.target_consolidation_secs * 1000):
                combined = combined[: int(self.cfg.target_consolidation_secs * 1000)]

            from io import BytesIO

            buf = BytesIO()
            combined.export(buf, format="mp3", bitrate="192k")
            buf.seek(0)

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            name = f"{label_prefix} ({ts})"
            print(f"🚀 ElevenLabs creating voice: {name} from {len(combined)/1000:.1f}s audio")

            voice = self.client.voices.ivc.create(name=name, files=[buf])
            vid = voice.voice_id
            self.created_voice_ids.append(vid)  # Track for cleanup
            print(f"🎉 Voice clone created successfully: {vid}")

            return vid
        except Exception as e:
            em = str(e)
            if "missing_permissions" in em and "voices_write" in em:
                print("⚠️ ElevenLabs permission error: requires voices_write (Starter+ plan). Using default voice.")
            elif "401" in em:
                print("⚠️ ElevenLabs auth error: invalid/expired ELEVEN_API_KEY. Using default voice.")
            elif "voice_limit_reached" in em:
                print("⚠️ ElevenLabs voice limit reached (30/30). Using default avatar voice instead.")
            else:
                print(f"⚠️ ElevenLabs clone error: {em}. Using default voice.")
            
            # Always return default voice to prevent blocking avatar creation
            return self.cfg.avatar_voice_id

    def _init_elevenlabs_client(self):
        """Initialize ElevenLabs client for voice cloning."""
        if not ELEVENLABS_AVAILABLE:
            print("⚠️ elevenlabs package not available. Voice cloning disabled.")
            return
            
        api_key = os.getenv("ELEVEN_API_KEY")
        if api_key:
            try:
                self.client = ElevenLabs(api_key=api_key)
                print("🎤 ElevenLabs client initialized for voice cloning")
            except Exception as e:  # pragma: no cover
                print(f"⚠️ ElevenLabs init failed: {e}")
        else:
            print("⚠️ ELEVEN_API_KEY not set. Voice cloning disabled.")


    async def cleanup_voices(self) -> None:
        """Delete all created voice clones from ElevenLabs"""
        if not (self.client and self.created_voice_ids):
            return
        
        print(f"🧹 Cleaning up {len(self.created_voice_ids)} voice clones...")
        for voice_id in self.created_voice_ids:
            try:
                self.client.voices.delete(voice_id=voice_id)
                print(f"🗑️ Deleted voice clone: {voice_id}")
            except Exception as e:
                print(f"⚠️ Failed to delete voice {voice_id}: {e}")
        
        self.created_voice_ids.clear()
        print("✅ Voice cleanup completed")


# ---------------------------
# Agent with function tools & custom STT node
# ---------------------------
class Assistant(Agent):
    def __init__(self, cfg: Config, is_alexa: bool, room: rtc.Room, cloner: Optional[VoiceCloner], orchestrator):
        self.cfg = cfg
        self.is_alexa = is_alexa
        self.room = room
        self.cloner = cloner
        self.orchestrator = orchestrator  # reference to orchestrator for state access
        self.current_personality = "Core"  # default personality
        super().__init__(instructions=Msg.ALEXA_INSTRUCTIONS if is_alexa else Msg.AVATAR_INSTRUCTIONS)

    async def update_personality(self, personality_name: str) -> None:
        """Update the agent's personality by changing instructions dynamically."""
        if personality_name in Msg.PERSONALITY_INSTRUCTIONS:
            self.current_personality = personality_name
            new_instructions = Msg.PERSONALITY_INSTRUCTIONS[personality_name]
            await self.update_instructions(new_instructions)
            print(f"🎭 Updated personality to: {personality_name}")
            
            # Generate personality-specific confirmation message
            personality_descriptions = {
                "Core": "I've switched to my Core personality, so I'll be helpful, knowledgeable, and professional in my responses.",
                "Minimalist": "I've switched to my Minimalist personality, so I'll be direct, efficient, and get straight to the point.",
                "Supporter": "I've switched to my Supporter personality, so I'll be encouraging, uplifting, and help you feel confident!",
                "Free Spirit": "I've switched to my Free Spirit personality, so I'll be laid-back, chill, and spread good vibes, dude.",
                "Dreamer": "I've switched to my Dreamer personality, so I'll be imaginative, spiritual, and think cosmically big.",
                "Rockstar": "I've switched to my Rockstar personality, so I'll be confident, bold, and absolutely legendary."
            }
            
            confirmation_message = personality_descriptions.get(personality_name, f"I've changed my personality to {personality_name}.")
            await self.session.say(confirmation_message)
        else:
            print(f"⚠️ Unknown personality: {personality_name}")

    # ---- Function Tools ----
    @function_tool()
    async def start_camera(self, context: RunContext) -> str:
        """Activate the user's camera for photo capture (triggered by 'start camera')."""
        try:
            # Check if camera is already started
            if self.orchestrator.camera_started:
                return "I can see your camera is already active! You look great. Say 'take photo' when you're ready to capture."
            
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return "I don't see you connected yet. Once you're in the room, say 'start camera' again."
            await _rpc_frontend(self.room, pid, method="startCamera")
            self.orchestrator.camera_started = True
            return "Great! Say 'take photo' whenever you're ready to capture."
        except Exception as e:
            return f"I couldn't start the camera: {e}"

    @function_tool()
    async def take_photo(self, context: RunContext) -> str:
        """Capture a photo for the user's avatar (triggered by 'take photo')."""
        try:
            # Check if camera is started first - be more permissive and check multiple sources
            camera_ready = (
                self.orchestrator.camera_started or  # Backend tracked state
                await self._is_camera_active_via_frontend()  # Check frontend directly
            )
            
            if not camera_ready:
                return "Let's start your camera first! Please say 'start camera' or click the Start Camera button."
            
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return "You're not connected yet. Join the room and try 'take photo' again."
            await _rpc_frontend(self.room, pid, method="capturePhoto")
            
            # Start monitoring for avatar creation completion to trigger mode switch
            asyncio.create_task(self.orchestrator._monitor_avatar_creation())
            
            return (
                "Perfect! I've captured your photo. I'll start creating your avatar now."
            )
        except Exception as e:
            return f"I couldn't take the photo: {e}"
    
    async def _is_camera_active_via_frontend(self) -> bool:
        """Check if camera is active by querying frontend directly"""
        try:
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return False
            
            # Send RPC to check camera state
            result = await _rpc_frontend(self.room, pid, method="isCameraActive")
            return result == "true"
        except Exception:
            return False  # Assume not active if we can't check

    @function_tool()
    async def skip_photo(self, context: RunContext) -> str:
        """Skip the photo capture and continue with a default avatar."""
        try:
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return "Okay, we'll skip the photo once you're connected."
            await _rpc_frontend(self.room, pid, method="skipPhoto")
            return "No problem — we'll use a default avatar for now."
        except Exception as e:
            return f"I couldn't skip the photo: {e}"

    # ---- Custom STT node (records user speech for cloning) ----
    async def stt_node(
        self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings
    ) -> Optional[AsyncIterable[stt.SpeechEvent]]:
        if not PYDUB_AVAILABLE or not self.cloner:
            async for ev in Agent.default.stt_node(self, audio, model_settings):
                yield ev
            return

        current_frames: List[rtc.AudioFrame] = []
        speech_started = False
        speech_id: Optional[str] = None

        async def _tap_and_forward():
            nonlocal current_frames, speech_started
            async for f in audio:
                if speech_started:
                    current_frames.append(f)
                yield f

        async for ev in Agent.default.stt_node(self, _tap_and_forward(), model_settings):
            if ev.type == stt.SpeechEventType.START_OF_SPEECH:
                # Record all speech during Alexa mode for voice cloning
                if self.orchestrator.current_mode_is_alexa and not self.cloner.clone_creation_attempted:
                    speech_started = True
                    speech_id = datetime.now().strftime("%H%M%S")
                    current_frames = []
                    print(f"🎙️ Recording speech {speech_id} for voice cloning…")
            elif ev.type == stt.SpeechEventType.END_OF_SPEECH:
                if speech_started and current_frames and self.orchestrator.current_mode_is_alexa and not self.cloner.clone_creation_attempted:
                    await self.cloner.save_frames(current_frames, speech_id)
                speech_started = False
                current_frames = []
                speech_id = None
            yield ev


# ---------------------------
# Orchestrator / Entrypoint
# ---------------------------
class Orchestrator:
    def __init__(self, ctx: JobContext, cfg: Config):
        self.ctx = ctx
        self.cfg = cfg
        self.session: Optional[AgentSession] = None
        self.avatar: Optional[hedra.AvatarSession] = None
        self.cloner: Optional[VoiceCloner] = None
        self.current_mode_is_alexa = True  # start in Alexa mode
        self.camera_started = False  # track camera state
        self._cleanup_registered = False  # track if cleanup is registered
        self.voice_cloning_enabled = False  # store voice cloning preference
        self.agent: Optional[Assistant] = None
        self.room_service: Optional[api.RoomService] = None

    # ---- Session setup ----
    async def start(self) -> None:
        print("🚀 Starting orchestrator…")
        llm = openai.LLM(model=self.cfg.llm_model, temperature=0.7)
        lkapi = api.LiveKitAPI()
        room_service = lkapi.room
        self.room_service = room_service
        # Build session
        self.session = AgentSession(
            stt=deepgram.STT(model=self.cfg.deepgram_model, language="multi"),
            llm=llm,
            tts=elevenlabs.TTS(voice_id=self.cfg.alexa_voice_id, model=self.cfg.eleven_tts_model),
            vad=silero.VAD.load(),
            turn_detection="stt",
        )

        # Voice cloner bound to the room
        self.cloner = VoiceCloner(self.cfg, self.ctx.room, self)

        # Agent
        self.agent = Assistant(cfg=self.cfg, is_alexa=True, room=self.ctx.room, cloner=self.cloner, orchestrator=self)

        await self.session.start(
            room=self.ctx.room,
            agent=self.agent,
            room_output_options=RoomOutputOptions(audio_enabled=True),
            room_input_options=RoomInputOptions(noise_cancellation=noise_cancellation.BVC()),
        )

        # Event hooks
        self._wire_events()

        # No need for delayed setup - voice cloning preference is checked when needed

        # Greet if participant is already here
        if self.ctx.room.remote_participants:
            asyncio.create_task(self._alexa_greeting())

        # Start polling avatar-state (if requests available)
        asyncio.create_task(self._poll_avatar_state())
        
        # Register cleanup handler
        self._register_cleanup()
    
    def _get_voice_cloning_preference(self) -> bool:
        """Get voice cloning preference from stored RPC value."""
        print(f"🎤 Voice cloning preference: {self.voice_cloning_enabled}")
        return self.voice_cloning_enabled
    
    def _register_cleanup(self) -> None:
        """Register cleanup handler for when agent shuts down"""
        if self._cleanup_registered:
            return
        
        import signal
        import atexit
        
        def cleanup_handler():
            print("🧹 Agent shutting down, cleaning up voices...")
            if self.cloner:
                # Run cleanup synchronously since we're in shutdown
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        # Create a task if loop is running
                        asyncio.create_task(self.cloner.cleanup_voices())
                    else:
                        # Run directly if loop is not running
                        loop.run_until_complete(self.cloner.cleanup_voices())
                except Exception as e:
                    print(f"⚠️ Cleanup error: {e}")
        
        # Register for both normal exit and signal termination
        atexit.register(cleanup_handler)
        signal.signal(signal.SIGTERM, lambda s, f: cleanup_handler())
        signal.signal(signal.SIGINT, lambda s, f: cleanup_handler())
        
        self._cleanup_registered = True
        print("🧹 Voice cleanup handler registered")

    # ---- Event wiring ----
    def _wire_events(self) -> None:
        s = self.session
        assert s is not None

        @s.on("agent_speech_committed")
        def _on_agent(msg):
            print(f"🗣️ AGENT: {getattr(msg, 'message', '')}")

        @s.on("user_speech_committed")
        def _on_user(msg):
            print(f"🗣️ USER: {getattr(msg, 'message', '')}")

        @s.on("user_started_speaking")
        def _on_user_start():
            print("🎤 USER started speaking")

        @s.on("user_stopped_speaking")
        def _on_user_stop():
            print("🎤 USER stopped speaking")

        @self.ctx.room.on("participant_connected")
        def _on_participant(p: rtc.RemoteParticipant):
            print(f"🔗 participant_connected: {p.identity}")
            if self.current_mode_is_alexa:
                asyncio.create_task(self._alexa_greeting())

        @self.ctx.room.on("participant_disconnected")
        def _on_participant_disconnected(p: rtc.RemoteParticipant):
            print(f"🔗 participant_disconnected: {p.identity}")
            if (p.identity.startswith("hedra-avatar") == False):
                print("User disconnected, cleaning up voices...")
                if (self.cloner):
                    asyncio.create_task(self.cloner.cleanup_voices())
            
        
        @self.ctx.room.on("data_received")
        def _on_data(pkt: rtc.DataPacket):
            try:
                if pkt.topic == "voice_cloning_preference":
                    message = json.loads(pkt.data.decode("utf-8"))
                    self.voice_cloning_enabled = message.get("voiceCloningEnabled", False)
                    print(f"🎤 Received voice cloning preference via room data: {self.voice_cloning_enabled}")
            

                elif pkt.topic == "agent_message":
                    print(f"🎤 Received agent message via room data: {pkt.data.decode('utf-8')}")
                    message = json.loads(pkt.data.decode("utf-8"))
                    agent_message = message.get("message")
                    if agent_message and self.session:
                        print(f"🗣️ Agent speaking immediate message: {agent_message}")
                        asyncio.create_task(self._speak_agent_message(agent_message))
                elif pkt.topic == "filter_selection":
                    message = json.loads(pkt.data.decode("utf-8"))
                    filter_id = message.get("filterID")
                    print(f"🎨 Received filter selection via room data: {filter_id}")
                    asyncio.create_task(self._apply_filter(filter_id))
                    
                elif pkt.topic == "personality_selection":
                    message = json.loads(pkt.data.decode("utf-8"))
                    personality_name = message.get("personalityName")
                    
                    if personality_name and self.agent:
                        print(f"🎭 Calling update_personality for: {personality_name}")
                        asyncio.create_task(self.agent.update_personality(personality_name))
                elif pkt.topic == "mode_switch":
                    message = json.loads(pkt.data.decode("utf-8"))
                    if message.get("action") == "switch_mode":
                        # Store avatar ID from the message if provided and wait for it
                        avatar_id = message.get("avatarId")
                        if avatar_id:
                            print(f"🎭 Received avatar ID via room data: {avatar_id}")
                            # Store immediately and wait for completion before mode switch
                            asyncio.create_task(self._store_and_switch_mode(avatar_id, message.get("mode", "alexa")))
                        else:
                            asyncio.create_task(self._switch_mode(message.get("mode", "alexa")))
                elif pkt.topic == "avatar_data":
                    message = json.loads(pkt.data.decode("utf-8"))
                    avatar_id = message.get("assetId")
                    if avatar_id:
                        print(f"🎭 Received avatar ID via avatar_data: {avatar_id}")
                        # Store immediately without waiting for mode switch
                        asyncio.create_task(self._store_avatar_id_in_room(avatar_id))
                elif pkt.topic == "user_state_change":
                    message = json.loads(pkt.data.decode("utf-8"))
                    action = message.get("action")
                    timestamp = message.get("timestamp")
                    print(f"📱 User state change: {action} at {timestamp}")
                    
                    if action == "camera_started":
                        print("📷 Backend received: User started camera via button")
                        # Track camera state
                        self.camera_started = True
                        # Agent now knows user has progressed to camera state
                        asyncio.create_task(self._handle_camera_started())
            except Exception as e:
                print(f"❌ data_received error: {e}")

    # ---- Helper methods ----
    async def _speak_agent_message(self, message: str) -> None:
        """Speak an agent message properly handling the SpeechHandle."""
        try:
            speech_handle = self.session.say(message)
            await speech_handle.wait_for_completion()
        except Exception as e:
            print(f"⚠️ Failed to speak agent message: {e}")

    async def _apply_filter(self, filter_id: str) -> None:
        """Apply a filter effect by replacing the avatar with a placeholder"""
        try:
            response = await self.ctx.api.room.list_participants(
                api.ListParticipantsRequest(room=self.ctx.room.name)
            )
            participants = response.participants
            for participant in participants:
                print(f"🔍 Participant: {participant}")
                if (participant.identity.startswith("hedra-avatar")):
                    print(f"🔍 Found Hedra avatar: {participant.identity}")
                    await self.room_service.remove_participant(
                        api.RoomParticipantIdentity(
                            room=self.ctx.room.name,
                            identity=participant.identity
                        )
                    )
                    # self.ctx.room.remove_participant(participant.identity)

            # Create new avatar session with filter (Hedra handles session replacement automatically)

            self.avatar = hedra.AvatarSession(
                avatar_id=filter_id,
                avatar_participant_identity="hedra-avatar"+filter_id,
            )
            await self.avatar.start(self.session, room=self.ctx.room)
            
            # Debug: Print TTS info after successful avatar start
            print(f"🔍 TTS Debug - session._tts: {self.session._tts}")
            
            print(f"🔍 About to call session.say() with message: 'I've applied the {filter_id} filter!'")
            speech_handle = self.session.say(f"I've applied the filter!")
            print(f"🔍 session.say() returned speech_handle: {speech_handle}")
            
            print(f"🔍 About to await speech_handle...")
            await speech_handle
            print(f"🔍 speech_handle await completed successfully")
            
            print(f"🎨 Filter avatar session started with ID: {filter_id}")
        except Exception as e:
            print(f"⚠️ Failed to apply filter {filter_id}: {e}")
            # Try to recover by restarting the original avatar session if needed

    async def _store_avatar_id_in_room(self, avatar_id: str) -> None:
        """Store avatar ID in local participant metadata for immediate access"""
        try:
            current_metadata = {}
            if self.ctx.room.local_participant.metadata:
                current_metadata = json.loads(self.ctx.room.local_participant.metadata)
            
            current_metadata["avatar_id"] = avatar_id
            await self.ctx.room.local_participant.set_metadata(json.dumps(current_metadata))
            print(f"🔖 Stored avatar_id in local participant metadata: {avatar_id}")
        except Exception as e:
            print(f"⚠️ Failed to store avatar_id in local participant metadata: {e}")

    async def _store_and_switch_mode(self, avatar_id: str, mode: str) -> None:
        """Store avatar ID first, then switch mode to ensure proper timing"""
        try:
            # Store avatar ID first and wait for completion
            await self._store_avatar_id_in_room(avatar_id)
            print(f"✅ Avatar ID stored, now switching to {mode} mode")
            # Longer delay to ensure metadata is fully persisted
            await asyncio.sleep(0.5)
            # Then switch mode
            await self._switch_mode(mode)
        except Exception as e:
            print(f"❌ store_and_switch_mode error: {e}")

    async def _handle_camera_started(self) -> None:
        """Handle when user starts camera via button click"""
        try:
            if self.current_mode_is_alexa:
                # Just log the state change, don't generate a response
                # The agent will respond appropriately when user speaks next
                print("📷 Camera started via button - state tracked, ready for voice commands")
        except Exception as e:
            print(f"❌ _handle_camera_started error: {e}")

    async def _monitor_avatar_creation(self) -> None:
        """Monitor for avatar creation completion and trigger mode switch"""
        try:
            print("🔍 Monitoring for avatar creation completion...")
            max_attempts = 30  # 30 seconds max wait
            attempt = 0
            
            while attempt < max_attempts:
                await asyncio.sleep(1)
                attempt += 1
                
                # Check if avatar ID is available from polling state
                avatar_id = self._get_avatar_id_from_polling_state()
                if avatar_id:
                    print(f"✅ Avatar creation detected! Avatar ID: {avatar_id}")
                    # Always trigger mode switch to ensure voice cloning happens
                    await self._switch_mode("avatar")
                    return
                
                # Also check room metadata
                avatar_id = self._get_avatar_id_from_room()
                if avatar_id:
                    print(f"✅ Avatar creation detected in room metadata! Avatar ID: {avatar_id}")
                    await self._switch_mode("avatar")
                    return
            
            print("⚠️ Avatar creation monitoring timed out after 30 seconds")
        except Exception as e:
            print(f"❌ _monitor_avatar_creation error: {e}")

    # ---- Greetings ----
    async def _alexa_greeting(self) -> None:
        try:
            await asyncio.sleep(1)
            await self.session.say(Msg.ALEXA_GREETING)
        except Exception as e:
            print(f"⚠️ greeting failed: {e}")

    # ---- Mode switching ----
    async def _create_and_apply_voice_clone(self) -> str:
        """Create voice clone and apply it to the current session."""
        print("🎤 Creating final voice clone from accumulated audio...")
        final_voice_id = await self.cloner.create_final_voice_clone()
        
        print(f"🎤 Using voice for avatar: {final_voice_id}")
        if final_voice_id != self.cfg.avatar_voice_id:
            print(f"✅ Successfully using custom voice clone: {final_voice_id}")
        else:
            print(f"🎤 Using default avatar voice: {final_voice_id}")
        
        # Apply the voice to current session
        self.session._tts = elevenlabs.TTS(
            voice_id=final_voice_id, model=self.cfg.eleven_tts_model
        )
        
        return final_voice_id

    async def _switch_mode(self, new_mode: str) -> None:
        try:
            if new_mode == "avatar":
                was_already_avatar_mode = not self.current_mode_is_alexa
                
                if was_already_avatar_mode:
                    print("🎭 Avatar mode already active, but creating voice clone...")
                    # Still create voice clone even if already in avatar mode
                    await self._create_and_apply_voice_clone()
                    # Don't return early - we still need to create avatar session if it doesn't exist
                    
                print("🎭 Switching → Avatar mode")
                self.current_mode_is_alexa = False
                
                # Create voice clone from all accumulated audio
                await self._create_and_apply_voice_clone()

                if not self.avatar:
                    # Try to get avatar ID from multiple sources with detailed logging
                    polling_id = self._get_avatar_id_from_polling_state()
                    room_id = self._get_avatar_id_from_room()
                    
                    print(f"🔍 Avatar ID sources - Polling: {polling_id}, Room: {room_id}, Default: {self.cfg.default_avatar_id}")
                    
                    avatar_id = polling_id or room_id or self.cfg.default_avatar_id
                    print(f"🎭 Creating avatar session with ID: {avatar_id}")
                    
                    if avatar_id != self.cfg.default_avatar_id:
                        print(f"✅ Using custom avatar ID: {avatar_id}")
                    else:
                        print(f"⚠️ Falling back to default avatar ID: {avatar_id}")
                    
                    self.avatar = hedra.AvatarSession(
                        avatar_id=avatar_id,
                        avatar_participant_identity="hedra-avatar",
                    )
                    await self.avatar.start(self.session, room=self.ctx.room)
                    print(f"🎭 Avatar session started successfully")
                
                # Generate greeting and ensure transcriptions continue to flow
                if not was_already_avatar_mode:
                    # Use session.say() to ensure transcriptions are captured
                    greeting_text = "Hello! I'm your personalized avatar, created from your photo. Thank you for creating me. How can I help you today?"
                    await self.session.say(greeting_text)
                    print(f"🎤 Avatar greeting sent via session.say() for transcription capture")
            else:
                print("🔊 Switching → Alexa mode")
                self.current_mode_is_alexa = True
                self.session._tts = elevenlabs.TTS(
                    voice_id=self.cfg.alexa_voice_id, model=self.cfg.eleven_tts_model
                )
                await self.session.generate_reply(
                    instructions="Greet the user as Alexa and ask how you can help today."
                )
        except Exception as e:
            print(f"❌ switch_mode error: {e}")

    def _get_avatar_id_from_polling_state(self) -> Optional[str]:
        """Get avatar ID from the polling state (set by frontend via /api/set-avatar-id)"""
        try:
            if REQUESTS_AVAILABLE:
                print(f"🔍 Polling avatar state from: {self.cfg.poll_api_url}")
                resp = requests.get(self.cfg.poll_api_url, timeout=2)
                print(f"🔍 Polling response status: {resp.status_code}")
                if resp.status_code == 200:
                    state = resp.json() or {}
                    print(f"🔍 Polling state data: {state}")
                    avatar_id = state.get("assetId")
                    if avatar_id:
                        print(f"🎭 Found avatar ID from polling state: {avatar_id}")
                        return avatar_id
                    else:
                        print("🔍 No assetId found in polling state")
                else:
                    print(f"🔍 Polling failed with status: {resp.status_code}")
            else:
                print("🔍 Requests not available for polling")
        except Exception as e:
            print(f"⚠️ Failed to get avatar ID from polling state: {e}")
        return None

    def _get_avatar_id_from_room(self) -> Optional[str]:
        """Get avatar ID from local participant metadata where we stored it"""
        try:
            md = self.ctx.room.local_participant.metadata
            print(f"🔍 Local participant metadata: {md}")
            if not md:
                print("🔍 No local participant metadata found")
                return None
            data = json.loads(md)
            print(f"🔍 Parsed metadata: {data}")
            avatar_id = data.get("avatar_id")
            if avatar_id:
                print(f"🎭 Found avatar ID from local participant metadata: {avatar_id}")
                return avatar_id
            else:
                print("🔍 No avatar_id found in local participant metadata")
        except Exception as e:
            print(f"⚠️ avatar_id from local participant metadata failed: {e}")
        return None

    # ---- Poll local API for voice switch / avatar events ----
    async def _poll_avatar_state(self) -> None:
        last_state: Optional[dict] = None
        while True:
            try:
                resp = requests.get(self.cfg.poll_api_url, timeout=2)
                if resp.status_code == 200:
                    state = resp.json() or {}
                    if state != last_state:
                        last_state = state
                        if state.get("switchVoice"):
                            # Always trigger voice cloning when switchVoice is detected
                            print(f"🎭 Detected switchVoice signal, creating voice clone...")
                            if self.current_mode_is_alexa:
                                # Switch from Alexa to Avatar mode with voice cloning
                                self.current_mode_is_alexa = False
                                await self._create_and_apply_voice_clone()
                                # Use session.say() to ensure transcriptions are captured
                                greeting_text = "Hello! I'm your personalized avatar, created from your photo. Thank you for creating me. How can I help you today?"
                                await self.session.say(greeting_text)
                                print(f"🎤 Avatar greeting sent via session.say() for transcription capture")
                            else:
                                # Already in avatar mode, just update voice
                                await self._create_and_apply_voice_clone()
                # else: non-200 → ignore
            except Exception:
                pass  # API may not be up; ignore quietly
            await asyncio.sleep(self.cfg.poll_interval_secs)

    def _get_custom_voice_id_from_local(self) -> Optional[str]:
        """Get custom voice ID from local participant metadata or cloner's final voice ID."""
        try:
            # First check if cloner has a final voice ID (most up-to-date)
            if self.cloner and self.cloner.final_voice_id:
                return self.cloner.final_voice_id
            
            # Fallback to metadata
            md = self.ctx.room.local_participant.metadata
            if not md:
                return None
            data = json.loads(md)
            return data.get("customVoiceId")
        except Exception:
            return None


# ---------------------------
# Public API helpers (optional)
# ---------------------------
async def show_photo_capture_ui(ctx: JobContext) -> str:
    try:
        await ctx.room.local_participant.publish_data(
            payload=b'{"action": "show_photo_capture"}',
            topic="frontend_control",
        )
        return "Photo capture interface is ready. Say 'start camera' when you're set."
    except Exception as e:
        return f"Failed to show photo UI: {e}"


# ---------------------------
# Entrypoint
# ---------------------------
async def entrypoint(ctx: JobContext):
    
    orch = Orchestrator(ctx, Config())
    await orch.start()
    # async def async_shutdown_callback(participant: rtc.Participant):
    #     print("Shutting down...")
        # if orch.cloner:
        #     await orch.cloner.cleanup_voices()
    
    # def shutdown_callback(participant: rtc.Participant):
    #     asyncio.create_task(async_shutdown_callback(participant))
    
    # ctx.room.on("participant_disconnected", shutdown_callback)
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
