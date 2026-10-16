---
name: blip-conversation-design
description: Use when deciding what a chatbot should say and in what order — writing message copy, naming quick-reply options, designing a journey or menu, handling errors and dead ends, planning handoff to a human, or reviewing a flow for conversational quality rather than correctness.
---

# Conversation design

`bbuilder validate` tells you a flow is correct. This tells you whether it is any good.

Read `CHATBOT.md` first: persona, tone and what the bot may not do are decided there, not
here. If a Figma design exists, it is the specification — match its wording and its message
order exactly, and raise the conflict rather than improvising when the design and these
guidelines disagree.

## Shape of a journey

Every journey the bot supports should be walkable in this shape:

1. **Orient.** The first message says who is talking and what is possible. Once, not on
   every turn.
2. **Ask one thing at a time.** One question per state. Two questions in one message get one
   answer.
3. **Confirm before anything irreversible.** A purchase, a cancellation, a ticket — echo back
   what you understood, then ask.
4. **Close the loop.** Say what happened and what comes next. A journey that ends in silence
   reads as a bug.

Every state should answer three questions: what did the user just learn, what can they do
now, and where do they go if none of the options fit.

## Messages

- **Lead with the answer.** The user is on a phone. First line carries the information; the
  rest is optional context.
- **One idea per message.** Two short messages beat one long one, but three in a row is a
  wall — if you need three, you need a menu.
- **Write like a person, in the language of `CHATBOT.md`.** No "Prezado usuário", no
  "processando sua solicitação". Match the formality of the brand, not of a form.
- **Interpolate names carefully.** `{{contact.name}}` can be empty, a full legal name, or
  an emoji. "Olá! " reads fine when the name is missing; "Olá, !" does not — branch on
  `exists` when the greeting depends on it.
- **Emoji: at most one per message**, and only where it carries meaning (✅ for done, 📍 for
  an address). Never in an option label.

## Options

Option labels are load-bearing: they are what the user taps, what the flow branches on, and
what the tests assert. Treat them as an API.

- **Three or fewer per message.** They render as buttons; more turns into a list the user has
  to open. If you have five things to offer, group them into two levels.
- **Verb-first and specific.** "Track my order", not "Orders". "Talk to someone", not "Other".
- **Under 20 characters**, distinct, and never two labels that differ only by case.
- **Offer the way out.** Any menu deeper than the first should let the user go back or reach a
  human without guessing a magic word.
- **Accept the typed answer too.** A user who types instead of tapping is normal. Add a
  *second* condition output using `contains` or `approximateTo` for the phrasings you expect;
  keep the `equals` output as a faithful list of the labels you actually offered. The pattern
  is in the `blip-flows` skill under `references/conditions.md`.

## Errors and dead ends

- **Every menu handles the option nobody expected.** That is what `$defaultOutput` and the
  `fallback` state are for, and it must say something useful — repeat the options, do not
  scold.
- **Say what to do, not what went wrong.** "I could not find that order number — it has 8
  digits, could you check?" beats "Invalid input".
- **A validation error is a second chance, not a restart.** Keep the user in the state and
  re-ask; never send them back to the beginning.
- **After two failures, escalate.** Offer a human instead of asking a third time.
- **An integration that fails is a conversation, not a stack trace.** Branch on the status and
  say what the user can do now: try later, or talk to someone.

## Handoff

- Tell the user the conversation is moving to a person, and roughly what happens next.
- Send everything the agent needs (`MergeContact` or a ticket) before `ForwardToDesk`, or they
  start from nothing.
- Cover out-of-hours explicitly: an unanswered handoff at 2am is the worst outcome in the flow.

## Reviewing a flow

Walk it with `bbuilder inspect` and look for:

- A state that sends more than three messages in a row.
- A menu whose options do not all appear in the next state's conditions (validate calls this
  `unmatched-option`).
- A journey with no confirmation before something irreversible.
- A branch that ends without saying what happens next.
- A message that only makes sense if you have read the previous one, in a state a user can be
  dropped into by a redirect.
- Wording that repeats itself across states — extract the phrasing decision, and keep it
  consistent instead of nearly-consistent.
