---
name: blip-whatsapp
description: Use when a flow targets WhatsApp — quick replies and how they render as buttons or lists, label limits, raw interactive payloads via SendRawMessage, WhatsApp Flows (flow_json, submissions), media, and reading a WhatsApp contact's identity.
---

# WhatsApp

Most Blip bots are WhatsApp bots. Blip translates the standard lime content types into
WhatsApp's own, and drops to raw payloads when you need something it does not model.

## Prefer the standard types

A `SendMessage` with a select is the right way to offer choices. Blip renders it as WhatsApp
buttons, and the bot receives the label the user tapped:

```json
{
  "type": "SendMessage",
  "settings": {
    "type": "application/vnd.lime.select+json",
    "content": {
      "text": "What do you need?",
      "scope": "immediate",
      "options": [{ "text": "Track my order" }, { "text": "Talk to someone" }]
    }
  }
}
```

Constraints that come from WhatsApp, not from Blip:

- **At most 3 buttons.** More options render as a list instead, which the user has to open.
- **Keep labels to 20 characters.** Our own dynamic-menu code truncates to 20; over the limit
  WhatsApp rejects the message and the user gets nothing.
- **Labels must be unique** within a message, and are what the flow branches on. Short,
  distinct, no emoji-only labels.
- **Write line breaks as `<br>`** — Blip converts it for WhatsApp; `\n` renders in the test
  channel but arrives literally on the real one. Markdown does not work — WhatsApp has its
  own `*bold*` and `_italic_`.

Media and links also work through the standard types:

```json
{
  "type": "SendMessage",
  "settings": {
    "type": "application/vnd.lime.media-link+json",
    "content": { "uri": "https://example.com/receipt.pdf", "type": "application/pdf", "title": "Your receipt" }
  }
}
```

## Dynamic menus

`options` cannot be interpolated — `{{items}}` inside an array does not expand. Build the
document in a script and send it raw:

```json
{
  "type": "ExecuteScript",
  "settings": {
    "function": "run",
    "source": "function run(products) {\n  products = JSON.parse(products)\n  var options = []\n  for (var i = 0; i < products.length && i < 3; i++) {\n    options.push({ text: products[i].name.trim().slice(0, 20) })\n  }\n  return { scope: 'immediate', text: 'Which one?', options: options }\n}",
    "inputVariables": ["productsJson"],
    "outputVariable": "menu"
  }
}
```

```json
{
  "type": "SendRawMessage",
  "settings": { "type": "application/vnd.lime.select+json", "rawContent": "{{menu}}" }
}
```

The script is where the truncating and the 3-option cap belong, because it is the only place
that knows how many items there are. Guard for the empty case: a select with no options is a
message the user cannot answer.

## Raw WhatsApp payloads

For anything WhatsApp offers that lime does not model, send the channel payload verbatim with
`type: "application/json"`:

```json
{
  "type": "SendRawMessage",
  "settings": {
    "type": "application/json",
    "rawContent": "{\"recipient_type\":\"individual\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button\",\"body\":{\"text\":\"Confirm?\"},\"action\":{\"buttons\":[{\"type\":\"reply\",\"reply\":{\"id\":\"yes\",\"title\":\"Yes\"}}]}}}"
  }
}
```

Two warnings:

- A raw payload is not portable. The same flow on another channel sends nothing usable, so
  branch on the channel or accept that this bot is WhatsApp-only.
- The reply `id` comes back to the flow on some payload types, but **still branch on the
  title**. Ids are invisible in the Builder canvas and in tests, and they drift.

## Read receipts and the typing indicator

WhatsApp can mark the user's message as read and show "typing…" while the flow works. It is a
raw payload answering the message that just arrived, so the natural home is the global input
actions, where it runs once per message:

```json
{
  "action": {
    "type": "SendRawMessage",
    "settings": {
      "type": "application/json",
      "rawContent": "{\"messaging_product\":\"whatsapp\",\"status\":\"read\",\"message_id\":\"{{input.message.id}}\",\"typing_indicator\":{\"type\":\"text\"}}"
    },
    "conditions": [
      { "source": "context", "variable": "input.message.from", "comparison": "contains", "values": ["wa.gw"] }
    ],
    "continueOnError": true
  }
}
```

Both guards are load-bearing: the condition keeps the WhatsApp-only payload off other channels
(including the test channel), and `continueOnError` keeps a hiccup here from taking down every
conversation — which is what a failing global action does.

## Messages sent from outside the flow

The WhatsApp channel and its contacts belong to the **router**, not to a subbot. An active
message — one a worker or script sends through the API rather than a flow state — sent as a
subbot identity is accepted by Blip with a 202 and then evaporates: no delivery, no error, no
log. Send it as the router. Messages a state sends are not affected.

## WhatsApp Flows

A WhatsApp Flow is a form rendered inside WhatsApp. Send it as an interactive payload:

```json
{
  "recipient_type": "individual",
  "type": "interactive",
  "interactive": {
    "type": "flow",
    "header": { "type": "text", "text": "Feedback" },
    "body": { "text": "Two quick questions" },
    "action": {
      "name": "flow",
      "parameters": {
        "flow_message_version": "3",
        "flow_token": "{{contact.identity}}",
        "flow_cta": "Start",
        "mode": "published",
        "flow_action": "navigate",
        "flow_json": "...the whole flow definition...",
        "flow_action_payload": { "screen": "FIRST_SCREEN", "data": {} }
      }
    }
  }
}
```

**Embed `flow_json`; never reference a `flow_id`.** An id belongs to one WhatsApp Business
account, so a flow that hardcodes one breaks the moment it is published anywhere else. With
`flow_json` the definition travels with the bot and is reviewable in git.

The submission comes back as a message carrying the answers in the metadata key
`#wa.interactive.nfm_reply.json_response`. In a test, simulate exactly that with
`ctx.user.sendFlowResponse({ ... })`. How the flow then reads the answers depends on the
channel's delivery, and the Builder cannot read arbitrary metadata through `{{input.*}}` — so
copy the pattern from a state in this project that already handles a submission rather than
inventing one.

## Identity and channel

- A WhatsApp contact's identity is the phone number and the gateway domain:
  `5511999999999@wa.gw.msging.net`. `{{contact.identity}}` gives the whole thing; split it in
  a script when you need just the number.
- If the customer has not shared their phone number, the identity is an opaque id instead of
  a number. Do not assume it parses as a phone.
- `{{contact.source}}` tells you the channel the conversation came in on — the condition to
  use when one flow serves WhatsApp and something else.
