# 0010. Postmortem redaction is one-way and runs before the model interface

Status: accepted.

Piece 09 sends incident logs, chat and notes to a model. Those inputs hold emails, addresses, keys
and tokens. The redactor replaces each match with a stable placeholder such as `[EMAIL_1]` before
the payload is built, then a second redaction pass over the finished payload must find nothing or
the run stops before any call.

Choices:

- Placeholders are not reversed in the output. Restoring values would put them back into a document
  that gets shared widely. The cost is that the draft cannot name the real address or host.
- Chat and deploy authors become `participant-N`, and their names are replaced inside message text.
  This supports a blameless draft and keeps names away from the model. Names that are not authors
  (customers, third parties) are not detected, and the README lists that as a limit.
- Redaction is pattern based, with a Luhn check for card numbers. It favors over-redaction (for
  example `token: expired` loses the word `expired`) over a leak. A semantic detector would need a
  model or a download, which this repository avoids.
- The model's output is redacted too, in case it invents a value.
- Event ids in the model's JSON are validated against the timeline, and contributing factors must
  be `hypothesis` with evidence ids, so a draft cannot cite events that do not exist or state a
  cause as confirmed.
