---
name: mermaid-diagrams
description: Guidelines for creating valid Mermaid diagrams to avoid rendering errors.
metadata:
  type: project
---

When creating Mermaid diagrams, avoid using special characters like parentheses `()` or colons `:` inside node definition brackets (e.g., use `A[Label]` instead of `A[Label (Detail)]`). These characters can cause parsing errors in many markdown renderers. If complex labels are needed, use simple text or wrap the label in quotes if supported by the specific environment.