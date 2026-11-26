---
title: "/barcode-front: check the conversation before reading the image"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, server]
github_issue:
---

# /barcode-front: check the conversation before reading the image

## Summary

server/routes/chat-barcode-front.ts runs the body parse, the AI checks and
the image check (`requireValidImage`) before `answerPhoneRead` looks up the
conversation and the plan. server/routes/chat-photo.ts checks the
conversation first. Nothing is stored or spent out of order: a request for a
conversation the user doesn't own, or a recipe chat, only does some wasted
work before its 404 or 400. The server review of the front-of-pack step
noted it as non-blocking.

## Acceptance criteria

- [ ] The conversation lookup and type check run before `requireValidImage`
      (for example, an `answerPhoneRead` option to take a pre-checked
      conversation), matching chat-photo's order.
- [ ] server/routes/**tests**/chat-barcode-front.test.ts asserts a 404 for
      another user's conversation before the image is read.
