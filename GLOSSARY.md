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
A named person in an **Adventure** who can be examined or spoken to.
_Avoid_: NPC, persona

**Conversation**:
Player interaction with a **Character**, using the person's discovered name or
an authored alias.

**Clue**:
Evidence discovered through an action or a puzzle effect.
_Avoid_: Hint, information

**Hint**:
Optional player-requested help based on the player's discovered state. It must
not reveal hidden solutions.

**Random genre selection**:
The genre chosen from the seed after the player chooses an adventure length.
_Avoid_: Surprise me
