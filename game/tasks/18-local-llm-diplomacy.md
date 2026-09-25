# 18 — Local LLM diplomacy & advisor-level empire decisions (placeholder, after 17)

Idea (user, 2026-09-25): an optional phone-size local model (3-4B, Q4; node-llama-cpp in the Electron shell,
Metal on mac arm64 / CPU-Vulkan on linux x64; ~3 GB download, off by default) that (a) voices AI empires in
diplomatic conversations and picks their proposal, and (b) makes a human player's *strategic* decisions for AI
empires (war/peace, treaty partners, research focus, war target, policy) a few times per game year.

Hard rule: the model never runs inside the tick. It is an external command source like the human player: its
decisions are appended to the command log (same queue the scheduler drains in executeCommands) and saved, so
seed + command log stays deterministic and every pin stays valid. The scripted AI keeps running fleets, economy
and construction. Legal moves come from the sim (17b ShipAction validity, 17e proposal set); the model picks one
by id and writes text; the ported C# evaluator still decides accept/reject. No model installed → current scripted
behaviour.

Needs from 17: 17e proposal API (list legal proposals + evaluate), 17b executeShipAction, 17d policy fields.
Structured brief per call: race traits (races.txt), treaties, attitude score, strength ratio, recent incidents.

## 18a (first): chat-commanded advisor
User (2026-09-25): talk to the model in a chat panel; if it agrees it issues move / attack / refuel / smaller
orders. Design: brief = selection + player's fleets/idle ships + nearby systems/colonies by name + the legal
ShipActions for those objects (17b validity port); the model's output is grammar-constrained (llama.cpp GBNF) to
{ reply: string, commands: Command[] } where Command references objects by id from the brief; each command is
validated and executed through executeShipAction (never bypasses rules), echoed back, and appended to the command
log. Persona = a real character of the empire (e.g. the fleet admiral) fed sim facts so it can object with reasons
(fuel, ally, undefended colony); "do it anyway" overrides; war declarations require an explicit confirm.
Ambiguity → clarifying question. Needs only 17a/17b/17d. Then 18b diplomat voice (needs 17e), 18c advisor-level
decisions for AI empires.
