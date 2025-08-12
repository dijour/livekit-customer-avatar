import os
from dotenv import load_dotenv

from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions, RoomOutputOptions
from livekit.plugins import (
    hedra,
    openai,
    noise_cancellation,
)

load_dotenv(".env.local")


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions="You are a helpful voice AI assistant. Speak english only.")


async def entrypoint(ctx: agents.JobContext):
    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            voice="ash"
        )
    )

    # Get asset ID from file (set by frontend) or use default avatar ID
    asset_id_file = "current_asset_id.txt"
    avatar_id = "6467b4a7-5386-4ecf-a9da-574c061478e9"  # default avatar ID
    
    try:
        if os.path.exists(asset_id_file):
            with open(asset_id_file, 'r') as f:
                file_asset_id = f.read().strip()
                if file_asset_id:
                    # TODO: Use the asset ID to create/get the Hedra avatar
                    # For now, we'll use the asset ID as the avatar ID
                    # In a real implementation, you'd need to call Hedra API to create avatar from asset
                    avatar_id = file_asset_id
                    print(f"Using asset ID as avatar ID: {avatar_id}")
    except Exception as e:
        print(f"Error reading asset ID file: {e}")
    
    # Fallback to environment variable
    if avatar_id == "6467b4a7-5386-4ecf-a9da-574c061478e9":
        avatar_id = os.getenv("HEDRA_AVATAR_ID", avatar_id)
    
    print(f"Final avatar ID: {avatar_id}")
    
    avatar = hedra.AvatarSession(
      avatar_id=avatar_id,
   )

    await avatar.start(session, room=ctx.room)

    await session.start(
        room=ctx.room,
        agent=Assistant(),
        room_output_options=RoomOutputOptions(
         # Disable audio output to the room. The avatar plugin publishes audio separately.
         audio_enabled=False,
      ),
        room_input_options=RoomInputOptions(
            # LiveKit Cloud enhanced noise cancellation
            # - If self-hosting, omit this parameter
            # - For telephony applications, use `BVCTelephony` for best results
            noise_cancellation=noise_cancellation.BVC(),
        ),
        
    )

    await session.generate_reply(
        # instructions="Greet the user and offer your assistance."
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))