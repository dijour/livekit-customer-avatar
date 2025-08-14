import asyncio
import os
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, WorkerType, cli, function_tool, RunContext, get_job_context
from livekit.plugins import openai, elevenlabs, deepgram, silero, hedra
from livekit.agents import RoomOutputOptions, RoomInputOptions
from livekit.plugins import noise_cancellation

load_dotenv(".env.local")


class Assistant(Agent):
    def __init__(self, is_alexa_mode: bool = True, ctx=None, instructions=None):
        self.is_alexa_mode = is_alexa_mode
        self.ctx = ctx
        
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
- "skip photo" - skips photo capture and uses default avatar

When users say these commands, you will automatically trigger the corresponding frontend actions.

Be proactive in guiding them through each step. Start by explaining the process and asking them to say "start camera" when ready."""
            else:
                instructions = """You are the user's newly created personalized avatar. You've just been brought to life from their photo and are excited to meet them.

Your role:
- Greet them warmly as their avatar
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
            return "Great! I'm starting your camera now. Once it's ready, you can say 'take photo' when you're ready to capture your picture."
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


async def monitor_voice_switch(session, avatar_ref, voice_state_file, asset_id_file, avatar_voice_id, ctx):
    """Monitor for voice switching signals and update TTS accordingly"""
    print("Starting voice switch monitor...")
    last_voice_state = None
    
    while True:
        try:
            # Check if voice state file indicates a switch to avatar mode
            current_voice_state = None
            if os.path.exists(voice_state_file):
                with open(voice_state_file, 'r') as f:
                    current_voice_state = f.read().strip()
            
            # Check if we should switch to avatar voice
            if current_voice_state == "avatar" and last_voice_state != "avatar":
                print("Switching to avatar voice and initializing avatar...")
                
                # Initialize avatar if not already done
                if avatar_ref[0] is None:
                    # Read avatar ID from file
                    avatar_id = "6467b4a7-5386-4ecf-a9da-574c061478e9"  # default
                    if os.path.exists(asset_id_file):
                        with open(asset_id_file, 'r') as f:
                            file_asset_id = f.read().strip()
                            if file_asset_id:
                                avatar_id = file_asset_id
                    
                    # Create and start avatar
                    avatar_ref[0] = hedra.AvatarSession(avatar_id=avatar_id)
                    await avatar_ref[0].start(session, room=ctx.room)
                    print(f"Avatar initialized with ID: {avatar_id}")
                
                # Update TTS voice
                try:
                    # Create new TTS with avatar voice
                    new_tts = elevenlabs.TTS(
                        voice_id=avatar_voice_id,
                        model="eleven_flash_v2_5"
                    )
                    
                    # Update session TTS
                    session._tts = new_tts
                    
                    # Update assistant instructions
                    session._agent.instructions = "You are the user's personalized AI avatar. You have just been created from their photo and are now ready to have conversations with them. Be friendly and engaging."
                    
                    # Generate handoff message
                    await session.generate_reply(
                        instructions="Announce that you are now the user's personalized avatar, created from their photo. Thank them for creating you and ask how you can help them today."
                    )
                    
                    print("Successfully switched to avatar voice")
                    
                except Exception as e:
                    print(f"Error switching to avatar voice: {e}")
            
            last_voice_state = current_voice_state
            
            # Check every 2 seconds
            await asyncio.sleep(2)
            
        except Exception as e:
            print(f"Error in voice switch monitor: {e}")
            await asyncio.sleep(5)


async def entrypoint(ctx: agents.JobContext):
    # Voice configuration
    ALEXA_VOICE_ID = "AOqTt8GleoAuFhMxHHu5"  # Alexa voice for setup
    AVATAR_VOICE_ID = "UtaLMHFQy5D4jbOLM0tN"  # Custom avatar voice
    
    # Check if we have an avatar (asset ID exists)
    asset_id_file = "current_asset_id.txt"
    voice_state_file = "voice_state.txt"
    
    # Clear state files on startup to always start fresh with Alexa
    try:
        if os.path.exists(voice_state_file):
            os.remove(voice_state_file)
            print("Cleared voice_state.txt for fresh start")
        if os.path.exists(asset_id_file):
            os.remove(asset_id_file)
            print("Cleared current_asset_id.txt for fresh start")
    except Exception as e:
        print(f"Error clearing state files: {e}")
    
    # Always start in Alexa mode for fresh sessions
    is_alexa_mode = True
    current_voice_id = ALEXA_VOICE_ID
    has_avatar = False
    
    print(f"Starting with voice mode: {'Alexa' if is_alexa_mode else 'Avatar'}, Voice ID: {current_voice_id}")
    
    # Create LLM instance
    llm_instance = openai.LLM(model="gpt-4.1")
    
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
    voice_id = ALEXA_VOICE_ID if is_alexa_mode else AVATAR_VOICE_ID
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

Start by greeting them and explaining that you've opened the photo capture interface. Tell them they can say "start camera" when they're ready to begin."""
    else:
        instructions = """You are the user's newly created personalized avatar. You've just been brought to life from their photo and are excited to meet them.

Your role:
- Greet them warmly as their avatar
- Express excitement about being created from their photo
- Ask how you can help them
- Be friendly and engaging"""

    # Create our custom agent with voice command handling
    custom_agent = Assistant(is_alexa_mode=is_alexa_mode, ctx=ctx, instructions=instructions)
    
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

    # Use a list to hold avatar reference for voice switching
    avatar_ref = [avatar]
    
    # Start voice switching monitor task
    voice_monitor_task = asyncio.create_task(
        monitor_voice_switch(session, avatar_ref, voice_state_file, asset_id_file, AVATAR_VOICE_ID, ctx)
    )

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

    # Immediate greeting after session start
    async def initial_greeting():
        print("Starting initial greeting sequence...")
        await asyncio.sleep(2)  # Wait for session to fully initialize
        
        if is_alexa_mode:
            print("Triggering Alexa greeting and photo capture UI...")
            # Show photo capture UI and greet user
            await show_photo_capture_ui(ctx)
            await session.generate_reply(
                instructions="Immediately greet the user as Alexa. Say 'Hello! I'm Alexa, and I'm here to help you create your personalized avatar. I've opened the photo capture interface for you. When you're ready to take your photo, just say start camera and I'll guide you through the process.'"
            )
        else:
            print("Triggering avatar greeting...")
            await session.generate_reply(
                instructions="Greet the user as their newly created personalized avatar. Express excitement about being created and ask how you can help them."
            )
    
    # Start immediate greeting
    asyncio.create_task(initial_greeting())
    
    # Also set up participant connection handler as backup
    def on_participant_connected(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD:
            print(f"User participant connected: {participant.identity}")
    
    ctx.room.on("participant_connected", on_participant_connected)
    
    # Keep the voice monitor running
    try:
        await voice_monitor_task
    except asyncio.CancelledError:
        print("Voice monitor task cancelled")


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
