# textQuest

textQuest is a browser-based text adventure that gives players a story purpose,
lets them explore a deterministic world and solve its puzzles through authored
characters and discoveries.

## Language

**Adventure**:
A complete playable story run with settings, a world, a length, a player objective
and an ending.

**Story purpose**:
The player-facing problem or reason for taking part in an **Adventure**.
_Avoid_: Premise, plot summary

**Objective**:
The main goal derived from the **Story purpose** that remains visible during an
**Adventure**.
_Avoid_: Task, puzzle goal

**Optional discovery**:
A discoverable detail or reward that adds to an **Adventure** without changing
its main **Objective**.
_Avoid_: Side quest, optional puzzle

**Character**:
A named person in an **Adventure** who provides authored dialogue and
conversation topics.
_Avoid_: NPC, persona

**Conversation**:
Player dialogue with a **Character**, using visible topics or typed words matched
to authored aliases.

**Clue**:
Evidence discovered through an action or a puzzle effect. A **Conversation** can
lead to a useful topic or action, but it does not add a **Clue**.
_Avoid_: Hint, information

**Hint**:
Optional player-requested help that becomes more useful across repeated requests.
It must use only discovered information and not reveal hidden solutions.

**Surprise me**:
A start-screen choice that selects one of the three genres uniformly.
_Avoid_: Random genre
