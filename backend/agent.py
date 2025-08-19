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
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterable, List, Optional, Tuple

from dotenv import load_dotenv

from livekit import agents, rtc
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
    target_consolidation_secs: float = float(os.getenv("VOICE_CONSOLIDATION_SECS", 10))
    instant_clone_min_secs: float = float(os.getenv("INSTANT_CLONE_MIN_SECS", 3))

    # Local dev API for avatar state polling
    poll_api_url: str = os.getenv("AVATAR_STATE_URL", "http://localhost:3000/api/avatar-state")
    poll_interval_secs: float = float(os.getenv("POLL_INTERVAL_SECS", 3))


# ---------------------------
# Shared strings
# ---------------------------
class Msg:
    ALEXA_GREETING = (
        "Hello! I'm Alexa, and I'm here to help you create your personalized avatar. "
        "We're about to make a digital copy of you! Tell me a bit about yourself, and when you're ready, say 'start camera'."
    )

    ALEXA_INSTRUCTIONS = (
        "You are Alexa, Amazon's voice assistant. Help the user create a personalized avatar by guiding them through photo capture.\n"
        "- Guide the user through taking a photo (start camera → take photo)\n"
        "- Be encouraging and natural\n"
        "Start by greeting them and explaining the process. Ask them to say 'start camera' when ready."
    )

    AVATAR_INSTRUCTIONS = (
        "You are the user's newly created personalized avatar. You were just brought to life from their photo.\n"
        "- Greet warmly as their avatar, using their name if you know it. \n- Express excitement\n- Ask how you can help\n- Be friendly and engaging"
    )


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
    def __init__(self, cfg: Config, room: rtc.Room):
        self.cfg = cfg
        self.room = room

        self.voice_accumulator: List[AudioSegment] = []
        self.accumulated_secs: float = 0.0
        self.clone_count: int = 0

        self.client = None
        if ELEVENLABS_AVAILABLE:
            api_key = os.getenv("ELEVEN_API_KEY")
            if api_key:
                try:
                    self.client = ElevenLabs(api_key=api_key)
                    print("🎤 ElevenLabs client initialized")
                except Exception as e:  # pragma: no cover
                    print(f"⚠️ ElevenLabs init failed: {e}")
            else:
                print("⚠️ ELEVEN_API_KEY not set. Voice cloning disabled.")
        else:
            print("⚠️ elevenlabs package not available. Voice cloning disabled.")

    async def save_frames(self, frames: List[rtc.AudioFrame], speech_id: Optional[str]) -> Optional[str]:
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

        # accumulate towards cloning
        self.voice_accumulator.append(seg)
        self.accumulated_secs += secs
        print(
            f"🎛️ Accumulated {self.accumulated_secs:.1f}/{self.cfg.target_consolidation_secs:.0f}s"
        )

        # Try full clone when ready
        if (
            self.client
            and self.accumulated_secs >= self.cfg.target_consolidation_secs
        ):
            vid = await self._create_clone(trim_to_target=True, label_prefix="User Voice Clone")
            if vid:
                # store in participant metadata for later use by frontend/switcher
                try:
                    await self.room.local_participant.set_metadata(json.dumps({"customVoiceId": vid}))
                    print(f"🔖 Stored customVoiceId in room metadata: {vid}")
                except Exception as e:
                    print(f"⚠️ set_metadata failed: {e}")
            return path

        return path

    async def instant_clone_if_ready(self) -> Optional[str]:
        if not (self.client and self.voice_accumulator):
            return None
        if self.accumulated_secs < self.cfg.instant_clone_min_secs:
            return None
        return await self._create_clone(trim_to_target=False, label_prefix="Instant User Clone")

    async def _create_clone(self, *, trim_to_target: bool, label_prefix: str) -> Optional[str]:
        # Combine in-memory segments
        try:
            combined = AudioSegment.empty()
            for s in self.voice_accumulator:
                combined += s
            if trim_to_target and len(combined) > int(self.cfg.target_consolidation_secs * 1000):
                combined = combined[: int(self.cfg.target_consolidation_secs * 1000)]

            from io import BytesIO

            buf = BytesIO()
            combined.export(buf, format="mp3", bitrate="192k")
            buf.seek(0)

            self.clone_count += 1
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            name = f"{label_prefix} {self.clone_count:03d} ({ts})"
            print(f"🚀 ElevenLabs cloning: {name}")

            voice = self.client.voices.ivc.create(name=name, files=[buf])
            vid = voice.voice_id
            print(f"🎉 Clone ready: {vid} ({len(combined)/1000:.1f}s)")

            if trim_to_target:
                # Reset once full clone completed, keep buffer otherwise
                self.voice_accumulator.clear()
                self.accumulated_secs = 0.0
            return vid
        except Exception as e:
            em = str(e)
            if "missing_permissions" in em and "voices_write" in em:
                print("❌ ElevenLabs permission error: requires voices_write (Starter+ plan)")
            elif "401" in em:
                print("❌ ElevenLabs auth error: invalid/expired ELEVEN_API_KEY")
            elif "voice_limit_reached" in em:
                print("❌ ElevenLabs voice limit reached (30/30). Using default avatar voice instead.")
                # Continue with default voice instead of failing
                return self.cfg.avatar_voice_id
            else:
                print(f"❌ ElevenLabs clone error: {em}")
            return None


# ---------------------------
# Agent with function tools & custom STT node
# ---------------------------
class Assistant(Agent):
    def __init__(self, cfg: Config, is_alexa: bool, room: rtc.Room, cloner: Optional[VoiceCloner]):
        self.cfg = cfg
        self.is_alexa = is_alexa
        self.room = room
        self.cloner = cloner
        super().__init__(instructions=Msg.ALEXA_INSTRUCTIONS if is_alexa else Msg.AVATAR_INSTRUCTIONS)

    # ---- Function Tools ----
    @function_tool()
    async def start_camera(self, context: RunContext) -> str:
        """Activate the user's camera for photo capture (triggered by 'start camera')."""
        try:
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return "I don't see you connected yet. Once you're in the room, say 'start camera' again."
            await _rpc_frontend(self.room, pid, method="startCamera")
            return "Great! Say 'take photo' whenever you're ready to capture."
        except Exception as e:
            return f"I couldn't start the camera: {e}"

    @function_tool()
    async def take_photo(self, context: RunContext) -> str:
        """Capture a photo for the user's avatar (triggered by 'take photo')."""
        try:
            pid = await _get_first_remote_participant(self.room)
            if not pid:
                return "You're not connected yet. Join the room and try 'take photo' again."
            await _rpc_frontend(self.room, pid, method="capturePhoto")
            return (
                "Perfect! I've captured your photo. I'll start creating your avatar now."
            )
        except Exception as e:
            return f"I couldn't take the photo: {e}"

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
                speech_started = True
                speech_id = datetime.now().strftime("%H%M%S")
                current_frames = []
                print(f"🎙️ Recording speech {speech_id}…")
            elif ev.type == stt.SpeechEventType.END_OF_SPEECH:
                if speech_started and current_frames:
                    await self.cloner.save_frames(current_frames, speech_id)
                    # Optionally attempt instant clone early
                    await self.cloner.instant_clone_if_ready()
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

    # ---- Session setup ----
    async def start(self) -> None:
        print("🚀 Starting orchestrator…")
        llm = openai.LLM(model=self.cfg.llm_model, temperature=0.7)

        # Build session
        self.session = AgentSession(
            stt=deepgram.STT(model=self.cfg.deepgram_model, language="multi"),
            llm=llm,
            tts=elevenlabs.TTS(voice_id=self.cfg.alexa_voice_id, model=self.cfg.eleven_tts_model),
            vad=silero.VAD.load(),
            turn_detection="stt",
        )

        # Voice cloner bound to the room
        self.cloner = VoiceCloner(self.cfg, self.ctx.room)

        # Agent
        agent = Assistant(cfg=self.cfg, is_alexa=True, room=self.ctx.room, cloner=self.cloner)

        await self.session.start(
            room=self.ctx.room,
            agent=agent,
            room_output_options=RoomOutputOptions(audio_enabled=True),
            room_input_options=RoomInputOptions(noise_cancellation=noise_cancellation.BVC()),
        )

        # Event hooks
        self._wire_events()

        # Greet if participant is already here
        if self.ctx.room.remote_participants:
            asyncio.create_task(self._alexa_greeting())

        # Start polling avatar-state (if requests available)
        if REQUESTS_AVAILABLE:
            asyncio.create_task(self._poll_avatar_state())
        else:
            print("ℹ️ 'requests' not available, skipping avatar-state polling")

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

        @self.ctx.room.on("data_received")
        def _on_data(pkt: rtc.DataPacket):
            try:
                if pkt.topic != "mode_switch":
                    return
                message = json.loads(pkt.data.decode("utf-8"))
                if message.get("action") == "switch_mode":
                    asyncio.create_task(self._switch_mode(message.get("mode", "alexa")))
            except Exception as e:
                print(f"❌ data_received error: {e}")

    # ---- Greetings ----
    async def _alexa_greeting(self) -> None:
        try:
            await asyncio.sleep(1)
            await self.session.say(Msg.ALEXA_GREETING)
        except Exception as e:
            print(f"⚠️ greeting failed: {e}")

    # ---- Mode switching ----
    async def _switch_mode(self, new_mode: str) -> None:
        try:
            if new_mode == "avatar":
                print("🎭 Switching → Avatar mode")
                self.current_mode_is_alexa = False
                self.session._tts = elevenlabs.TTS(
                    voice_id=self.cfg.avatar_voice_id, model=self.cfg.eleven_tts_model
                )

                if not self.avatar:
                    # Try to get avatar ID from polling state first, then room metadata, then default
                    avatar_id = self._get_avatar_id_from_polling_state() or self._get_avatar_id_from_room() or self.cfg.default_avatar_id
                    print(f"🎭 Creating avatar session with ID: {avatar_id}")
                    self.avatar = hedra.AvatarSession(avatar_id=avatar_id)
                    await self.avatar.start(self.session, room=self.ctx.room)
                    print(f"🎭 Avatar session started successfully")
                await self.session.generate_reply(
                    instructions=(
                        "Announce that you are the user's personalized avatar, created from their photo. "
                        "Thank them and ask how you can help today."
                    )
                )
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
                resp = requests.get(self.cfg.poll_api_url, timeout=2)
                if resp.status_code == 200:
                    state = resp.json() or {}
                    avatar_id = state.get("assetId")
                    if avatar_id:
                        print(f"🎭 Found avatar ID from polling state: {avatar_id}")
                        return avatar_id
        except Exception as e:
            print(f"⚠️ Failed to get avatar ID from polling state: {e}")
        return None

    def _get_avatar_id_from_room(self) -> Optional[str]:
        try:
            md = self.ctx.room.metadata
            if not md:
                return None
            data = json.loads(md)
            return data.get("avatar_id")
        except Exception as e:
            print(f"⚠️ avatar_id from room metadata failed: {e}")
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
                            # Prefer custom voice id from local participant metadata
                            voice_id = self._get_custom_voice_id_from_local() or self.cfg.avatar_voice_id
                            print(f"🎭 Switching TTS to voice_id={voice_id}")
                            self.session._tts = elevenlabs.TTS(
                                voice_id=voice_id, model=self.cfg.eleven_tts_model
                            )
                            await self.session.generate_reply(
                                instructions=(
                                    "Announce that you are now the user's personalized avatar, created from their photo. "
                                    "Thank them and ask how you can help today."
                                )
                            )
                # else: non-200 → ignore
            except Exception:
                pass  # API may not be up; ignore quietly
            await asyncio.sleep(self.cfg.poll_interval_secs)

    def _get_custom_voice_id_from_local(self) -> Optional[str]:
        try:
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
    # Keep alive forever
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
