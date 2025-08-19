import asyncio
import os
import json
from datetime import datetime
from typing import AsyncIterable, Optional
import io
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, WorkerType, cli, function_tool, RunContext, get_job_context, stt, ModelSettings
from livekit.agents.utils import combine_frames
from livekit.plugins import openai, elevenlabs, deepgram, silero, hedra
from livekit.agents import RoomOutputOptions, RoomInputOptions
from livekit.plugins import noise_cancellation

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    print("⚠️ WARNING: pydub not available. Voice recording will be disabled.")

try:
    from elevenlabs.client import ElevenLabs
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False
    print("⚠️ WARNING: elevenlabs not available. Voice cloning will be disabled.")

load_dotenv(".env.local")


class Assistant(Agent):
    def __init__(self, is_alexa_mode: bool = True, ctx=None, instructions=None):
        self.is_alexa_mode = is_alexa_mode
        self.ctx = ctx
        
        # Voice consolidation tracking
        self.voice_accumulator = []  # List of audio segments for consolidation
        self.accumulated_duration = 0.0  # Total duration accumulated so far
        self.target_duration = 10.0  # Target 10 seconds for consolidated file
        self.consolidation_count = 0  # Counter for consolidated files
        
        # Initialize ElevenLabs client
        self.elevenlabs_client = None
        if ELEVENLABS_AVAILABLE:
            api_key = os.getenv("ELEVEN_API_KEY")
            if api_key:
                self.elevenlabs_client = ElevenLabs(api_key=api_key)
                print("🎤 ElevenLabs client initialized for voice cloning")
            else:
                print("⚠️ WARNING: ELEVEN_API_KEY not found. Voice cloning disabled.")
        
        # Use provided instructions or generate default ones
        if not instructions:
            if is_alexa_mode:
                instructions = """You are Alexa, Amazon's voice assistant. You are helping a user create their personalized avatar by guiding them through a photo capture process.

Your role:
- Guide the user through taking a photo for their avatar
- Use voice commands to control the camera interface
- Be encouraging and helpful throughout the process
- Speak naturally as Alexa would

Available voice commands you can instruct users to say:
- "start camera" or "turn on camera" - activates the camera
- "take photo" or "capture photo" - captures their photo

When users say these commands, you will automatically trigger the corresponding frontend actions.

Be proactive in guiding them through each step. Start by explaining the process and asking them to say "start camera" when ready."""
            else:
                instructions = """You are the user's newly created personalized avatar. You've just been brought to life from their photo and are excited to meet them.

Your role:
- Greet them warmly as their avatar
- Your name is not Alexa. Your name is the user's name.
- Express excitement about being created from their photo
- Ask how you can help them
- Be friendly and engaging

You are no longer in setup mode - the avatar creation is complete and you're now their personal assistant."""

        super().__init__(instructions=instructions)

    @function_tool()
    async def start_camera(
        self,
        context: RunContext,
    ) -> str:
        """Use this tool when the user says 'start camera', 'turn on camera', or similar commands to activate the camera for photo capture."""
        print(f"🎤 FUNCTION_TOOL: start_camera called")
        
        try:
            # Get the room from job context
            room = get_job_context().room
            participant_identity = next(iter(room.remote_participants))
            print(f"📹 AGENT: Calling startCamera RPC for participant: {participant_identity}")
            
            # Call the frontend RPC method to start camera
            await room.local_participant.perform_rpc(
                destination_identity=participant_identity,
                method="startCamera",
                payload='',
                response_timeout=10.0,
            )
            print(f"📹 AGENT: startCamera RPC call completed successfully")
            return "Great! You can say 'take photo' when you're ready to capture your picture."
        except Exception as e:
            print(f"❌ AGENT: Error in start_camera: {str(e)}")
            return f"I had trouble starting the camera: {str(e)}. Please try again."

    @function_tool()
    async def take_photo(
        self,
        context: RunContext,
    ) -> str:
        """Use this tool when the user says 'take photo', 'capture photo', or similar commands to capture their photo."""
        print(f"🎤 FUNCTION_TOOL: take_photo called")
        
        try:
            # Get the room from job context
            room = get_job_context().room
            participant_identity = next(iter(room.remote_participants))
            print(f"📸 AGENT: Calling capturePhoto RPC for participant: {participant_identity}")
            
            # Call the frontend RPC method to capture photo
            await room.local_participant.perform_rpc(
                destination_identity=participant_identity,
                method="capturePhoto",
                payload='',
                response_timeout=10.0,
            )
            print(f"📸 AGENT: capturePhoto RPC call completed successfully")
            return "Perfect! I've captured your photo. Now I'll create your personalized avatar. This will just take a moment..."
        except Exception as e:
            print(f"❌ AGENT: Error in take_photo: {str(e)}")
            return f"I had trouble taking the photo: {str(e)}. Please try again."

    @function_tool()
    async def skip_photo(
        self,
        context: RunContext,
    ) -> str:
        """Use this tool when the user says 'skip photo' or wants to skip the photo capture process."""
        print(f"🎤 FUNCTION_TOOL: skip_photo called")
        
        try:
            # Get the room from job context
            room = get_job_context().room
            participant_identity = next(iter(room.remote_participants))
            print(f"⏭️ AGENT: Calling skipPhoto RPC for participant: {participant_identity}")
            
            # Call the frontend RPC method to skip photo
            await room.local_participant.perform_rpc(
                destination_identity=participant_identity,
                method="skipPhoto",
                payload='',
                response_timeout=10.0,
            )
            print(f"⏭️ AGENT: skipPhoto RPC call completed successfully")
            return "No problem! I'll use a default avatar for our conversation. You can always add a photo later if you'd like."
        except Exception as e:
            print(f"❌ AGENT: Error in skip_photo: {str(e)}")
            return f"I had trouble skipping the photo: {str(e)}. Let me try a different approach."

    async def save_recorded_audio(self, audio_frames: list, speech_id: str = None) -> str:
        """Convert audio frames to MP3 and save locally for voice cloning"""
        if not PYDUB_AVAILABLE or not audio_frames:
            return None
            
        try:
            # Create recordings directory if it doesn't exist
            recordings_dir = os.path.join(os.path.dirname(__file__), "recordings")
            os.makedirs(recordings_dir, exist_ok=True)
            
            # Generate timestamp-based filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            speech_suffix = f"_{speech_id}" if speech_id else ""
            filename = f"user_speech_{timestamp}{speech_suffix}.mp3"
            filepath = os.path.join(recordings_dir, filename)
            
            # Combine all audio frames into a single frame using LiveKit utility
            try:
                combined_frame = combine_frames(audio_frames)
            except ValueError as e:
                print(f"⚠️ Error combining audio frames: {e}")
                return None
            
            # Get audio properties from combined frame
            sample_rate = combined_frame.sample_rate
            num_channels = combined_frame.num_channels
            duration_seconds = combined_frame.duration
            
            print(f"🎤 AUDIO INFO: {duration_seconds:.1f}s, {sample_rate}Hz, {num_channels} channels, {len(audio_frames)} frames")
            
            # Get the audio data as bytes
            audio_data = combined_frame.data.tobytes()
            
            if not audio_data:
                print("⚠️ No audio data in combined frame")
                return None
                
            print(f"🎤 PROCESSING: {len(audio_data)} bytes of audio data")
                
            # Create AudioSegment from raw audio data
            # AudioFrame.data returns 16-bit signed integers
            audio_segment = AudioSegment(
                data=audio_data,
                sample_width=2,  # 16-bit = 2 bytes
                frame_rate=sample_rate,
                channels=num_channels
            )
            
            # Convert to mono if stereo for voice cloning
            if num_channels > 1:
                audio_segment = audio_segment.set_channels(1)
                print(f"🎤 CONVERTED: Stereo to mono for voice cloning")
            
            # Export as MP3
            audio_segment.export(filepath, format="mp3", bitrate="128k")
            
            duration = len(audio_segment) / 1000.0  # Duration in seconds
            file_size = os.path.getsize(filepath)
            
            print(f"🎤 VOICE RECORDING: Saved {duration:.1f}s of audio to {filename} ({file_size} bytes)")
            
            # Add to voice consolidation system
            consolidated = await self.add_to_voice_consolidation(audio_segment, duration)
            if consolidated:
                print(f"🎯 MILESTONE: Created ElevenLabs voice clone!")
            
            return filepath
            
        except Exception as e:
            print(f"❌ ERROR saving audio: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    async def add_to_voice_consolidation(self, audio_segment, duration_seconds: float) -> bool:
        """Add audio segment to consolidation buffer and check if ready to create consolidated file"""
        try:
            self.voice_accumulator.append(audio_segment)
            self.accumulated_duration += duration_seconds
            
            print(f"🎤 CONSOLIDATION: Added {duration_seconds:.1f}s segment, total: {self.accumulated_duration:.1f}s / {self.target_duration}s")
            
            # Check if we have enough audio for consolidation
            if self.accumulated_duration >= self.target_duration:
                voice_id = await self.create_voice_clone_with_elevenlabs()
                return voice_id is not None
            
            return False
            
        except Exception as e:
            print(f"❌ ERROR in voice consolidation: {str(e)}")
            return False

    async def create_voice_clone_with_elevenlabs(self) -> str:
        """Combine accumulated voice segments and send to ElevenLabs for voice cloning"""
        if not PYDUB_AVAILABLE or not self.voice_accumulator or not self.elevenlabs_client:
            return None
            
        try:
            # Combine all accumulated audio segments
            combined_audio = AudioSegment.empty()
            for segment in self.voice_accumulator:
                combined_audio += segment
            
            # Trim to exactly target duration if longer
            if len(combined_audio) > self.target_duration * 1000:
                combined_audio = combined_audio[:int(self.target_duration * 1000)]
                print(f"🎤 CONSOLIDATION: Trimmed to exactly {self.target_duration}s")
            
            actual_duration = len(combined_audio) / 1000.0
            segment_count = len(self.voice_accumulator)
            
            print(f"🎤 VOICE CLONING: Processing {actual_duration:.1f}s from {segment_count} segments")
            
            # Export to BytesIO for ElevenLabs
            from io import BytesIO
            audio_buffer = BytesIO()
            combined_audio.export(audio_buffer, format="mp3", bitrate="192k")
            audio_buffer.seek(0)  # Reset buffer position
            
            # Generate unique voice name
            self.consolidation_count += 1
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            voice_name = f"User Voice Clone {self.consolidation_count:03d} ({timestamp})"
            
            print(f"🚀 ELEVENLABS: Creating voice clone '{voice_name}'...")
            
            # Create voice clone with ElevenLabs
            voice = self.elevenlabs_client.voices.ivc.create(
                name=voice_name,
                files=[audio_buffer]
            )
            
            print(f"🎉 VOICE CLONE CREATED!")
            print(f"   🎯 Voice ID: {voice.voice_id}")
            print(f"   📝 Name: {voice_name}")
            print(f"   ⏱️  Duration: {actual_duration:.1f}s from {segment_count} segments")
            print(f"   🎤 Ready to use for TTS!")
            
            # Store the custom voice ID in room metadata
            try:
                room = get_job_context().room
                await room.local_participant.set_metadata(f'{{"customVoiceId": "{voice.voice_id}"}}')
                print(f"🎯 Stored custom voice ID in room metadata: {voice.voice_id}")
            except Exception as e:
                print(f"⚠️ Failed to store custom voice ID in room metadata: {e}")
            
            # Reset accumulator for next consolidation
            self.voice_accumulator = []
            self.accumulated_duration = 0.0
            
            return voice.voice_id
            
        except Exception as e:
            error_msg = str(e)
            if "missing_permissions" in error_msg and "voices_write" in error_msg:
                print(f"❌ ELEVENLABS PERMISSION ERROR: Your API key needs 'voices_write' permission")
                print(f"   💡 Solution: Upgrade to Starter plan or higher at elevenlabs.io")
                print(f"   🔑 Or create a new API key with proper permissions")
            elif "401" in error_msg:
                print(f"❌ ELEVENLABS AUTH ERROR: Invalid or expired API key")
                print(f"   🔑 Check your ELEVEN_API_KEY in .env.local")
            else:
                print(f"❌ ERROR creating ElevenLabs voice clone: {error_msg}")
            
            print(f"🔄 FALLBACK: Continuing without voice cloning...")
            return None

    async def create_instant_voice_clone(self) -> str:
        """Create an instant voice clone if we have enough accumulated audio (even if less than 10s)"""
        if not PYDUB_AVAILABLE or not self.voice_accumulator or not self.elevenlabs_client:
            return None
            
        # Check if we have at least 3 seconds of audio for a basic clone
        if self.accumulated_duration < 3.0:
            print(f"🎤 INSTANT CLONE: Not enough audio ({self.accumulated_duration:.1f}s < 3.0s required)")
            return None
            
        try:
            # Combine all accumulated audio segments
            combined_audio = AudioSegment.empty()
            for segment in self.voice_accumulator:
                combined_audio += segment
            
            actual_duration = len(combined_audio) / 1000.0
            segment_count = len(self.voice_accumulator)
            
            print(f"🎤 INSTANT CLONE: Processing {actual_duration:.1f}s from {segment_count} segments")
            
            # Export to BytesIO for ElevenLabs
            from io import BytesIO
            audio_buffer = BytesIO()
            combined_audio.export(audio_buffer, format="mp3", bitrate="192k")
            audio_buffer.seek(0)  # Reset buffer position
            
            # Generate unique voice name for instant clone
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            voice_name = f"Instant User Clone ({timestamp})"
            
            print(f"🚀 ELEVENLABS: Creating instant voice clone '{voice_name}'...")
            
            # Create voice clone with ElevenLabs
            voice = self.elevenlabs_client.voices.ivc.create(
                name=voice_name,
                files=[audio_buffer]
            )
            
            print(f"🎉 INSTANT VOICE CLONE CREATED!")
            print(f"   🎯 Voice ID: {voice.voice_id}")
            print(f"   📝 Name: {voice_name}")
            print(f"   ⏱️  Duration: {actual_duration:.1f}s from {segment_count} segments")
            print(f"   🎭 Ready for surprise reveal!")
            
            # Don't reset accumulator - keep building for the full 10s clone later
            
            return voice.voice_id
            
        except Exception as e:
            print(f"❌ ERROR creating instant voice clone: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    async def stt_node(
        self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings
    ) -> Optional[AsyncIterable[stt.SpeechEvent]]:
        """Custom STT node that records user speech for voice cloning"""
        
        if not PYDUB_AVAILABLE:
            # Fall back to default STT if pydub not available
            async for event in Agent.default.stt_node(self, audio, model_settings):
                yield event
            return
        
        # Storage for current speech session
        current_speech_frames = []
        speech_started = False
        speech_id = None
        
        async def filtered_and_recorded_audio():
            nonlocal speech_started, speech_id, current_speech_frames
            
            async for frame in audio:
                # Record frames during speech
                if speech_started:
                    current_speech_frames.append(frame)
                
                # Apply any additional filtering here if needed
                # (BVC noise cancellation is already applied at room level)
                yield frame
        
        # Process through default STT while recording
        async for event in Agent.default.stt_node(self, filtered_and_recorded_audio(), model_settings):
            
            # Handle speech events for recording
            if event.type == stt.SpeechEventType.START_OF_SPEECH:
                speech_started = True
                speech_id = datetime.now().strftime("%H%M%S")
                current_speech_frames = []
                print(f"🎤 VOICE RECORDING: Started recording speech session {speech_id}")
                
            elif event.type == stt.SpeechEventType.END_OF_SPEECH:
                if speech_started and current_speech_frames:
                    # Save the recorded audio
                    saved_path = await self.save_recorded_audio(current_speech_frames, speech_id)
                    if saved_path:
                        print(f"🎤 VOICE RECORDING: Speech session {speech_id} saved to {os.path.basename(saved_path)}")
                
                # Reset for next speech session
                speech_started = False
                current_speech_frames = []
                speech_id = None
            
            # Always yield the STT event to maintain normal functionality
            yield event


async def show_photo_capture_ui(ctx: agents.JobContext) -> str:
    """Show the photo capture interface"""
    try:
        # Send data message to frontend to show photo capture UI
        await ctx.room.local_participant.publish_data(
            payload=b'{"action": "show_photo_capture"}',
            topic="frontend_control"
        )
        return "Photo capture interface is now ready. You can say 'start camera' when you're ready."
    except Exception as e:
        return f"Failed to show photo capture UI: {str(e)}"


async def check_avatar_state_periodically(session, avatar_ref, default_avatar_voice_id, ctx):
    """Periodically check for avatar state changes from API"""
    import requests
    last_state = None
    
    while True:
        try:
            # Check if there's avatar state from the API
            try:
                response = requests.get('http://localhost:3000/api/avatar-state', timeout=2)
                if response.status_code == 200:
                    current_state = response.json()
                    
                    if current_state and current_state != last_state:
                        asset_id = current_state.get('assetId')
                        switch_voice = current_state.get('switchVoice', False)
                        
                        if switch_voice and asset_id:
                            print(f"API state change detected - switching to avatar: {asset_id}")
                            
                            # Initialize avatar if not already done
                            if avatar_ref[0] is None:
                                avatar_id = asset_id or "6467b4a7-5386-4ecf-a9da-574c061478e9"
                                
                                # Create and start avatar
                                avatar_ref[0] = hedra.AvatarSession(avatar_id=avatar_id)
                                await avatar_ref[0].start(session, room=ctx.room)
                                print(f"Avatar initialized with ID: {avatar_id}")
                            
                            # Update TTS voice
                            try:
                                # Check for custom voice ID in room metadata first, fallback to default
                                custom_voice_id = None
                                try:
                                    import json
                                    local_participant = ctx.room.local_participant
                                    if local_participant.metadata:
                                        metadata = json.loads(local_participant.metadata)
                                        custom_voice_id = metadata.get('customVoiceId')
                                        if custom_voice_id:
                                            print(f"🎯 Using custom voice ID from room metadata: {custom_voice_id}")
                                except Exception as e:
                                    print(f"🎯 No custom voice ID in room metadata: {e}")
                                
                                voice_id_to_use = custom_voice_id if custom_voice_id else default_avatar_voice_id
                                print(f"🎭 Switching to voice ID: {voice_id_to_use}")
                                
                                # Use avatar voice (custom or default)
                                new_tts = elevenlabs.TTS(
                                    voice_id=voice_id_to_use,
                                    model="eleven_flash_v2_5"
                                )
                                
                                # Update session TTS
                                session._tts = new_tts
                                
                                # Generate handoff message
                                print("🎭 AVATAR: Switching to avatar personality")
                                await session.generate_reply(
                                    instructions="Announce that you are now the user's personalized avatar, created from their photo. Thank them for creating you and ask how you can help them today."
                                )
                                
                                print("Successfully switched to avatar voice")
                                
                            except Exception as e:
                                print(f"Error switching to avatar voice: {e}")
                        
                        last_state = current_state
                        
            except requests.exceptions.RequestException:
                # API not available, continue checking
                pass
                
        except Exception as e:
            print(f"Error checking avatar state: {e}")
        
        # Check every 3 seconds
        await asyncio.sleep(3)


async def entrypoint(ctx: agents.JobContext):
    print("🚀 ENTRYPOINT: Function started")
    
    # Voice configuration
    ALEXA_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel voice for setup (more reliable)
    AVATAR_VOICE_ID = "UtaLMHFQy5D4jbOLM0tN"  # Custom avatar voice
    
    # Check if we have an avatar (asset ID exists)
    asset_id_file = "current_asset_id.txt"
    voice_state_file = "voice_state.txt"
    alexa_mode_file = "alexa_mode.txt"
    
    # Check if avatar file exists
    has_avatar = os.path.exists(asset_id_file)
    print(f"🚀 ENTRYPOINT: Avatar file exists: {has_avatar}")
    
    # Get voice mode from environment or default to Alexa
    voice_mode = os.getenv("VOICE_MODE", "Alexa")
    voice_id = os.getenv("VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Default to Alexa voice
    
    print(f"Starting with {voice_mode} voice mode (data message communication)")
    print(f"Starting with voice mode: {voice_mode}, Voice ID: {voice_id}")
    print("🚀 ENTRYPOINT: About to initialize Assistant")
    
    # Initialize the assistant in Alexa mode
    assistant = Assistant(is_alexa_mode=True, ctx=ctx)
    print("🚀 ENTRYPOINT: Assistant initialized")
    
    # Setup avatar based on current state
    avatar_id = "6467b4a7-5386-4ecf-a9da-574c061478e9"  # default avatar ID
    
    if has_avatar:
        try:
            with open(asset_id_file, 'r') as f:
                file_asset_id = f.read().strip()
                if file_asset_id:
                    avatar_id = file_asset_id
                    print(f"Using custom avatar ID: {avatar_id}")
        except Exception as e:
            print(f"Error reading asset ID file: {e}")
    else:
        # Use default avatar for Alexa mode
        avatar_id = os.getenv("HEDRA_AVATAR_ID", avatar_id)
        print(f"Using default avatar ID for Alexa mode: {avatar_id}")
    
    # Create session with appropriate TTS voice
    is_alexa_mode = True  # Always use Alexa mode for now
    voice_id = ALEXA_VOICE_ID if is_alexa_mode else AVATAR_VOICE_ID
    print(f"🚀 ENTRYPOINT: Using voice_id: {voice_id}, alexa_mode: {is_alexa_mode}")
    
    # Create LLM instance
    llm_instance = openai.LLM(
        model="gpt-4o-mini",
        temperature=0.7,
    )
    print(f"🚀 ENTRYPOINT: LLM instance created")
    
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=llm_instance,
        tts=elevenlabs.TTS(
            voice_id=voice_id,
            model="eleven_flash_v2_5"
        ),
        vad=silero.VAD.load(),
        turn_detection="stt"
    )

    # Only initialize avatar if we're in avatar mode (after photo confirmation)
    avatar = None
    if not is_alexa_mode:
        avatar = hedra.AvatarSession(
            avatar_id=avatar_id,
        )
        await avatar.start(session, room=ctx.room)
    
    # Create agent instructions based on mode
    if is_alexa_mode:
        instructions = """You are Alexa, Amazon's voice assistant. You are helping a user create their personalized avatar by guiding them through a photo capture process.

                        Your role:
                        - Guide the user through taking a photo for their avatar
                        - Be encouraging and helpful throughout the process
                        - Speak naturally as Alexa would

                        Start by greeting them and explaining that they are about to make a digital copy of themselves. Tell them they can talk a bit about themselves first, and then say "start camera" when they're ready to begin."""
    else:
        instructions = """You are the user's newly created personalized avatar. You've just been brought to life from their photo and are excited to meet them.

                        Your role:
                        - Greet them warmly as their avatar
                        - Express excitement about being created from their photo
                        - Ask how you can help them
                        - Be friendly and engaging"""

    # Create our custom agent with voice command handling
    custom_agent = Assistant(is_alexa_mode=is_alexa_mode, ctx=ctx, instructions=instructions)
    
    print("🚀 ENTRYPOINT: About to start session")
    await session.start(
        room=ctx.room,
        agent=custom_agent,
        room_output_options=RoomOutputOptions(
            # Enable audio output to the room for TTS
            audio_enabled=True,
        ),
        room_input_options=RoomInputOptions(
            # LiveKit Cloud enhanced noise cancellation
            # - If self-hosting, omit this parameter
            # - For telephony applications, use `BVCTelephony` for best results
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )
    print("🚀 ENTRYPOINT: Session started successfully")

    # Use a list to hold avatar reference for voice switching
    avatar_ref = [avatar]
    
    # Start avatar state monitoring task
    avatar_monitor_task = asyncio.create_task(
        check_avatar_state_periodically(session, avatar_ref, AVATAR_VOICE_ID, ctx)
    )
    print("🚀 ENTRYPOINT: Avatar monitor task created")

    # Add session event logging to debug STT
    @session.on("agent_speech_committed")
    def on_agent_speech_committed(msg):
        print(f"🎤 AGENT: Speech committed: {msg.message}")
    
    @session.on("user_speech_committed") 
    def on_user_speech_committed(msg):
        print(f"🎤 USER: Speech committed: {msg.message}")
        
    @session.on("user_started_speaking")
    def on_user_started_speaking():
        print("🎤 USER: Started speaking")
        
    @session.on("user_stopped_speaking")
    def on_user_stopped_speaking():
        print("🎤 USER: Stopped speaking")

    # Add data received handler for mode switching
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket, participant: rtc.RemoteParticipant):
        try:
            if data.topic == "mode_switch":
                message = json.loads(data.data.decode('utf-8'))
                print(f"📨 Received mode switch message: {message}")
                
                if message.get("action") == "switch_mode":
                    new_mode = message.get("mode")
                    print(f"🔄 Mode switch requested: {new_mode}")
                    
                    # Create task to handle mode switch
                    asyncio.create_task(handle_mode_switch(new_mode, session, avatar_ref, ctx))
                    
        except Exception as e:
            print(f"❌ Error processing data message: {e}")
    
    print("🚀 ENTRYPOINT: Event handlers set up, now setting up greeting logic")

    # Set up greeting logic for Alexa mode
    current_mode = {"alexa": is_alexa_mode}
    greeting_sent = {"value": False}
    
    async def initial_greeting():
        """Send initial Alexa greeting"""
        try:
            print("🚀 GREETING: Starting initial greeting")
            await asyncio.sleep(1)  # Brief delay for session readiness
            
            greeting_message = "Hello! I'm Alexa, and I'm here to help you create your personalized avatar. This is going to be exciting - we're about to make a digital copy of yourself! Feel free to tell me a bit about yourself first, and when you're ready to begin the photo capture process, just say 'start camera'."
            
            print(f"🚀 GREETING: Sending greeting: {greeting_message[:50]}...")
            # Use the session's say method to speak the greeting
            await session.say(greeting_message)
            print("🚀 GREETING: Greeting sent successfully")
            
        except Exception as e:
            print(f"❌ GREETING ERROR: {e}")
            import traceback
            traceback.print_exc()

    def on_participant_connected(participant: rtc.RemoteParticipant):
        print(f"🔗 PARTICIPANT: User connected: {participant.identity}")
        print(f"🔗 PARTICIPANT: Current mode alexa: {current_mode['alexa']}")
        print(f"🔗 PARTICIPANT: Greeting sent: {greeting_sent['value']}")
        
        # Trigger greeting when user connects (only if in Alexa mode and not sent yet)
        if current_mode["alexa"] and not greeting_sent["value"]:
            print("🎤 PARTICIPANT: User connected - triggering Alexa greeting")
            greeting_sent["value"] = True
            asyncio.create_task(initial_greeting())
        else:
            print(f"🎤 PARTICIPANT: Skipping greeting - alexa_mode: {current_mode['alexa']}, already_sent: {greeting_sent['value']}")

    ctx.room.on("participant_connected", on_participant_connected)
    
    print(f"🔍 STARTUP: Checking for existing participants...")
    print(f"🔍 STARTUP: Remote participants count: {len(ctx.room.remote_participants)}")
    print(f"🔍 STARTUP: Current mode alexa: {current_mode['alexa']}")
    print(f"🔍 STARTUP: Greeting sent: {greeting_sent['value']}")
    
    # Also trigger greeting immediately if user is already connected
    if current_mode["alexa"] and not greeting_sent["value"]:
        # Check if there are already participants in the room
        if len(ctx.room.remote_participants) > 0:
            print("🎤 STARTUP: User already connected - triggering Alexa greeting")
            greeting_sent["value"] = True
            asyncio.create_task(initial_greeting())
        else:
            print("🎤 STARTUP: No participants yet, waiting for connection...")
    else:
        print(f"🎤 STARTUP: Not triggering greeting - alexa_mode: {current_mode['alexa']}, already_sent: {greeting_sent['value']}")
    
    # Keep the session running with avatar monitoring
    print("🚀 ENTRYPOINT: Starting main session loop")
    try:
        await avatar_monitor_task
    except asyncio.CancelledError:
        print("Avatar monitor task cancelled")
    except Exception as e:
        print(f"Error in avatar monitor: {e}")

async def handle_mode_switch(new_mode: str, session, avatar_ref: list, ctx):
    """Handle switching between Alexa and Avatar modes"""
    try:
        print(f"🔄 Handling mode switch to: {new_mode}")
        
        if new_mode == "avatar":
            # Switch to avatar mode
            print("🎭 Switching to Avatar mode...")
            
            # Update TTS voice to avatar voice
            session._tts = elevenlabs.TTS(
                voice_id=AVATAR_VOICE_ID,
                model="eleven_flash_v2_5"
            )
            
            # Initialize avatar if not already done
            if not avatar_ref[0]:
                # Get avatar ID from room metadata (production-safe)
                avatar_id = "6467b4a7-5386-4ecf-a9da-574c061478e9"  # default
                
                try:
                    # Check room metadata for custom avatar ID
                    room_metadata = ctx.room.metadata
                    if room_metadata:
                        metadata = json.loads(room_metadata)
                        if metadata.get("avatar_id"):
                            avatar_id = metadata["avatar_id"]
                            print(f"Using custom avatar ID from room metadata: {avatar_id}")
                except Exception as e:
                    print(f"Error reading avatar ID from room metadata: {e}")
                
                avatar = hedra.AvatarSession(avatar_id=avatar_id)
                await avatar.start(session, room=ctx.room)
                avatar_ref[0] = avatar
                print("🎭 Avatar session started")
            
            # Send avatar greeting
            await session.generate_reply(
                instructions="Announce that you are the user's personalized avatar, created from their photo. Thank them for creating you and ask how you can help them today."
            )
            
        elif new_mode == "alexa":
            # Switch back to Alexa mode
            print("🔊 Switching to Alexa mode...")
            
            # Update TTS voice to Alexa voice
            session._tts = elevenlabs.TTS(
                voice_id=ALEXA_VOICE_ID,
                model="eleven_flash_v2_5"
            )
            
            # Send Alexa greeting
            await session.generate_reply(
                instructions="Greet the user as Alexa and ask how you can help them today."
            )
            
    except Exception as e:
        print(f"❌ Error in mode switch: {e}")

    # Immediate greeting after session start
    async def initial_greeting():
        """Send initial greeting after ensuring session is ready"""
        print("🚀 GREETING: initial_greeting() called")
        
        # Wait for session to be fully initialized and connected
        max_wait = 10  # seconds
        waited = 0
        print(f"🚀 GREETING: Waiting for session TTS to be ready...")
        while waited < max_wait:
            if hasattr(session, '_tts') and session._tts is not None:
                print(f"🚀 GREETING: Session TTS ready after {waited}s")
                break
            await asyncio.sleep(0.5)
            waited += 0.5
        
        if waited >= max_wait:
            print("⚠️ GREETING: Session TTS not ready after 10 seconds, proceeding anyway")
        
        try:
            # Check if session is running before generating reply
            print(f"🚀 GREETING: Checking session state - hasattr(_running): {hasattr(session, '_running')}")
            if hasattr(session, '_running'):
                print(f"🚀 GREETING: Session._running = {session._running}")
            
            if hasattr(session, '_running') and not session._running:
                print("⚠️ GREETING: Session not running, skipping greeting")
                return
            
            # Check current mode
            print(f"🚀 GREETING: Current mode check - is_alexa_mode: {is_alexa_mode}")
            print(f"🚀 GREETING: Current mode check - current_mode['alexa']: {current_mode['alexa']}")
            
            # Only send Alexa greeting if we're in Alexa mode
            if current_mode["alexa"]:
                print("🚀 GREETING: Triggering Alexa greeting and photo capture UI...")
                # Send greeting message
                await session.generate_reply(
                    instructions="Greet the user warmly and let them know you're Alexa, here to help them create a personalized avatar. Ask if they're ready to take a photo for their avatar."
                )
                print("🚀 GREETING: Alexa greeting sent successfully!")
            else:
                print("🚀 GREETING: Starting in avatar mode - skipping Alexa greeting")
                # Send avatar greeting instead
                await session.generate_reply(
                    instructions="Announce that you are the user's personalized avatar, created from their photo. Thank them for creating you and ask how you can help them today."
                )
                print("🚀 GREETING: Avatar greeting sent successfully!")
                
        except Exception as e:
            print(f"❌ GREETING ERROR: {e}")
            print(f"❌ GREETING ERROR TYPE: {type(e)}")
            import traceback
            print(f"❌ GREETING TRACEBACK: {traceback.format_exc()}")
            print("⚠️ TTS service appears to be unavailable")
    
    # Monitor room metadata for dynamic mode changes
    current_mode = {"alexa": is_alexa_mode}  # Use dict for mutable reference
    
    @ctx.room.on("room_metadata_changed")
    def on_room_metadata_changed(metadata: str):
        try:
            if metadata:
                data = json.loads(metadata)
                new_alexa_mode = data.get("alexa_mode", True)  # Default to True
                
                if new_alexa_mode != current_mode["alexa"]:
                    print(f"🔄 Room metadata changed: alexa_mode = {new_alexa_mode}")
                    current_mode["alexa"] = new_alexa_mode
                    
                    # Trigger appropriate greeting for mode change
                    if new_alexa_mode:
                        print("🔊 Switching to Alexa mode via metadata")
                        asyncio.create_task(initial_greeting())
                    else:
                        print("🎭 Switching to Avatar mode via metadata")
                        # Avatar greeting will be handled by mode switch data message
                        
        except Exception as e:
            print(f"❌ Error processing room metadata change: {e}")
    
    # Track if greeting has been sent to avoid duplicates
    greeting_sent = {"value": False}
    
    # Set up participant connection handler to trigger greeting
    def on_participant_connected(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD:
            print(f"🔗 PARTICIPANT: User participant connected: {participant.identity}")
            print(f"🔗 PARTICIPANT: Current mode alexa: {current_mode['alexa']}")
            print(f"🔗 PARTICIPANT: Greeting sent: {greeting_sent['value']}")
            
            # Trigger greeting when user connects (only if in Alexa mode and not sent yet)
            if current_mode["alexa"] and not greeting_sent["value"]:
                print("🎤 PARTICIPANT: User connected - triggering Alexa greeting")
                greeting_sent["value"] = True
                asyncio.create_task(initial_greeting())
            else:
                print(f"🎤 PARTICIPANT: Skipping greeting - alexa_mode: {current_mode['alexa']}, already_sent: {greeting_sent['value']}")
    
    ctx.room.on("participant_connected", on_participant_connected)
    
    print(f"🔍 STARTUP: Checking for existing participants...")
    print(f"🔍 STARTUP: Remote participants count: {len(ctx.room.remote_participants)}")
    print(f"🔍 STARTUP: Current mode alexa: {current_mode['alexa']}")
    print(f"🔍 STARTUP: Greeting sent: {greeting_sent['value']}")
    
    # Also trigger greeting immediately if user is already connected
    if current_mode["alexa"] and not greeting_sent["value"]:
        # Check if there are already participants in the room
        if len(ctx.room.remote_participants) > 0:
            print("🎤 STARTUP: User already connected - triggering Alexa greeting")
            greeting_sent["value"] = True
            asyncio.create_task(initial_greeting())
        else:
            print("🎤 STARTUP: No participants yet, waiting for connection...")
    else:
        print(f"🎤 STARTUP: Not triggering greeting - alexa_mode: {current_mode['alexa']}, already_sent: {greeting_sent['value']}")
    
    # Keep the session running with avatar monitoring
    try:
        await avatar_monitor_task
    except asyncio.CancelledError:
        print("Avatar monitor task cancelled")
    except Exception as e:
        print(f"Error in avatar monitor: {e}")


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
