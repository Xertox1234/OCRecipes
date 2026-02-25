---
title: "Prompt injection risk in AI chat and food NLP"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [security, code-review, ai-services]
---

# Prompt Injection Risk in AI Chat and Food NLP

## Summary

User messages in chat, food NLP, and photo analysis are passed directly to OpenAI without sanitization. Users could manipulate AI to return dangerous dietary advice or extract system prompts.

## Background

In nutrition-coach.ts (lines 72-87), full conversation history is sent directly. In food-nlp.ts (line 45), user text goes directly as a message. In photo-analysis.ts (line 236), user answers are interpolated into prompts.

## Acceptance Criteria

- [ ] User input sanitized before being included in AI prompts
- [ ] AI output validated against expected schemas
- [ ] System prompts protected from extraction attempts
- [ ] Content filter layer on AI responses for dangerous dietary advice

## Updates

### 2026-02-24
- Found by security-sentinel agent
