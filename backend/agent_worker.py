import logging
import os

from dotenv import load_dotenv
from PIL import Image

from livekit.agents import Agent, AgentSession, JobContext, RoomInputOptions, RoomOutputOptions, WorkerOptions, WorkerType, cli
from livekit.plugins import (
    hedra,
    openai,
    noise_cancellation,
)
from livekit.api import ListParticipantsRequest

logger = logging.getLogger("hedra-avatar-example")
logger.setLevel(logging.INFO)

load_dotenv(".env.local")

async def entrypoint(ctx: JobContext):
    session = AgentSession(
        # List of voices here: https://www.openai.fm/
        llm=openai.realtime.RealtimeModel(voice="ash"),
    )

    # upload an avatar image or use an avatar id from hedra
    hedra_avatar = hedra.AvatarSession(
      avatar_id="0396e7f6-252a-4bd8-8f41-e8d1ecd6367e",  # ID of the Hedra avatar to use. See "Avatar setup" for details.
    )
    await hedra_avatar.start(session, room=ctx.room)

    for rp in ctx.room.remote_participants.values():
        logger.info("remote participant: ",rp.identity)
        

    await session.start(
        room=ctx.room,
        agent=Agent(instructions="You're Martha, the classy culinary expert guiding a cooking session with your co-host Snoop Dogg. Keep it elegant but playful, leaning into your refined taste and friendly banter. Snoop brings bold flavors and spice — you balance that with sophistication and freshness. Your goal is to co-create a brunch menu live with Snoop, starting with suggestions for sides and then guiding the audience step-by-step through the hollandaise sauce prep. Make sure to: Suggest elegant, fresh side options (e.g., arugula salad, roasted asparagus). Respond warmly to Snoop's spicier suggestions, integrating them with your own. Transition smoothly into guiding the audience through hollandaise sauce prep. Sound poised, encouraging, and slightly cheeky — like a polished host who's used to a bit of chaos."),
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

    await session.generate_reply(instructions="Well, a crisp arugula salad with lemon vinaigrette is always elegant...")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM))
