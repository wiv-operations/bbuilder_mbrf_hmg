# Plugin catalog

Every endpoint below is on the same host:

```
https://southamerica-east1-ww-blip-plugins.cloudfunctions.net/<pluginId>_<handler>
```

and every call carries two extra parameters, in the query string for a `GET` and in the body
for a `POST`:

| Parameter | Value |
| --- | --- |
| `botIdentifier` | `{{application.identifier}}` |
| `publicKey` | `{{wwBucketResponse@resource}}`, read from the bucket `ww<pluginId>pk` |

The **Parameters** column lists what the endpoint takes beyond those two. Set each one into a
`ww`-prefixed variable first (see the skill), and keep the quoting exactly as shown: a parameter
marked *(JSON)* is spliced **unquoted**, because the endpoint expects an array or an object
there. Either a script or a `SetVariable` can supply it, as long as the value really is JSON.

Two exceptions to the shape above: the Smart Sales plugins, documented at the end.

## Google Sheets — `gsheets`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Append a row | `POST gsheets_append` | `spreadsheetId`, `range`, `values` (JSON array) | `{{wwResponseBody@cells}}` |
| Find a row by value | `GET gsheets_line` | `spreadsheetId`, `range`, `value` | `{{wwResponseBody@line}}` |
| Read a range | `GET gsheets_range` | `spreadsheetId`, `range` | `{{wwResponseBody@values}}` |

`range` is A1 notation, with an optional sheet name: `A:D`, `PriceList!A:C`. `values` must be
an array, which is why the append operation joins the columns with `#separator#` and splits
them in a script.

## ChatGPT — `chatgpt`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Chat completion | `POST chatgpt_chat` | `input`, `instructions`, `model`, `temperature`, `maxTokens`, `user`, `conversation` *(JSON array)* | `@text`, `@conversation` |
| Assistant thread | `POST chatgpt_chatAssistant` | `assistantId`, `threadId`, `input`, `additionalContext`, `messageId`, `user`, `skillResponse` | `@skill`, `@thread` |

The answer is in `@text`, and the templates run it through a script before sending it, because
it needs unescaping for the channel.

**Only `chatgpt_chat` keeps history in the flow.** You pass `wwconversation` in and write it
back from `{{wwResponseBody@conversation}}` — that is the whole memory, so a state that forgets
to write it back starts fresh every turn. `chatgpt_chatAssistant` has no `conversation` at all:
the history lives on OpenAI's side, keyed by the thread, so what you must persist is
`{{wwResponseBody@thread}}` instead.

`user` identifies the end user for OpenAI and is built from `{{tunnel.originator}}` or
`{{contact.identity}}`.

Sanitize any free text with a script before putting it in the body: a raw `{{input.content}}`
containing a newline or a quote is the most common cause of a 400 here.

The assistant flavour exists for function calling: the model answers with a skill name and
parameters (`@skill`), the flow branches on it, and the next call reports back through
`skillResponse`.

## Gemini — `gemini`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Chat completion | `POST gemini_chat` | `input`, `instructions`, `temperature`, `maxOutputTokens`, `conversation` *(JSON array)* | `@text`, `@conversation` |

**No `user` parameter**, and the conversation is *not* interchangeable with ChatGPT's: Gemini
wants `{ role: 'model' | 'user', parts: [...] }` where ChatGPT wants `{ role, content }`. Passing
one plugin's `wwconversation` to the other is a 400.

## FAQ GPT — `faqgpt`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Answer from the FAQ | `POST faqgpt_chat` | `input`, `user`, `conversation` *(JSON array)* | `@text`, `@conversation` |

No instructions or model: the knowledge base is configured in the plugin, not in the flow. The
conversation shape matches ChatGPT's.

## OpenAI text to speech — `openaitexttospeech`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Text to audio | `POST openaitexttospeech_transform` | `text` | `@mediaUri` |

The state sends the audio itself, as a `SendMessage` media link of type `audio/mp3` pointing at
`{{wwResponseBody@mediaUri}}`. It has no result variable to reset, so it skips step 1.

## RD Station — `rdstation`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Get a CRM contact | `GET rdstation_contact` | `<searchParam>=<searchQuery>` | `@contact` |
| Get a Marketing contact | `GET rdstation_contactMarketing` | `<searchParam>=<searchQuery>` | `@contact` |
| Upsert a CRM contact | `POST rdstation_setContact` | `email`, `name`, `phone`, `fields` (JSON) | `@contact` |
| Upsert a Marketing contact | `POST rdstation_setContactMarketing` | `email`, `name`, `phone`, `city`, `state`, `country`, `jobTitle`, `bio`, `fields` (JSON), `tags` (JSON) | `@contact` |
| Remove tags | `POST rdstation_removeTagsContactMarketing` | `email`, `phone`, `tags` (JSON) | `@contact` |
| Conversion event | `POST rdstation_createConversionEvent` | `email`, `phone`, `conversionIdentifier` | body |
| Chat event | `POST rdstation_createChatEvent` | `email`, `phone`, `chatSubject`, `status`, `eventType`, `chatType`, and `ticketId` + `identity` when reporting a finished chat | body |

The two `GET`s take the search field as a *parameter name*, so the variable holds the field
name and a second one holds the value: `...&{{wwrdsearchparam}}={{wwrdsearchquery}}`. They do
not accept the same fields: the CRM one searches `email`, `name` or `phone`, the Marketing one
`email`, `uuid` or `phone` — asking Marketing for `name` comes back as an error object, not a
contact. Several of the `POST`s also take an optional `defaultCountry`, in the **query string**
rather than the body.

The finished-chat event needs the Desk ticket id, which the Builder extension gets by querying
`/tickets` with `ProcessCommand` before the call — copy that block rather than reinventing it.

## Active Campaign — `activecampaign`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Get a contact | `GET activecampaign_contact` | `email` | `@contact` |
| Check a tag | `GET activecampaign_contactTag` | `email`, `tag` | `@contact` |
| Upsert a contact | `POST activecampaign_setContact` | `email`, `fields` (JSON) | `@contact` |
| Add a tag | `POST activecampaign_setContactTag` | `email`, `tag` | `@contact` |

## Bitrix 24 — `bitrix`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Upsert a contact | `POST bitrix_setContact` | `email`, `name`, `phone`, `web`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm` | body |
| Upsert a company | `POST bitrix_setCompany` | `title`, `email`, `phone`, `web`, and the same `utm*` set | body |
| Create a lead | `POST bitrix_setLead` | `title`, `email`, `name`, `phone`, `web`, the `utm*` set, `companyName`, `companyTitle`, `address`, `addressCity` | body |

## Dynamics 365 — `dynamics`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Get a lead | `GET dynamics_lead` | `searchParameter`, `searchQuery` | body |
| Update a lead | `POST dynamics_setLead` | `leadId`, `fields` (JSON) | body |
| Log attendance on a lead | `POST dynamics_setAttendanceHistoryForLead` | `leadId`, `ticketId` | body |
| Log attendance on an entity | `POST dynamics_setAttendanceHistoryForEntity` | `ticketId`, `entity`, `entityId` | body |

## Exact Spotter — `exactspotter`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Get a lead | `GET exactspotter_lead` | `<searchParam>=<searchQuery>` | `@contact` |
| Create a lead | `POST exactspotter_setLead` | `name`, `phone`, `ddiPhone`, `phone2`, `ddiPhone2`, `industry`, `source`, `subSource`, `sdrEmail`, `group`, `mktLink`, `website`, `leadProduct`, `address`, `addressComplement`, `zipcode`, `city`, `state`, `country`, `cpfcnpj`, `description`, `fields` (JSON) | `@contact` |

`name`, `phone`, `ddiPhone` and `fields` must be **present** — empty is fine, absent is a 400.
Which of them the CRM itself insists on is a separate question. Keep every key in the body and
leave the unused ones as empty variables rather than deleting them.

## Tray — `tray`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Get an order | `GET tray_order` | `orderId` | body |

## Smart Sales carousels — `smartsalescarousels`

| Operation | Endpoint | Parameters | Result |
| --- | --- | --- | --- |
| Send a carousel | `POST smartsalescarousels_sendCarousel` | `type` (`categories`), `user` (`{{contact.identity}}`) | A bare JSON array, so no `@accessor` applies |

On the standard host with the standard parameters, but it reads its key the short way, as
`{{bucket.wwsmartsalescarouselspk}}`, and splits its work across entering and leaving actions —
the leaving one folds the user's answer into `contact.extras` with `MergeContact`.

## Smart Sales — `smartsales`

The one plugin that follows none of this. It calls `https://api.smartsales.whitewall.dev`
directly, authenticates with `Authorization: Bearer {{bucket.wwsmartsalestoken}}` rather than a
public key, has no bucket `ProcessCommand`, and describes one message per channel (a WhatsApp
web link, plain text elsewhere) in a single body.

Do not hand-author it. Configure it through the Builder extension and pull the result.
