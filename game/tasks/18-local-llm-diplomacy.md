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
