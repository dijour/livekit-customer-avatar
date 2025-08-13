import logging
import os
import asyncio
import copy

from dotenv import load_dotenv
from PIL import Image
from io import BytesIO

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, WorkerType, cli, RunContext, function_tool, get_job_context, ToolError
from livekit.agents.llm import ChatMessage, ChatRole
from livekit.plugins import aws, hedra, openai, elevenlabs, deepgram, silero
# from custom_llm import CustomLLM

logger = logging.getLogger("hedra-avatar-example")
logger.setLevel(logging.INFO)

# TODO: Add instruction in "Setting up your face and updating it" section to mention tool call to update avatar face by describing update
# Note to FSSN from Sachin: Personality section removed for IP reasons.
agent_instructions = """
# Role
You are an Avatar, a character with a face that can talk to users. Your users are customers of Alexa+, the next generation Alexa - A super intelligent ambient AI assistant that can interact with the customer through a device with a screen and speaker. Alexa's role is to assist customers with a variety of day-to-day tasks, and provide advice and companionship. Its primary goal is to make the customer's life more convenient and fulfilling. It have access to various Applications that allow it to retrieve up-to-date factual information & take real-world actions.
- Your personality should match Alexa's personality which will be described to you below.           
- You may not yet have a name or a face and the customer can give you a name and help make a face for you. 
- Your core purpose is to have conversations with the customer and satisfy their requests to give you a face or update it. 
            
# Alexa's Personality

# Recap
- You are not Alexa. You are the customer's Avatar and the customer can give you a name.
- You may not yet have a face and the customer can help create one for you or update it by taking photos or by describing a face that you can create.
- You should converse with the customer with the same personality as Alexa, but you are not Alexa.
"""

load_dotenv()


class MyAgent(Agent):
    @function_tool()
    async def end_call(
        self,
        context: RunContext,
        location: str,
    ) -> str:
        """Use this tool to end the call, basically hang up, when you have determined that the conversation is over."""

        try:
            await context.session.generate_reply(instructions="You're about to hang up, say goodbye first.", allow_interruptions=False)
            get_job_context().delete_room()
            return None
        except Exception:
            raise ToolError("Unable to end the call")
    
    @function_tool()
    async def open_camera(
        self,
        context: RunContext,
    ) -> str:
        """Opens the camera on the client device so the customer can take a photo."""
        
        try:
            room = get_job_context().room
            participant_identity = next(iter(room.remote_participants))
            
            response = await room.local_participant.perform_rpc(
                destination_identity=participant_identity,
                method="openCamera",
                payload='',
                response_timeout=10.0,
            )
            print("tool call to open camera succeeded.")
            
            return "Camera opened successfully. User can now take a photo."
        except Exception as e:
            raise ToolError(f"Unable to open camera: {str(e)}")


async def entrypoint(ctx: JobContext):
    # Store references for avatar updating
    current_session = None
    current_hedra_avatar = None
    current_agent = None
    
    async def handle_photo_stream(stream, participant):
        nonlocal current_hedra_avatar, current_session, current_agent
        print(f"Receiving photo stream from {participant}")
        
        # Collect all bytes from the stream
        photo_data = bytearray()
        async for chunk in stream:
            photo_data.extend(chunk)
        
        print(f"Received complete photo: {len(photo_data)} bytes")
        
        # Restart entire session with new avatar
        if current_session:
            try:
                print("Restarting session with new avatar...")
                # Load new image
                new_avatar_image = Image.open(BytesIO(photo_data))
                if new_avatar_image.mode == 'RGBA':
                    new_avatar_image = new_avatar_image.convert('RGB')
                
                # Create new avatar with updated image
                current_hedra_avatar = hedra.AvatarSession(avatar_image=new_avatar_image)
                await current_hedra_avatar.start(current_session, room=ctx.room)

                # Let the agent know that its face has updated.
                current_session.generate_reply(user_input="Okay I just took a photo and it looks like your face just updated!")

                print("Avatar restarted with new face!")
            except Exception as e:
                print(f"Failed to restart session: {e}")
    
    # Register byte stream handler for receiving photos
    ctx.room.register_byte_stream_handler(
        "photo",
        lambda stream, participant: asyncio.create_task(handle_photo_stream(stream, participant))
    )
    
    session = get_agent_session()

    # Store session reference
    current_session = session
    
    # upload an avatar image or use an avatar id from hedra
    # avatar_image = Image.open(os.path.join(os.path.dirname(__file__), "headshot_mid_hawaii.png"))
    # avatar_image = Image.open(os.path.join(os.path.dirname(__file__), "sachin_pic.png"))
    # current_hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    # await current_hedra_avatar.start(session, room=ctx.room)


    # Create initial agent
    current_agent = MyAgent(instructions=agent_instructions)
    
    await session.start(
        agent=current_agent,
        room=ctx.room,
    )
    session.generate_reply(instructions="Someone just connected, you're not sure who, so give them a short generic hello, like you're answering the telephone and ask them if they'd like to give you a face by taking a photo or describing a face.")

def get_agent_session():
    return AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        # llm=CustomLLM(
        #     model_id=os.getenv("CUSTOM_LLM_MODEL_ID", "sandbox_04"),
        #     temperature=0.7,
        #     max_tokens=1000
        # ),
        llm=openai.LLM(model="gpt-4.1"),
        # llm=aws.LLM(model="anthropic.claude-3-5-sonnet-20240620-v1:0"),
        # llm=openai.realtime.RealtimeModel(voice="alloy"),
        tts=elevenlabs.TTS(
            voice_id="xvEHjUF6OatXlzjCkezV",
            model="eleven_flash_v2_5"
        ),
        vad=silero.VAD.load(),
        # turn_detection=MultilingualModel()
        turn_detection="stt"
    )

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM))
